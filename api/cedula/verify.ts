
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

    const rawHtml = await response.text();
    
    // Limpieza agresiva de comentarios HTML para evitar el error "-->"
    const sanitizedHtml = rawHtml.replace(/<!--[\s\S]*?-->/g, "");

    const cleanT = (s: string) => {
        return s.replace(/<[^>]*>/g, '') 
                .replace(/&nbsp;/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
    };

    /**
     * Lógica V12: Busca la etiqueta y luego extrae todos los values de inputs 
     * que le sigan hasta encontrar la siguiente sección o fin de bloque.
     */
    const extractMultiField = (label: string) => {
        // Encontrar la posición de la etiqueta
        const labelIdx = sanitizedHtml.toLowerCase().indexOf(label.toLowerCase());
        if (labelIdx === -1) return "";

        // Cortar el HTML desde la etiqueta hasta una distancia razonable (p.ej. 1000 caracteres)
        const subHtml = sanitizedHtml.substring(labelIdx, labelIdx + 1000);
        
        // Buscar todos los value="..." en los inputs siguientes
        const inputRegex = /value\s*=\s*["']([^"']*)["']/gi;
        let matches;
        const results: string[] = [];
        
        // Solo tomamos los inputs antes de que aparezca otra etiqueta de campo mayor
        const nextLabelIdx = subHtml.substring(10).search(/Nombres|Apellidos|Fecha|Sexo|Nacionalidad/i);
        const limitHtml = nextLabelIdx !== -1 ? subHtml.substring(0, nextLabelIdx + 10) : subHtml;

        while ((matches = inputRegex.exec(limitHtml)) !== null) {
            const val = matches[1].trim();
            if (val && !results.includes(val)) results.push(val);
        }

        // Si no encontró inputs, intentamos capturar texto plano básico como respaldo
        if (results.length === 0) {
            const textRegex = new RegExp(`${label}[:\s]+(?:<\/b>|<td>|<span>|<b>)?\s*([^<|\n|\r|;]+)`, 'i');
            const tMatch = limitHtml.match(textRegex);
            return tMatch ? cleanT(tMatch[1]) : "";
        }

        return results.join(" ").trim();
    };

    const nombres = extractMultiField("Nombres");
    const apellidos = extractMultiField("Apellidos");
    const fechaNac = extractMultiField("Fecha de Nacimiento");

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
        mensaje: "No se pudieron localizar datos válidos en la respuesta de GFV.",
        debug: sanitizedHtml.substring(0, 300)
    });

  } catch (e: any) {
    return res.status(500).json({ ok: false, mensaje: "Error crítico: " + e.message });
  }
}
