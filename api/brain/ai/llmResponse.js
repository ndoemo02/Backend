// api/brain/ai/llmResponse.js
import OpenAI from "openai";

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

/**
 * Generator odpowiedzi Amber — styl konwersacyjny, ciepły, logiczny.
 */
export async function llmGenerateReply({ intent, text, context, metadata }) {
    const prompt = `
Jesteś asystentką Amber w systemie FreeFlow.
Twoim zadaniem jest wygenerować naturalną odpowiedź głosową.

Zasady:
- bądź konkretna
- bądź pomocna
- nie zadawaj zbędnych dopytań
- wykorzystuj kontekst
- jeśli użytkownik wybiera restaurację, zapytaj o danie lub pokaż menu
- jeśli pyta o menu, pokaż logicznie co możesz zrobić

Dane wejściowe:
intent: ${intent}
text: ${text}
context: ${JSON.stringify(context)}
metadata: ${JSON.stringify(metadata)}

Wygeneruj 1 krótką, zwięzłą odpowiedź.
  `;

    const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }]
    });

    return response.choices[0].message.content;
}
