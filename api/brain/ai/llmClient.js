
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

export async function callLLM({ system, user, jsonMode = false, model = "gpt-4o-mini" }) {
    if (!process.env.OPENAI_API_KEY) return null;

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 6000); // 6s timeout

    try {
        const body = {
            model,
            messages: [
                { role: "system", content: system },
                { role: "user", content: user }
            ],
            temperature: 0.1
        };
        if (jsonMode) body.response_format = { type: "json_object" };

        const res = await fetch(OPENAI_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify(body),
            signal: controller.signal
        });

        clearTimeout(id);
        if (!res.ok) return null;

        const data = await res.json();
        return data.choices?.[0]?.message?.content || null;
    } catch (e) {
        clearTimeout(id);
        console.warn("⚠️ LLM Call failed:", e.message);
        return null;
    }
}
