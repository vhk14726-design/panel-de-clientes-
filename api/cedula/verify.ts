
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, mensaje: "Method not allowed" });

  try {
    const { cedula } = req.body;
    const VERIFY_URL = process.env.GFV_VERIFY_URL;
    const SESSION_COOKIE = process.env.GFV_COOKIE;

    if (!cedula) return res.status(400).json({ ok: false, mensaje: "Cédula requerida" });
    if (!VERIFY_URL) return res.status(500).json({ ok: false, mensaje: "Falta GFV_VERIFY_URL en Vercel" });

    const cleanCI = String(cedula).replace(/\D/g, "");

    // Construcción de la URL de consulta. 
    // Si la URL que puso el usuario ya tiene el hash raro, simplemente concatenamos la CI.
    const finalUrl = VERIFY_URL.endsWith('/') ? `${VERIFY_URL}${cleanCI}` : `${VERIFY_URL}/${cleanCI}`;

    const headers: Record<string, string> = {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      "Referer": "https://app.gfv.com.py/",
      "Origin": "https://app.gfv.com.py"
    };

    if (SESSION_COOKIE) {
      headers["Cookie"] = SESSION_COOKIE.includes("PHPSESSID") ? SESSION_COOKIE : `PHPSESSID=${SESSION_COOKIE}`;
    }

    // Realizamos la petición (Probamos GET primero, que es el estándar de consulta XHR en GFV)
    let response = await fetch(finalUrl, { method: "GET", headers });
    let rawText = await response.text();

    // Si detectamos que nos mandó al login o al cargador inicial
    if (rawText.includes("window.onload") || rawText.includes("login-box")) {
      // Intentamos una vez más con POST por si el endpoint requiere envío de datos
      const formData = new URLSearchParams();
      formData.append("ci", cleanCI);
      const postRes = await fetch(finalUrl, { 
        method: "POST", 
        headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
        body: formData 
      });
      rawText = await postRes.text();
    }

    // --- MOTOR DE EXTRACCIÓN ULTRA-AGRESIVO ---
    
    const findInHtml = (patterns: RegExp[]) => {
      for (const pattern of patterns) {
        const match = rawText.match(pattern);
        if (match && match[1]) return match[1].trim();
      }
      return null;
    };

    // Buscamos Nombres y Apellidos con regex que ignoran tablas y etiquetas
    const nombre = findInHtml([
      /Nombre[s]?[:\s]+(?:<\/b>|<td>|<span>)?\s*([^<|\n|\r|;]+)/i,
      /class="[^"]*nombre[^"]*"[^>]*>\s*([^<]+)/i,
      /id="[^"]*nombres"[^>]*>\s*([^<]+)/i,
      /['"]nombres['"]\s*:\s*['"]([^'"]+)/i
    ]);

    const apellido = findInHtml([
      /Apellido[s]?[:\s]+(?:<\/b>|<td>|<span>)?\s*([^<|\n|\r|;]+)/i,
      /class="[^"]*apellido[^"]*"[^>]*>\s*([^<]+)/i,
      /id="[^"]*apellidos"[^>]*>\s*([^<]+)/i,
      /['"]apellidos['"]\s*:\s*['"]([^'"]+)/i
    ]);

    // Caso especial: GFV a veces devuelve una sola cadena "NOMBRE APELLIDO"
    const nombreCompleto = findInHtml([
        /Cliente[:\s]+(?:<\/b>|<td>|<span>)?\s*([^<|\n|\r|;]+)/i,
        /class="[^"]*cliente[^"]*"[^>]*>\s*([^<]+)/i
    ]);

    if (nombre || apellido || nombreCompleto) {
      return res.status(200).json({
        ok: true,
        result: {
          nombre: (nombre || nombreCompleto || "ENCONTRADO").toUpperCase(),
          apellido: (apellido || "").toUpperCase(),
          cedula: cleanCI,
          fecha_nacimiento: findInHtml([/Nacimiento[:\s]+(?:<\/b>|<td>)?\s*([^<]+)/i]) || "N/A",
          sexo: findInHtml([/Sexo[:\s]+(?:<\/b>|<td>)?\s*([^<]+)/i]) || "N/A",
          estado_civil: "N/A"
        }
      });
    }

    // Si recibimos el script de carga, es error de sesión
    if (rawText.includes("window.onload")) {
      return res.status(401).json({ 
        ok: false, 
        mensaje: "SESIÓN NO VÁLIDA: GFV te está redirigiendo. Actualiza el PHPSESSID en Vercel.",
        debug: "El servidor respondió con un cargador JavaScript."
      });
    }

    return res.status(502).json({ 
      ok: false, 
      mensaje: "Datos no encontrados en GFV para esta CI.",
      debug: rawText.substring(0, 800).replace(/</g, "&lt;") 
    });

  } catch (e: any) {
    return res.status(500).json({ ok: false, mensaje: "Error de conexión: " + e.message });
  }
}
