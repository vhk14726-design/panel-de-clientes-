
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, mensaje: "Method not allowed" });

  try {
    const { cedula } = req.body;
    let VERIFY_URL = process.env.GFV_VERIFY_URL || "https://app.gfv.com.py/OUVBUUVMeVYvSlNtVDVKejRkeTVMaU96NzBzQzBVc3RzUGU3a2FXQnlhTkZHYnUybjdMU0RicHRyNEJvQVpERHpieHlTNExXVTRWSFhlUG9RS2kxL1E9PTo6D6FEUqP-ZlJSl-qgC012mg/";
    const SESSION_COOKIE = process.env.GFV_COOKIE || "";

    if (!cedula) return res.status(400).json({ ok: false, mensaje: "Cédula requerida" });

    const cleanCI = String(cedula).replace(/\D/g, "");

    let finalUrl = VERIFY_URL.trim();
    if (!finalUrl.endsWith('/')) finalUrl += '/';
    finalUrl += cleanCI;

    const headers: Record<string, string> = {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "es-419,es;q=0.9,en;q=0.8",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      "Referer": "https://app.gfv.com.py/",
    };

    if (SESSION_COOKIE) {
      headers["Cookie"] = SESSION_COOKIE.includes("PHPSESSID") ? SESSION_COOKIE : `PHPSESSID=${SESSION_COOKIE}`;
    }

    const response = await fetch(finalUrl, { 
        method: "GET", 
        headers,
        redirect: 'manual' 
    });

    if (response.status === 302) {
        return res.status(401).json({ ok: false, mensaje: "SESIÓN EXPIRADA. Actualiza el PHPSESSID en Vercel." });
    }

    const rawText = await response.text();
    
    // Función de limpieza profunda para evitar "-->" y otros residuos
    const cleanT = (s: string) => {
        return s.replace(/<[^>]*>/g, '') // Quitar HTML
                .replace(/-->/g, '')     // Quitar cierres de comentarios
                .replace(/&nbsp;/g, ' ') // Espacios
                .replace(/\s+/g, ' ')    // Colapsar espacios
                .trim();
    };

    // Buscamos los 3 campos solicitados
    const extractField = (label: string) => {
        const regex = new RegExp(`${label}[:\s]+(?:<\/b>|<td>|<span>|<b>)?\s*([^<|\n|\r|;]+)`, 'i');
        const match = rawText.match(regex);
        return match && match[1] ? cleanT(match[1]) : "";
    };

    const nombres = extractField("Nombres");
    const apellidos = extractField("Apellidos");
    const fechaNac = extractField("Fecha de Nacimiento");

    if (nombres || apellidos) {
        return res.status(200).json({
            ok: true,
            result: {
                nombres: nombres.toUpperCase() || "NO ENCONTRADO",
                apellidos: apellidos.toUpperCase() || "NO ENCONTRADO",
                cedula: cleanCI,
                fecha_nacimiento: fechaNac || "NO DISPONIBLE",
                estado: "ACTIVO"
            }
        });
    }

    return res.status(404).json({ 
        ok: false, 
        mensaje: "No se pudieron extraer los datos. Verifica la sesión o el formato de la página.",
        debug: rawText.substring(0, 500)
    });

  } catch (e: any) {
    return res.status(500).json({ ok: false, mensaje: "Error de red: " + e.message });
  }
}
