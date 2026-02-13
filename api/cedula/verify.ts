
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, mensaje: "Method not allowed" });

  try {
    const { cedula } = req.body;
    const VERIFY_URL = process.env.GFV_VERIFY_URL;

    if (!cedula) return res.status(400).json({ ok: false, mensaje: "Cédula requerida" });
    if (!VERIFY_URL) return res.status(500).json({ ok: false, mensaje: "Variable GFV_VERIFY_URL no configurada en Vercel" });

    // Preparar el cuerpo de la petición como lo hace el panel de GFV
    const formData = new URLSearchParams();
    formData.append("documento", String(cedula).replace(/\D/g, ""));
    formData.append("data[origen]", "crm");
    formData.append("data[accion]", "verificar_identidad");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch(VERIFY_URL, {
        method: "POST",
        headers: {
          "Accept": "application/json, text/javascript, */*; q=0.01",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
          "Referer": "https://app.gfv.com.py/",
          "Origin": "https://app.gfv.com.py"
        },
        body: formData,
        signal: controller.signal
      });

      const data = await response.json();

      // Mapeamos la respuesta para que el frontend la entienda fácilmente
      // GFV suele devolver los datos en un objeto 'data' o directamente
      const result = data.data || data;

      return res.status(200).json({
        ok: true,
        result: {
          nombre: result.nombres || result.nombre || result.full_name || "No encontrado",
          apellido: result.apellidos || result.apellido || "",
          cedula: cedula,
          fecha_nacimiento: result.fecha_nacimiento || result.nacimiento || "N/A",
          sexo: result.sexo || "N/A",
          estado_civil: result.estado_civil || "N/A",
          datos_crudos: result // Guardamos todo por si acaso
        }
      });

    } catch (e: any) {
      return res.status(502).json({ ok: false, mensaje: "GFV no respondió a tiempo o el token es inválido." });
    } finally {
      clearTimeout(timeout);
    }
  } catch (e: any) {
    return res.status(500).json({ ok: false, mensaje: "Error interno: " + e.message });
  }
}
