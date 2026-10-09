// Vercel Serverless Function — Process meeting transcripts with Claude API
// POST /api/process-transcript  { transcript: "..." }

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

async function callAnthropic(apiKey, transcript) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
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
    throw new Error(`API error: ${response.status}`);
  }

  const result = await response.json();
  console.log("API stop_reason:", result.stop_reason, "content blocks:", result.content?.length, "usage:", JSON.stringify(result.usage));

  // Find the text block in content (could be mixed with other types)
  const textBlock = result.content?.find((b) => b.type === "text");
  const text = textBlock?.text || "";

  if (!text) {
    console.error("Empty text in API response. Full result:", JSON.stringify(result).slice(0, 2000));
    throw new Error("API returned empty text");
  }

  if (result.stop_reason === "max_tokens") {
    console.warn("Response was truncated (max_tokens). Text length:", text.length);
  }

  return text;
}

function parseJSON(text) {
  // Try direct parse
  try {
    return JSON.parse(text);
  } catch {
    // continue to fallback
  }

  // Strip markdown code fences
  let cleaned = text.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "").trim();

  // Try to find and parse a JSON object
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      // continue to truncation repair
    }
  }

  // Last resort: try to repair truncated JSON by closing open braces/quotes
  let repaired = cleaned;
  if (!repaired.endsWith("}")) {
    // Remove any trailing incomplete key-value pair
    repaired = repaired.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"]*$/, "");
    // Close the object
    if (!repaired.endsWith("}")) {
      // Close any open string
      const quoteCount = (repaired.match(/(?<!\\)"/g) || []).length;
      if (quoteCount % 2 !== 0) repaired += '"';
      repaired += "}";
    }
  }

  try {
    return JSON.parse(repaired);
  } catch (e) {
    throw new Error(`JSON parse failed: ${e.message}`);
  }
}

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

  // Retry up to 2 times on transient failures
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      console.log(`Attempt ${attempt}: calling Anthropic API (transcript: ${transcript.length} chars)`);
      const text = await callAnthropic(apiKey, transcript);
      console.log("AI response length:", text.length, "first 200 chars:", text.slice(0, 200));

      const extracted = parseJSON(text);
      console.log("Successfully parsed JSON with", Object.keys(extracted).length, "fields");

      return res.status(200).json({ success: true, data: extracted });
    } catch (err) {
      console.error(`Attempt ${attempt} failed:`, err.message);
      lastError = err;

      // Don't retry on non-transient errors
      if (err.message.includes("API error: 4")) break; // 4xx errors
      if (attempt < 2) {
        console.log("Retrying in 1s...");
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  return res.status(500).json({
    error: lastError?.message || "Error procesando la transcripción",
    raw: lastError?.message?.includes("parse") ? undefined : undefined,
  });
}
