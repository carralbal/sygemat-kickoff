// Vercel Serverless Function — Process meeting transcripts with Claude API
// POST /api/process-transcript  { transcript: "..." }

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { transcript } = req.body || {};
  if (!transcript || typeof transcript !== "string" || transcript.trim().length < 20) {
    return res.status(400).json({ error: "Transcript too short or missing" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "API key not configured" });
  }

  const systemPrompt = `Sos un asistente experto en implementación de software ERP para corralones (materiales de construcción) en Argentina. Tu tarea es analizar transcripciones de reuniones comerciales o de kickoff y extraer información estructurada para completar una guía de kickoff de implementación del sistema SYGEMAT.

Analizá la transcripción y extraé SOLO la información que efectivamente aparezca. No inventes ni asumas datos. Si un campo no tiene información en la transcripción, dejalo como string vacío "".

Devolvé ÚNICAMENTE un JSON válido (sin markdown, sin backticks, sin explicaciones) con esta estructura exacta:

{
  "clientName": "Nombre de la empresa cliente",
  "contactName": "Nombre del contacto principal",
  "perfilCliente": "FLUYE o ACOMPAÑA o RESISTE o vacío si no se puede determinar",
  "implementador": "Nombre del implementador de SYGEMAT si se menciona",
  "sistemaActual": "Qué sistema/s usa el cliente hoy (Excel, otro software, cuadernos, etc)",
  "vendido": "Qué se vendió: módulos, usuarios, integraciones",
  "fueraAlcance": "Qué NO está incluido en esta etapa",
  "compromisos": "Compromisos comerciales ya instalados",
  "dificultadVenta": "Dificultades durante la venta",
  "motivoCompra": "Por qué decidieron avanzar ahora con un ERP",
  "dolor1": "Dolor principal #1 (una frase corta)",
  "dolor2": "Dolor principal #2 (una frase corta)",
  "dolor3": "Dolor principal #3 (una frase corta)",
  "impacto": "Dónde pierden tiempo, control o plata",
  "sensibilidades": "Resistencias, tensiones, personas o temas delicados",
  "criterioExito": "Qué tiene que pasar para que el cliente sienta valor",
  "alertas": "Promesas o expectativas que conviene reencuadrar",
  "rolSuperUser": "Quién va a dominar el sistema (nombre y rol)",
  "rolArticulos": "Quién carga artículos (nombre y rol)",
  "rolContable": "Quién maneja la parte contable (nombre y rol)",
  "obsProcesoActual": "Observaciones sobre cómo trabaja el cliente hoy",
  "obsValidacion": "Cambios o novedades respecto a la conversación comercial",
  "acuerdos": "Acuerdos cerrados en la reunión",
  "pendientes": "Pendientes con responsable y fecha si se mencionan",
  "proximoPaso": "Próximo paso inmediato acordado",
  "notasCierre": "Observaciones generales adicionales",
  "cadencia": "Semanal o Bisemanal o Según necesidad — solo si se menciona"
}

IMPORTANTE:
- Respondé SOLO con el JSON, nada más
- No uses backticks ni markdown
- Si algo no se menciona, dejá el string vacío ""
- Para perfilCliente, evaluá el tono general del cliente en la reunión
- Para dolores, intentá resumir en frases cortas y concretas
- Para cadencia, solo completá si se habla explícitamente de frecuencia de reuniones`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-5-5",
        max_tokens: 4096,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `Analizá esta transcripción de reunión y extraé la información para el kickoff de SYGEMAT:\n\n${transcript.slice(0, 50000)}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error("Anthropic API error:", response.status, errBody);
      return res.status(502).json({ error: `API error: ${response.status}` });
    }

    const result = await response.json();
    console.log("API result keys:", Object.keys(result), "stop_reason:", result.stop_reason, "content length:", result.content?.length);
    if (result.content?.[0]) {
      console.log("content[0] type:", result.content[0].type, "has text:", !!result.content[0].text);
    }
    const text = result.content?.[0]?.text || "";
    console.log("AI response length:", text.length, "first 300 chars:", text.slice(0, 300));

    if (!text) {
      console.error("Empty response from API. Full result:", JSON.stringify(result).slice(0, 1000));
      return res.status(500).json({
        error: "La API devolvió una respuesta vacía. Intentá de nuevo.",
        debug: { stop_reason: result.stop_reason, content_types: result.content?.map(c => c.type) }
      });
    }

    // Parse the JSON from Claude's response
    let extracted;
    try {
      // Try direct parse first
      extracted = JSON.parse(text);
    } catch {
      try {
        // Strip markdown code fences if present
        let cleaned = text.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "");
        // Try to find JSON object in the response
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          extracted = JSON.parse(jsonMatch[0]);
        } else {
          return res.status(500).json({ error: "Could not parse AI response", raw: text.slice(0, 500) });
        }
      } catch (parseErr) {
        return res.status(500).json({ error: "JSON parse failed: " + parseErr.message, raw: text.slice(0, 500) });
      }
    }

    return res.status(200).json({ success: true, data: extracted });
  } catch (err) {
    console.error("Process transcript error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
}
