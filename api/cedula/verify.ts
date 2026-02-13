
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

    const headers: Record<string, string> = {
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      "Referer": "https://app.gfv.com.py/",
      "Origin": "https://app.gfv.com.py"
    };

    if (SESSION_COOKIE) {
      headers["Cookie"] = SESSION_COOKIE.includes("PHPSESSID") ? SESSION_COOKIE : `PHPSESSID=${SESSION_COOKIE}`;
    }

    // ESTRATEGIA: Intentar primero la consulta directa al endpoint de datos
    // Basado en tu Network Tab, GFV suele usar rutas como /clientes/buscar/ID o similares
    // Vamos a intentar obtener los datos del endpoint que configuraste
    
    const formData = new URLSearchParams();
    formData.append("documento", cleanCI);
    formData.append("data[origen]", "crm");
    formData.append("data[accion]", "verificar_identidad");

    let response = await fetch(VERIFY_URL, {
      method: "POST",
      headers,
      body: formData,
      redirect: "follow"
    });

    let rawText = await response.text();

    // Si recibimos el "Loader" (el script de window.onload), significa que tenemos que ir 
    // un paso más allá. Intentamos deducir la URL de datos real.
    if (rawText.includes("window.onload") || rawText.includes("main-css")) {
      // Intentamos construir la URL de datos directa (XHR)
      // Normalmente GFV usa una estructura: https://app.gfv.com.py/modulo/accion/CEDULA
      const baseUrl = VERIFY_URL.split('?')[0].split('/').slice(0, 4).join('/'); // Ej: https://app.gfv.com.py/consultas
      const directDataUrl = `${baseUrl}/verificar_identidad/${cleanCI}`;
      
      const secondTry = await fetch(directDataUrl, { headers });
      const secondText = await secondTry.text();
      
      if (secondText.length > 50 && !secondText.includes("window.onload")) {
        rawText = secondText;
      }
    }

    // ANALIZADOR DE DATOS (JSON O HTML)
    try {
      const data = JSON.parse(rawText);
      const resObj = data.data || data;
      if (resObj.nombres || resObj.nombre || resObj.nombre_cliente) {
        return res.status(200).json({
          ok: true,
          result: {
            nombre: (resObj.nombres || resObj.nombre || resObj.nombre_cliente || "ENCONTRADO").toUpperCase(),
            apellido: (resObj.apellidos || resObj.apellido || "").toUpperCase(),
            cedula: cleanCI,
            fecha_nacimiento: resObj.fecha_nacimiento || "N/A",
            sexo: resObj.sexo || "N/A",
            estado_civil: resObj.estado_civil || "N/A"
          }
        });
      }
    } catch (e) {
      // No era JSON, seguimos con el Scraper de HTML mejorado
    }

    const extract = (regex: RegExp) => {
      const match = rawText.match(regex);
      return match ? match[1].trim() : null;
    };

    // Regex ultra-flexibles para capturar datos en cualquier parte del HTML de GFV
    const nombre = extract(/Nombre[s]?:\s*(?:<\/b>)?\s*([^<|\n|\t]+)/i) || 
                   extract(/class="[^"]*nombre[^"]*"[^>]*>([^<]+)/i) ||
                   extract(/value="([^"]+)"[^>]*name="[^"]*nombre/i);
    
    const apellido = extract(/Apellido[s]?:\s*(?:<\/b>)?\s*([^<|\n|\t]+)/i) || 
                     extract(/class="[^"]*apellido[^"]*"[^>]*>([^<]+)/i) ||
                     extract(/value="([^"]+)"[^>]*name="[^"]*apellido/i);

    const fnac = extract(/Nacimiento:\s*(?:<\/b>)?\s*([^<]+)/i) || extract(/Fecha de Nacimiento:\s*([^<]+)/i);

    if (nombre || apellido) {
      return res.status(200).json({
        ok: true,
        result: {
          nombre: (nombre || "DESCONOCIDO").toUpperCase(),
          apellido: (apellido || "").toUpperCase(),
          cedula: cleanCI,
          fecha_nacimiento: fnac || "N/A",
          sexo: extract(/Sexo:\s*(?:<\/b>)?\s*([^<]+)/i) || "N/A",
          estado_civil: "N/A"
        }
      });
    }

    // Si llegamos aquí y hay código de script, es que la sesión realmente no tiene acceso
    if (rawText.includes("window.onload")) {
      return res.status(401).json({ 
        ok: false, 
        mensaje: "ERROR DE SESIÓN: GFV te está bloqueando. Por favor, actualiza la variable GFV_COOKIE en Vercel con un PHPSESSID nuevo.",
        debug: rawText.substring(0, 300)
      });
    }

    return res.status(502).json({ 
      ok: false, 
      mensaje: "Datos no encontrados para esta CI.",
      debug: rawText.substring(0, 400).replace(/</g, "&lt;")
    });

  } catch (e: any) {
    return res.status(500).json({ ok: false, mensaje: "Error crítico: " + e.message });
  }
}
