// --- FreeFlow Serverless Adapter for Vercel ---
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { createClient } from '@supabase/supabase-js';
import { verifyAmberAdmin } from './middleware/verifyAmberAdmin.js';

// --- App setup ---
const app = express();
app.use(express.json());
// CORS (tuż po dotenv.config): prod = Vercel, dev = localhost:5173
const CORS_ORIGINS_PROD = [
  'https://freeflow-frontend-seven.vercel.app',
  'https://freeflow-frontend.vercel.app'
];
const CORS_ORIGINS_DEV = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000'
];
const ALLOWED_ORIGINS = process.env.NODE_ENV === 'production'
  ? CORS_ORIGINS_PROD
  : [...CORS_ORIGINS_PROD, ...CORS_ORIGINS_DEV];
// Pozwól także na PATCH/DELETE, żeby Panel Klienta mógł aktualizować / anulować zamówienia
app.use(cors({
  origin: ALLOWED_ORIGINS,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
}));
// Express 5: preflight dla wszystkich ścieżek – z tym samym zestawem metod
app.options(/.*/, cors({
  origin: ALLOWED_ORIGINS,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
}));
app.use(morgan('tiny'));

// --- Env sanity ---
console.log('🚀 Booting FreeFlow Serverless...');
console.log('🧠 ENV OK');
console.log('🔑 SUPABASE_URL:', process.env.SUPABASE_URL ? '✅' : '❌');
console.log('🔑 OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '✅' : '❌');

// --- Supabase client ---
export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// --- Health check ---
app.get('/api/health', async (req, res) => {
  const health = {
    ok: true,
    node: process.version,
    service: 'FreeFlow Brain',
    version: process.env.npm_package_version || 'dev',
    timestamp: new Date().toISOString(),
    supabase: { ok: false, time: null }
  };
  try {
    const t0 = performance.now();
    const { data, error } = await supabase.from('restaurants').select('id').limit(1);
    const t1 = performance.now();
    if (error) throw error;
    health.supabase.ok = true;
    health.supabase.time = `${(t1 - t0).toFixed(1)} ms`;
  } catch (err) {
    health.ok = false;
    health.supabase.error = err.message;
  }
  res.json(health);
});

// --- Environment check ---
app.get('/api/env-check', (req, res) => {
  res.json({
    SUPABASE_URL: !!process.env.SUPABASE_URL,
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    NODE_ENV: process.env.NODE_ENV
  });
});

// === AMBER BRAIN ===
app.post("/api/brain", async (req, res) => {
  try {
    const body = req.body || {};
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) {
      return res.status(400).json({ ok: false, error: 'missing_text' });
    }
    const brainRouter = await import("./brain/brainRouter.js");
    return brainRouter.default(req, res);
  } catch (error) {
    console.error("❌ Brain error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 405 dla metod innych niż POST
app.get('/api/brain', (req, res) => {
  res.status(405).json({ ok: false, error: 'method_not_allowed' });
});

// Optional: reset session endpoint
app.post("/api/brain/reset", async (req, res) => {
  try {
    const { getSession } = await import("./brain/context.js");
    const { updateSession } = await import("./brain/context.js");
    const body = req.body || {};
    const sessionId = body.sessionId;
    if (!sessionId) return res.status(400).json({ ok: false, error: 'missing_sessionId' });
    updateSession(sessionId, { expectedContext: null, lastRestaurant: null, pendingOrder: null, last_restaurants_list: null });
    res.json({ ok: true, cleared: true, session: getSession(sessionId) });
  } catch (e) {
    console.error('reset error', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/brain/router", async (req, res) => {
  try {
    const brainRouter = await import("./brain/brainRouter.js");
    return brainRouter.default(req, res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// === ADMIN ENDPOINTS ===
// Protect all /api/admin routes
app.use('/api/admin', verifyAmberAdmin);
app.get('/api/admin/users-count', async (req, res) => {
  try {
    const mod = await import('./admin/users-count.js');
    return mod.default(req, res);
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/admin/partners-count', async (req, res) => {
  try {
    const mod = await import('./admin/partners-count.js');
    return mod.default(req, res);
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.post('/api/admin/backup', async (req, res) => {
  try {
    const mod = await import('./admin/backup.js');
    return mod.default(req, res);
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.patch('/api/admin/tts', async (req, res) => {
  try {
    const mod = await import('./admin/tts.js');
    return mod.default(req, res);
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/admin/intents', async (req, res) => {
  try {
    const mod = await import('./admin/intents.js');
    return mod.default(req, res);
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/admin/restaurants', async (req, res) => {
  try {
    const mod = await import('./admin/restaurants.js');
    return mod.default(req, res);
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});
app.get('/api/admin/amber/restaurants-activity', async (req, res) => {
  try { const mod = await import('./admin/amber-restaurants-activity.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});
app.get('/api/admin/amber/learning-stats', async (req, res) => {
  try { const mod = await import('./admin/amber-learning-stats.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/admin/menu', async (req, res) => {
  try {
    const mod = await import('./admin/menu.js');
    return mod.default(req, res);
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.post('/api/admin/menu', async (req, res) => {
  try {
    const mod = await import('./admin/menu.js');
    return mod.default(req, res);
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/admin/performance', async (req, res) => {
  try { const mod = await import('./admin/performance.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/admin/performance/trends', async (req, res) => {
  try { const mod = await import('./admin/performance-trends.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/admin/performance/top-intents', async (req, res) => {
  try { const mod = await import('./admin/performance-top-intents.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.post('/api/admin/cache/clear', async (req, res) => {
  try { const mod = await import('./admin/cache-clear.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.patch('/api/admin/restaurants/:id', async (req, res) => {
  try {
    const token = req.headers['x-admin-token'] || req.headers['X-Admin-Token'] || req.headers['x-Admin-Token'];
    if (!token || token !== process.env.ADMIN_TOKEN) return res.status(403).json({ ok: false, error: 'forbidden' });
    const { supabase } = await import('./_supabase.js');
    const id = req.params.id;
    const body = req.body || {};
    const { data, error } = await supabase.from('restaurants').update({ is_active: !!body.is_active }).eq('id', id).select('id,is_active').limit(1);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, data: Array.isArray(data) ? data[0] : data });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// === LOGS ===
app.get('/api/logs', async (req, res) => {
  try {
    const mod = await import('./logs.js');
    return mod.default(req, res);
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/admin/intents/export', async (req, res) => {
  try { const mod = await import('./admin/intents-export.js'); return mod.default(req, res); }
  catch (err) { res.status(500).send('error: ' + err.message); }
});
app.get('/api/admin/amber/export', async (req, res) => {
  try { const mod = await import('./admin/amber-export.js'); return mod.default(req, res); }
  catch (err) { res.status(500).send('error: ' + err.message); }
});

app.get('/api/admin/brain-logs', async (req, res) => {
  try { const mod = await import('./admin/brain-logs.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// Conversations V2
app.get('/api/admin/conversations', async (req, res) => {
  try { const mod = await import('./admin/conversations.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/admin/conversation', async (req, res) => {
  try { const mod = await import('./admin/conversation.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// === FREEFUN ENDPOINTS ===
app.get('/api/freefun/list', async (req, res) => {
  try { const mod = await import('./freefun/list.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});
app.post('/api/freefun/add', verifyAmberAdmin, async (req, res) => {
  try { const mod = await import('./freefun/add.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// Orders stats (KPI) — prefers RPC get_order_stats, falls back to aggregations
app.get('/api/admin/orders/stats', async (req, res) => {
  try {
    // Try RPC first
    try {
      const { data, error } = await supabase.rpc('get_order_stats');
      if (!error && data) return res.status(200).json({ ok: true, stats: data });
    } catch { }

    // Fallback: compute with aggregations (snake_case friendly)
    let totalOrders = 0;
    try {
      const { count } = await supabase.from('orders').select('id', { count: 'exact', head: true });
      totalOrders = count || 0;
    } catch { }

    let totalRevenue = 0;
    try {
      // Prefer total_price, then total_cents/100
      const { data: sumPrice } = await supabase.from('orders').select('sum:total_price');
      if (Array.isArray(sumPrice) && sumPrice[0] && typeof sumPrice[0].sum === 'number') {
        totalRevenue = sumPrice[0].sum;
      } else {
        const { data: sumCents } = await supabase.from('orders').select('sum:total_cents');
        if (Array.isArray(sumCents) && sumCents[0] && sumCents[0].sum != null) {
          const v = Number(sumCents[0].sum);
          if (!isNaN(v)) totalRevenue = v / 100;
        }
      }
    } catch { }

    return res.status(200).json({ ok: true, stats: { total_orders: totalOrders, total_revenue: totalRevenue } });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/admin/business/stats', async (req, res) => {
  try { const mod = await import('./admin/business-stats.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.post('/api/admin/trends/analyze', async (req, res) => {
  try { const mod = await import('./admin/trends-analyze.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/admin/trends/alerts', async (req, res) => {
  try { const mod = await import('./admin/trends-alerts.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// --- Amber Control Deck endpoints ---
app.get('/api/admin/config', async (req, res) => {
  try { const mod = await import('./admin/config.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});
app.post('/api/admin/config', async (req, res) => {
  try { const mod = await import('./admin/config.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});
app.get('/api/admin/aliases', async (req, res) => {
  try { const mod = await import('./admin/aliases.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});
app.post('/api/admin/aliases', async (req, res) => {
  try { const mod = await import('./admin/aliases.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});
app.delete('/api/admin/aliases', async (req, res) => {
  try { const mod = await import('./admin/aliases.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});
app.get('/api/admin/live', async (req, res) => {
  try { const mod = await import('./admin/live.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message, data: [] }); }
});
app.get('/api/admin/prompt', async (req, res) => {
  try { const mod = await import('./admin/prompt.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});
app.post('/api/admin/prompt', async (req, res) => {
  try { const mod = await import('./admin/prompt.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// --- Diagnostic test endpoints (Supabase / config visibility) ---
app.get('/api/admin/test/config', async (req, res) => {
  try {
    const mod = await import('./config/configService.js');
    const cfg = await mod.getConfig();
    return res.status(200).json({
      ok: true,
      config: cfg,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/admin/test/prompt', async (req, res) => {
  try {
    const mod = await import('./config/configService.js');
    const prompt = await mod.getPrompt();
    return res.status(200).json({
      ok: true,
      length: typeof prompt === 'string' ? prompt.length : 0,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});
app.get('/api/admin/debug', async (req, res) => {
  try { const mod = await import('./admin/debug.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// --- Hooks ---
app.post('/api/hooks/amber-intent', async (req, res) => {
  try { const mod = await import('./hooks/amber-intent.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// --- SSE: Amber live metrics (latest NLU/DB/TTS)
app.get('/api/amber/live', async (req, res) => {
  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    let closed = false;
    req.on('close', () => { closed = true; });

    const push = async () => {
      if (closed) return;
      try {
        const { data } = await supabase
          .from('amber_intents')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(1);
        if (data && data[0]) {
          const r = data[0];
          const payload = {
            intent: r.intent,
            nlu_ms: r.nlu_ms ?? r.nluMs ?? 0,
            db_ms: r.db_ms ?? r.dbMs ?? 0,
            tts_ms: r.tts_ms ?? r.ttsMs ?? 0,
            duration_ms: r.duration_ms ?? r.durationMs ?? 0,
            created_at: r.created_at || r.timestamp
          };
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
        }
      } catch { }
    };

    const timer = setInterval(push, 2000);
    push();
    req.on('close', () => clearInterval(timer));
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Brain stats (lekki endpoint do testów)
app.get('/api/brain/stats', async (req, res) => {
  try {
    const ctx = await import('./brain/context.js');
    const getSessionsCount = ctx.getSessionsCount || (() => null);
    const count = typeof getSessionsCount === 'function' ? getSessionsCount() : null;
    res.json({ ok: true, sessions: count, timestamp: Date.now() });
  } catch (e) {
    res.json({ ok: true, sessions: null, note: 'stats minimal' });
  }
});

// === PING (keep-alive) ===
app.get('/api/ping', async (req, res) => {
  try {
    const ping = await import('./ping.js');
    return ping.default(req, res);
  } catch (err) {
    const now = new Date().toISOString();
    console.log(`[PING] fallback at ${now}`);
    return res.status(200).json({ ok: true, message: 'keep-alive pong 🧠', timestamp: now });
  }
});

// === TTS Public Endpoint ===
app.post("/api/tts", async (req, res) => {
  try {
    const tts = await import("./tts.js");
    return tts.default(req, res);
  } catch (err) {
    console.error("❌ TTS Endpoint Error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// === RESTAURANTS ===
app.get("/api/restaurants", async (req, res) => {
  try {
    const { data, error } = await supabase.from("restaurants").select("*");
    if (error) throw error;
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// === ORDERS ===
app.get("/api/orders", async (req, res) => {
  try {
    const ordersHandler = await import("./orders.js");
    return ordersHandler.default(req, res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/orders", async (req, res) => {
  try {
    const ordersHandler = await import("./orders.js");
    return ordersHandler.default(req, res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.patch("/api/orders/:id", async (req, res) => {
  try {
    const ordersHandler = await import("./orders.js");
    return ordersHandler.default(req, res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// === MENU ===
app.get("/api/menu", async (req, res) => {
  try {
    const menuHandler = await import("./menu.js");
    return menuHandler.default(req, res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Export handler for Vercel ---
export default app;

// --- KEEP ALIVE FOR LOCAL DEV ---
if (process.env.NODE_ENV !== "production") {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🧠 FreeFlow Brain running locally on http://localhost:${PORT}`);
  });
}

// 404 handler (Express 5 style)
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// --- KeepAlive (prod only) ---
import "./utils/keepAlive.js";
import "./utils/trendsCron.js";

