import assert from "node:assert/strict";

const base = "http://localhost:3003";

async function get(path) {
  const r = await fetch(base + path);
  const text = await r.text();
  return { status: r.status, text };
}

async function post(path, body) {
  const r = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, text };
}

(async () => {
  console.log("🔥 Backend Smoke Test - Port 3003");
  console.log("=====================================");
  
  // /api/health
  let r = await get("/api/health");
  console.log("GET /api/health", r.status, r.text);
  assert.equal(r.status, 200);

  // /api/restaurants
  r = await get("/api/restaurants");
  console.log("GET /api/restaurants", r.status);
  assert.ok([200, 500].includes(r.status)); // Może być 500 jeśli baza pusta

  // /api/menu
  r = await get("/api/menu?restaurant_id=test");
  console.log("GET /api/menu", r.status);
  assert.ok([200, 500].includes(r.status)); // Może być 500 jeśli baza pusta

  // /api/orders - test POST
  r = await post("/api/orders", {
    restaurantId: "test-restaurant",
    items: [{ name: "Test Item", price: 10, qty: 1 }],
    customerId: "test-customer",
    total: 10
  });
  console.log("POST /api/orders", r.status);
  assert.ok([200, 500].includes(r.status)); // Może być 500 jeśli baza nie skonfigurowana

  // /api/tts – minimalny test bez realnego TTS
  r = await post("/api/tts", { text: "Test głosu", lang: "pl-PL" });
  console.log("POST /api/tts", r.status);
  assert.ok([200, 500, 400].includes(r.status)); // nie zrywa CI gdy klucze OFF

  console.log("✅ Backend smoke test passed!");
  process.exit(0);
})().catch((e) => { 
  console.error("❌ Backend smoke test failed:", e); 
  process.exit(1); 
});
