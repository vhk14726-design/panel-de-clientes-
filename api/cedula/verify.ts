import type { VercelRequest, VercelResponse } from "@vercel/node";

function isCedulaValid(value: string) {
  const v = String(value || "").replace(/\D/g, "");
  return v.length >= 6;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, mensaje: "Method not allowed" });
  }

  try {
    // Body puede venir como string o JSON dependiendo de la configuración de Vercel
    const bodyObj = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { cedula } = bodyObj;

    if (!cedula || !isCedulaValid(cedula)) {
      return res.status(400).json({ ok: false, mensaje: "Cédula inválida" });
    }

    const VERIFY_URL = process.env.GFV_VERIFY_URL;
    if (!VERIFY_URL) {
      return res.status(500).json({ ok: false, mensaje: "Falta GFV_VERIFY_URL en Vercel" });
    }

    // Replica el payload del sistema original (jQuery x-www-form-urlencoded)
    const form = new URLSearchParams();
    form.set("documento", String(cedula).trim());
    form.set("data[origen]", "cliente");
    form.set("data[verificar]", VERIFY_URL);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s

    try {
      const r = await fetch(VERIFY_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "Accept": "application/json, text/plain, */*",
          "User-Agent": "Mozilla/5.0",
          "Referer": "https://app.gfv.com.py/",
          "Origin": "https://app.gfv.com.py",
        },
        body: form,
        signal: controller.signal,
      });

      const text = await r.text();
      let result: any;
      try { 
        result = JSON.parse(text); 
      } catch { 
        result = { raw: text, providerStatus: r.status }; 
      }

      return res.status(200).json({ ok: true, providerStatus: r.status, result });
    } catch (e: any) {
      if (e?.name === "AbortError") {
        return res.status(504).json({ ok: false, mensaje: "GFV tardó demasiado (Timeout 20s)" });
      }
      return res.status(502).json({ ok: false, mensaje: e?.message || "Error consultando GFV" });
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (e: any) {
    return res.status(500).json({ ok: false, mensaje: e?.message || "Error interno" });
  }
}