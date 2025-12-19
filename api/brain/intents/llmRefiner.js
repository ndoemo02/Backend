// api/brain/intents/llmRefiner.js
import { OpenAI } from "openai";
import { normalize as normalizeText } from "../utils/normalizeText.js";

const client =
  process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

export async function refineIntentLLM({ text, coarseIntent, session }) {
  const normalized = normalizeText(text || "");
  const IS_TEST = !!(process.env.VITEST || process.env.VITEST_WORKER_ID || process.env.NODE_ENV === 'test');

  if (!client || (IS_TEST && process.env.FORCE_LLM_TEST !== 'true')) {
    return {
      intent: coarseIntent || "none",
      targetRestaurant: null,
      targetItems: null,
      action: null,
      quantity: null,
      confidence: 0.3,
      text,
    };
  }

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: `
Jesteś modułem analizującym intencje użytkownika dla systemu zamawiania jedzenia.
Zwracaj TYLKO JSON. Bez wyjaśnień.

Dopuszczalne pola:
{
  "intent": string,
  "targetRestaurant": string | null,
  "targetItems": string[] | null,
  "quantity": number | null,
  "action": string | null,
  "confidence": number
}
`
        },
        {
          role: "user",
          content: JSON.stringify({
            text: normalized,
            coarseIntent,
            lastRestaurant: session?.lastRestaurant || null,
            cart: session?.cart || null
          })
        }
      ],
    });

    const raw = response.choices?.[0]?.message?.content ?? "{}";

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.warn("LLM returned invalid JSON → falling back:", raw);
      parsed = { intent: "unknown" };
    }

    return {
      intent: parsed.intent || "unknown",
      targetRestaurant: parsed.targetRestaurant || null,
      targetItems: parsed.targetItems || null,
      quantity: parsed.quantity || null,
      action: parsed.action || null,
      confidence: parsed.confidence ?? 0.6,
    };

  } catch (err) {
    console.error("LLM REFINER ERROR:", err);
    return {
      intent: "unknown",
      targetRestaurant: null,
      targetItems: null,
      quantity: null,
      action: null,
      confidence: 0.2,
    };
  }
}
