
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, mensaje: "Method not allowed" });

  try {
    const { cedula } = req.body;
    const VERIFY_URL = process.env.GFV_VERIFY_URL;
    const SESSION_COOKIE = process.env.GFV_COOKIE; // Opcional, pero recomendado

    if (!cedula) return res.status(400).json({ ok: false, mensaje: "Cédula requerida" });
    if (!VERIFY_URL) return res.status(500).json({ ok: false, mensaje: "Falta GFV_VERIFY_URL en Vercel" });

    const formData = new URLSearchParams();
    formData.append("documento", String(cedula).replace(/\D/g, ""));
    formData.append("data[origen]", "crm");
    formData.append("data[accion]", "verificar_identidad");

    const headers: Record<string, string> = {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
      "Referer": "https://app.gfv.com.py/",
      "Origin": "https://app.gfv.com.py"
    };

    if (SESSION_COOKIE) {
      headers["Cookie"] = SESSION_COOKIE.includes("PHPSESSID") ? SESSION_COOKIE : `PHPSESSID=${SESSION_COOKIE}`;
    }

    const response = await fetch(VERIFY_URL, {
      method: "POST",
      headers,
      body: formData
    });

    const contentType = response.headers.get("content-type") || "";
    const rawText = await response.text();

    // Caso 1: GFV responde con JSON (ideal)
    if (contentType.includes("application/json")) {
      try {
        const data = JSON.parse(rawText);
        const resObj = data.data || data;
        return res.status(200).json({
          ok: true,
          result: {
            nombre: (resObj.nombres || resObj.nombre || "No encontrado").toUpperCase(),
            apellido: (resObj.apellidos || resObj.apellido || "").toUpperCase(),
            cedula,
            fecha_nacimiento: resObj.fecha_nacimiento || "N/A",
            sexo: resObj.sexo || "N/A",
            estado_civil: resObj.estado_civil || "N/A"
          }
        });
      } catch (e) { /* Fallback al scraper de HTML */ }
    }

    // Caso 2: GFV responde con HTML (Scraping de emergencia)
    // Intentamos buscar patrones comunes en el HTML que devuelve GFV
    const extract = (regex: RegExp) => {
      const match = rawText.match(regex);
      return match ? match[1].trim() : null;
    };

    // Buscamos nombres dentro de tags comunes o labels
    const nombre = extract(/Nombre[s]?:\s*<\/b>\s*([^<]+)/i) || extract(/class="nombre"[^>]*>([^<]+)/i) || extract(/Nombres:\s*([^<|\n]+)/i);
    const apellido = extract(/Apellido[s]?:\s*<\/b>\s*([^<]+)/i) || extract(/class="apellido"[^>]*>([^<]+)/i) || extract(/Apellidos:\s*([^<|\n]+)/i);
    const fnac = extract(/Nacimiento:\s*<\/b>\s*([^<]+)/i) || extract(/Fecha de Nacimiento:\s*([^<]+)/i);

    if (nombre || apellido) {
      return res.status(200).json({
        ok: true,
        result: {
          nombre: (nombre || "DESCONOCIDO").toUpperCase(),
          apellido: (apellido || "").toUpperCase(),
          cedula,
          fecha_nacimiento: fnac || "N/A",
          sexo: "N/A",
          estado_civil: "N/A"
        }
      });
    }

    // Si llegamos aquí y el HTML es muy largo, es probable que sea la página de login
    if (rawText.includes("login") || rawText.includes("Iniciar Sesión")) {
      return res.status(401).json({ 
        ok: false, 
        mensaje: "Sesión expirada. Por favor actualiza la variable GFV_COOKIE en Vercel." 
      });
    }

    return res.status(502).json({ 
      ok: false, 
      mensaje: "GFV devolvió un formato no reconocido.",
      debug: rawText.substring(0, 200) // Enviamos el inicio para diagnosticar
    });

  } catch (e: any) {
    return res.status(500).json({ ok: false, mensaje: "Error crítico: " + e.message });
  }
}
