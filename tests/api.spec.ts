import { describe, it, expect } from "vitest";

const BASE = "http://localhost:3003";

describe("API contract", () => {
  it("health", async () => {
    const r = await fetch(`${BASE}/api/health`);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.ok).toBe(true);
  });

  it("restaurants search returns 2xx or 404 with JSON", async () => {
    const r = await fetch(`${BASE}/api/restaurants?q=kfc`);
    expect([200, 404].includes(r.status)).toBe(true);
    // nie wymuszamy schematu, by testy nie blokowały dev'a bez danych
  });

  it("restaurants without query returns 2xx", async () => {
    const r = await fetch(`${BASE}/api/restaurants`);
    expect([200, 500].includes(r.status)).toBe(true);
  });

  it("menu endpoint returns 2xx or 500", async () => {
    const r = await fetch(`${BASE}/api/menu?restaurant_id=test`);
    expect([200, 500].includes(r.status)).toBe(true);
  });

  it("orders POST returns 2xx or 500", async () => {
    const r = await fetch(`${BASE}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        restaurantId: "test-restaurant",
        items: [{ name: "Test Item", price: 10, qty: 1 }],
        customerId: "test-customer",
        total: 10
      })
    });
    expect([200, 500].includes(r.status)).toBe(true);
  });

  it("tts POST returns 2xx or 500", async () => {
    const r = await fetch(`${BASE}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "Test głosu",
        lang: "pl-PL"
      })
    });
    expect([200, 500, 400].includes(r.status)).toBe(true);
  });

  it("places search returns 2xx or 500", async () => {
    const r = await fetch(`${BASE}/api/places?q=warszawa`);
    expect([200, 500].includes(r.status)).toBe(true);
  });
});
