// api/brain/ai/llmReasoner.js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * GPT-first Reasoner
 * Decyduje: searchRestaurants / searchMenu / askClarification / completeOrder
 */
export async function llmReasoner({ intent, text, session, parsed }) {
  // 🔥 NEW: Ultra-precise restaurant selection check
  // Priority check: if user provided a specific restaurant name → select it
  const restaurantNameFromLLM = text && /\b(rezydencja|villa|angelo|royal|pizzeria)\b/i.test(text);

  if (parsed?.restaurant || restaurantNameFromLLM) {
    return {
      searchRestaurants: false,
      searchMenu: true,
      askClarification: false,
      completeOrder: false,
      reasoning: "User provided a specific restaurant name → selecting restaurant."
    };
  }

  // 1. Handle select_restaurant intent - save to session
  if (intent === "select_restaurant") {
    if (parsed?.restaurant) {
      session.lastRestaurant = parsed.restaurant;
      console.log('✅ Saved restaurant to session:', parsed.restaurant.name);
    }
  }

  // 2. For menu/cart operations, require lastRestaurant
  if (intent === "show_menu" || intent === "menu_request" || intent === "add_to_cart") {
    const restaurantId = parsed?.restaurant || session.lastRestaurant || null;

    if (!restaurantId) {
      return {
        searchRestaurants: false,
        searchMenu: false,
        askClarification: true,
        completeOrder: false,
        reasoning: "User wants menu/order but no restaurant selected"
      };
    }
  }

  const prompt = `
Jesteś silnikiem decyzyjnym systemu Voice-to-Order "FreeFlow".
Twoim zadaniem jest wybrać jedną lub kilka akcji na podstawie:
- intentu użytkownika
- ostatnich akcji systemu
- bieżącego kontekstu (session)
- tekstu użytkownika

Dostępne akcje:
- search_restaurants (wyszukaj restauracje)
- search_menu (wyszukaj menu dla konkretnej restauracji)
- ask_clarification (zadaj dopytujące pytanie)
- complete_order (finalizuj zamówienie)

Zwróć odpowiedź **WYŁĄCZNIE jako JSON**, np:
{
  "searchRestaurants": true,
  "searchMenu": false,
  "askClarification": false,
  "completeOrder": false,
  "reasoning": "Wybrano X ponieważ..."
}

Dane wejściowe:
intent: ${intent}
text: ${text}
session: ${JSON.stringify(session)}
  `;

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }]
  });

  return JSON.parse(response.choices[0].message.content);
}
