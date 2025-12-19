// /api/brain/amber.js - Amber Brain v2 with Adaptive Tone (Simplified)
import { AMBER_ADAPTIVE_PROMPT } from "../../lib/promptAmberAdaptive.js";
import { getSession, updateSession } from "./context.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = await req.json?.() || req.body || {};
    const { text, sessionId = "default" } = body;

    if (!text) {
      return res.status(400).json({ ok: false, error: "missing_text" });
    }

    // 🔹 Pobierz zapisany kontekst
    const previous = getSession(sessionId);

    // 🔹 Interpretacja nowego zapytania
    const tone = previous?.tone || "neutralny";
    const restaurant = previous?.lastRestaurant || "brak danych";

    const completion = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `Jesteś Amber, asystentką FreeFlow. Użytkownik rozmawia w tonie: ${tone}. Ostatnia restauracja: ${restaurant}. Odpowiadaj naturalnie i krótko.`,
          },
          { role: "user", content: text },
        ],
      }),
    });

    const data = await completion.json();
    const reply = data.choices?.[0]?.message?.content || "Nie rozumiem, możesz powtórzyć?";

    // 🔹 Aktualizacja kontekstu sesji
    updateSession(sessionId, {
      lastIntent: "reply",
      lastMessage: text,
      tone,
    });

    return res.status(200).json({ ok: true, reply });
  } catch (err) {
    console.error("Amber error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}