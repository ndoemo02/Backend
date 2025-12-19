// utils/keepAlive.js — utrzymuje funkcję Vercel „ciepłą” i loguje latency
// Działa tylko w production; brak zależności od OpenAI/Supabase

const isProd = process.env.NODE_ENV === "production";

(async () => {
  if (!isProd) return;

  // Prosta ochrona przed duplikacją (np. wielokrotne importy)
  if (globalThis.__freeflow_keepalive_timer) {
    return; // już działa
  }

  // Preferuj node-fetch (zgodnie z wymaganiem), ale miej fallback na global fetch (Node 18+)
  let fetchFn = (typeof fetch === 'function') ? fetch : null;
  try {
    const mod = await import('node-fetch');
    fetchFn = mod.default;
  } catch (e) {
    // fallback: global fetch
  }

  if (!fetchFn) return; // środowisko bez fetch — nie uruchamiaj pętli

  const baseFromEnv = process.env.VERCEL_URL || "https://freeflow-backend.vercel.app";
  const base = baseFromEnv.startsWith("http") ? baseFromEnv : `https://${baseFromEnv}`;
  const url = `${base}/api/ping`;

  // Ostatnie 10 pomiarów
  const last = [];
  const pushSample = (ms) => {
    last.push(ms);
    while (last.length > 10) last.shift();
  };
  const stats = () => {
    if (last.length === 0) return { avg: 0, min: 0, max: 0 };
    let sum = 0, min = Infinity, max = -Infinity;
    for (const v of last) { sum += v; if (v < min) min = v; if (v > max) max = v; }
    return { avg: Math.round(sum / last.length), min: Math.round(min), max: Math.round(max) };
  };

  const ping = async () => {
    const t0 = Date.now();
    const nowIso = new Date().toISOString();
    try {
      const res = await fetchFn(url, { method: 'GET' });
      const dt = Date.now() - t0;
      if (res.ok) {
        pushSample(dt);
        const s = stats();
        console.log(`[KEEPALIVE] Pong OK (${dt}ms) | Avg: ${s.avg}ms | Min: ${s.min} | Max: ${s.max}`);
      } else {
        console.log(`[KEEPALIVE] ❌ Error: ${res.status} ${res.statusText} (${nowIso})`);
      }
    } catch (err) {
      console.log(`[KEEPALIVE] ❌ Error: ${err?.code || err?.message || String(err)} (${nowIso})`);
    }
  };

  // Pierwszy ping po krótkim opóźnieniu, kolejne co 120s (asynchronicznie)
  setTimeout(ping, 2000);
  globalThis.__freeflow_keepalive_timer = setInterval(async () => { await ping(); }, 120 * 1000);
})();


