import { describe, it, expect } from "vitest";

const API_URL = "http://localhost:3000/api/brain";

async function postBrain(payload) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return res;
}

describe("🧩 Amber Brain - Fallback Layer", () => {
  it("should handle empty or invalid requests gracefully", async () => {
    const res = await postBrain({ sessionId: "test-fb", text: "" });
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect((data.reply || "")).toMatch(/spróbuj|net|jeszcze/i);
  });

  it("should warn when no location detected", async () => {
    const res = await postBrain({ sessionId: "test-fb", text: "Zamów coś" });
    const data = await res.json();
    expect((data.reply || "")).toMatch(/Brak lokalizacji|podaj|miasto/i);
  });

  it("should recover from unknown intent", async () => {
    const res = await postBrain({ sessionId: "test-fb", text: "ghjkloikjh" });
    const data = await res.json();
    expect(!!data.ok).toBeTruthy();
    expect((data.reply || "")).toMatch(/spróbuj|jeszcze/i);
  });
});





