// --- FreeFlow Serverless Adapter for Vercel ---
// NOTE: On Vercel, key endpoints have dedicated serverless handlers (see vercel.json).
// This Express app serves as the catch-all and local dev entrypoint.
// Serverless files: api/health.js, api/voice/live/{health,tools,tool-call}.js
import { config } from 'dotenv';
try { config(); } catch (e) { console.warn('dotenv missing, assuming env vars present'); }

import express from 'express';
import cors from 'cors';
// import morgan from 'morgan'; // Disabled for stability debugging
import {
  privateServerClient,
  assertPrivateServerConfig,
  describePrivateServerConfig,
} from './_supabase.js';
import {
  publicCatalogClient,
  assertPublicCatalogConfig,
  describePublicCatalogConfig,
} from './_supabaseCatalog.js';
import fs from 'fs';
import { verifyAmberAdmin } from './middleware/verifyAmberAdmin.js';
import adminRouter from './admin/adminRouter.js';
import { registerLiveRoutes, attachLiveGateway } from './voice/live/index.js';

// 🧠 Debug mode must be opt-in via env (avoid leaking conversation data in logs)
global.BRAIN_DEBUG = process.env.BRAIN_DEBUG === 'true';

// --- App setup ---
const app = express();
app.use(express.json());

// CORS — MUST be before any route registration
const CORS_ORIGINS_PROD = [
  'https://freeflow-frontend-seven.vercel.app',
  'https://freeflow-frontend.vercel.app',
  'https://freeflow-final.vercel.app',
  'https://backend-hrth4zsvt-freeflow-build.vercel.app'
];
const CORS_ORIGINS_DEV = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'https://backend-hrth4zsvt-freeflow-build.vercel.app'
];

function parseConfiguredOrigins(...values) {
  return values
    .flatMap((value) => String(value || '').split(','))
    .map((value) => value.trim().replace(/\/+$/, ''))
    .filter((value) => {
      if (!value) return false;
      try {
        const parsed = new URL(value);
        return parsed.protocol === 'https:' || parsed.protocol === 'http:';
      } catch {
        return false;
      }
    });
}

const CONFIGURED_CORS_ORIGINS = parseConfiguredOrigins(
  process.env.CORS_ALLOWED_ORIGINS,
  process.env.LIVE_ALLOWED_ORIGINS,
  process.env.FRONTEND_URL,
  process.env.APP_URL,
  process.env.WEB_URL,
  process.env.VITE_FRONTEND_URL,
);
const DEFAULT_CORS_ORIGINS = process.env.NODE_ENV === 'production'
  ? CORS_ORIGINS_PROD
  : [...CORS_ORIGINS_PROD, ...CORS_ORIGINS_DEV];
const ALLOWED_ORIGINS = Array.from(new Set([
  ...DEFAULT_CORS_ORIGINS,
  ...CONFIGURED_CORS_ORIGINS,
]));

app.use(cors({
  origin: ALLOWED_ORIGINS,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-token'],
  exposedHeaders: ['x-admin-token']
}));

app.options(/.*/, (req, res) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    return res.status(403).end();
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-token');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.status(200).end();
});
// app.use(morgan('tiny'));

// Routes — registered AFTER CORS middleware
registerLiveRoutes(app);

// --- Env sanity ---
console.log('🚀 Booting FreeFlow Serverless...');
console.log('🧠 ENV OK');
console.log('🔑 SUPABASE_URL:', process.env.SUPABASE_URL ? '✅' : '❌');
console.log('🔑 SUPABASE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅' : '❌');

async function runStartupHealthReport() {
  const checks = [];
  const pushCheck = (name, ok, detail) => {
    checks.push({ module: name, status: ok ? 'OK' : 'FAIL', detail });
  };

  // T2: raportuj OBA klienty osobno. Wczesniej jeden wpis "requestClient" nie
  // mowil, czy dziala na kluczu anon czy service_role - a to byla cala roznica.
  // describe*() zwraca wylacznie flagi obecnosci, nigdy wartosci sekretow.
  const privateCfg = describePrivateServerConfig();
  const catalogCfg = describePublicCatalogConfig();
  pushCheck('env.SUPABASE_URL', privateCfg.url, privateCfg.url ? 'set' : 'missing');
  pushCheck('supabase.catalogClient (anon)', catalogCfg.catalogKey, catalogCfg.catalogKey ? 'configured' : 'missing anon key');
  pushCheck('supabase.privateClient (service_role)', privateCfg.serviceKey, privateCfg.serviceKey ? 'configured' : 'missing service role key');

  const googleCredPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const gcpProjectId =
    process.env.GCP_PROJECT_ID ||
    process.env.GOOGLE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT;
  const gcpLocation =
    process.env.GCP_LOCATION ||
    process.env.GOOGLE_VERTEX_LOCATION ||
    process.env.GCLOUD_LOCATION ||
    process.env.GOOGLE_CLOUD_LOCATION;
  pushCheck(
    'env.GOOGLE_APPLICATION_CREDENTIALS',
    Boolean(googleCredPath),
    googleCredPath ? googleCredPath : 'missing'
  );
  pushCheck(
    'google.credentials.file',
    Boolean(googleCredPath) && fs.existsSync(googleCredPath),
    googleCredPath ? (fs.existsSync(googleCredPath) ? 'found' : 'not found') : 'skipped'
  );
  pushCheck('env.GCP_PROJECT_ID', Boolean(gcpProjectId), gcpProjectId ? gcpProjectId : 'missing');
  pushCheck('env.GCP_LOCATION', Boolean(gcpLocation), gcpLocation ? gcpLocation : 'missing');
  pushCheck('env.OPENAI_API_KEY', Boolean(process.env.OPENAI_API_KEY), process.env.OPENAI_API_KEY ? 'set' : 'missing');

  const moduleChecks = [
    ['brainV2', './brain/brainV2.js'],
    ['pipeline', './brain/core/pipeline.js'],
    ['nlu.router', './brain/nlu/router.js'],
    ['orderHandler', './brain/domains/food/orderHandler.js'],
    ['ttsClient', './brain/tts/ttsClient.js'],
    ['sessionAdapter', './brain/session/sessionAdapter.js'],
  ];

  for (const [name, modulePath] of moduleChecks) {
    try {
      await import(modulePath);
      pushCheck(`module.${name}`, true, 'import ok');
    } catch (err) {
      pushCheck(`module.${name}`, false, err?.message || 'import failed');
    }
  }

  console.log('[STARTUP_HEALTH] Module readiness report');
  console.table(checks);

  const failed = checks.filter((check) => check.status === 'FAIL');
  if (failed.length > 0) {
    console.warn(`[STARTUP_HEALTH] Degraded startup: ${failed.length}/${checks.length} checks failed.`);
  } else {
    console.log(`[STARTUP_HEALTH] All checks passed (${checks.length}/${checks.length}).`);
  }
}

// --- Supabase client ---
// ===========================================================================
// T2 (etap 2 z SS9): dwa jawne klienty Supabase zamiast jednego anon-first.
//
// Przed zmiana ten modul budowal JEDEN klient w kolejnosci
//   SUPABASE_ANON_KEY || SUPABASE_KEY || SUPABASE_SERVICE_ROLE_KEY
// czyli anon-first, i uzywal go zarowno do katalogu, jak i do orders oraz
// amber_intents. Rownolegle tworzyl `supabaseAdmin`, ktorego NIC w repo nie
// importowalo - martwy kod. Blok catch podmienial klienta na zaslepke
// zwracajaca pusta tablice, wiec awaria konfiguracji wygladala jak
// "brak danych" zamiast jak blad.
//
// Teraz:
//   publicCatalogClient  (klucz anon)   -> wylacznie restaurants / menu
//   privateServerClient  (service_role) -> orders, RPC, amber_intents
// Zaslepki nie ma: blad konfiguracji ma byc bledem, nie pusta lista.
// ===========================================================================

const IS_TEST_RUNTIME = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);

if (!IS_TEST_RUNTIME) {
  // Fail-fast przy starcie procesu serwujacego. Na Vercelu (serverless) nie ma
  // innego momentu startu niz zaladowanie tego modulu, wiec asercja stoi tutaj.
  // Sciezka testowa jest pominieta SWIADOMIE: dziewiec plikow testowych
  // importuje `app` z tego modulu, a vitest.config.js ma setupFiles: [] i nie
  // dostarcza zmiennych Supabase. Pominiecie nie oslabia produkcji - tam
  // NODE_ENV=production i VITEST jest nieustawione.
  assertPrivateServerConfig();
  assertPublicCatalogConfig();
}

export { privateServerClient, publicCatalogClient };

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
    // Health probe dotyka wylacznie katalogu publicznego -> klient anon.
    const { data, error } = await publicCatalogClient.from('restaurants').select('id').limit(1);
    const t1 = performance.now();
    if (error) throw error;
    health.supabase.ok = true;
    health.supabase.time = `${(t1 - t0).toFixed(1)} ms`;
  } catch (err) {
    health.ok = false;
    health.supabase.error = err.message;
    console.error('Health check failed:', err);
  }
  res.status(health.ok ? 200 : 500).json(health);
});

// ... (rest of endpoints)

// ... (rest of endpoints)

// --- KeepAlive removed ---

// --- Environment check ---
app.get('/api/env-check', (req, res) => {
  res.json({
    SUPABASE_URL: !!process.env.SUPABASE_URL,
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    NODE_ENV: process.env.NODE_ENV
  });
});

// === AMBER BRAIN V2 ONLY ===
// DEPRECATED V1 — returns 410 Gone. Use /api/brain/v2
app.post("/api/brain", (req, res) => {
  res.status(410).json({
    ok: false,
    error: 'deprecated',
    message: 'This endpoint is retired. Use /api/brain/v2'
  });
});

// Explicit V2 Endpoint
app.post("/api/brain/v2", async (req, res) => {
  try {
    const brainV2 = await import("./brain/brainV2.js");
    return brainV2.default(req, res);
  } catch (error) {
    console.error("❌ Brain V2 error:", error);
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

// DEPRECATED V1 ROUTER — returns 410 Gone. Use /api/brain/v2
app.post("/api/brain/router", (req, res) => {
  res.status(410).json({
    ok: false,
    error: 'deprecated',
    message: 'This endpoint is retired. Use /api/brain/v2'
  });
});

// === ADMIN ENDPOINTS ===
// Protect all /api/admin routes
app.use('/api/admin', verifyAmberAdmin);

// 🆕 Clean Admin API Router (READ-ONLY)
// Provides: GET /restaurants, /restaurants/:id/menu, /conversations, /conversations/:sessionId, /orders, /orders/:id
app.use('/api/admin', adminRouter);

app.get('/api/admin/system-status', async (req, res) => {
  try {
    const mod = await import('./admin/system-status.js');
    return mod.default(req, res);
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

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

app.delete('/api/admin/conversations', async (req, res) => {
  try { const mod = await import('./admin/conversations-clear.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/admin/conversation', async (req, res) => {
  try { const mod = await import('./admin/conversation.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.delete('/api/admin/conversation', async (req, res) => {
  try {
    const { supabase } = await import('./_supabase.js');
    const id = req.query.id;
    if (!id) return res.status(400).json({ ok: false, error: 'missing_id' });

    // Delete events first due to FK
    await supabase.from('conversation_events').delete().eq('conversation_id', id);
    const { error } = await supabase.from('conversations').delete().eq('id', id);

    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/admin/business-stats', async (req, res) => {
  try { const mod = await import('./admin/business-stats.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/admin/system-status', async (req, res) => {
  try { const mod = await import('./admin/system-status.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/admin/restaurants', async (req, res) => {
  try { const mod = await import('./admin/restaurants.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/admin/business/stats', async (req, res) => {
  try { const mod = await import('./admin/business-stats.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/admin/intents', async (req, res) => {
  try { const mod = await import('./admin/intents.js'); return mod.default(req, res); }
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

app.get('/api/admin/amber/restaurants-activity', async (req, res) => {
  try { const mod = await import('./admin/amber-restaurants-activity.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/admin/amber/learning-stats', async (req, res) => {
  try { const mod = await import('./admin/amber-learning-stats.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/admin/trends/alerts', async (req, res) => {
  try { const mod = await import('./admin/trends-alerts.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/admin/prompt', async (req, res) => {
  try { const mod = await import('./admin/prompt.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.post('/api/admin/prompt', async (req, res) => {
  try { const mod = await import('./admin/prompt.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/admin/config/stylization', async (req, res) => {
  try { const mod = await import('./admin/stylization.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.post('/api/admin/config/stylization', async (req, res) => {
  try { const mod = await import('./admin/stylization.js'); return mod.default(req, res); }
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
      // SS13.7 pozostaje otwarte (czy get_order_stats ma byc publicznym agregatem).
      // Do czasu decyzji wolamy przez klienta prywatnego - zawezenie, nie rozszerzenie.
      const { data, error } = await privateServerClient.rpc('get_order_stats');
      if (!error && data) return res.status(200).json({ ok: true, stats: data });
    } catch { }

    // Fallback: compute with aggregations (snake_case friendly)
    let totalOrders = 0;
    try {
      const { count } = await privateServerClient.from('orders').select('id', { count: 'exact', head: true });
      totalOrders = count || 0;
    } catch { }

    let totalRevenue = 0;
    try {
      // Prefer total_price, then total_cents/100
      const { data: sumPrice } = await privateServerClient.from('orders').select('sum:total_price');
      if (Array.isArray(sumPrice) && sumPrice[0] && typeof sumPrice[0].sum === 'number') {
        totalRevenue = sumPrice[0].sum;
      } else {
        const { data: sumCents } = await privateServerClient.from('orders').select('sum:total_cents');
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

app.get('/api/admin/system-status', async (req, res) => {
  try { const mod = await import('./admin/system-status.js'); return mod.default(req, res); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
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
app.get('/api/admin/live/metrics', async (req, res) => {
  try { const mod = await import('./admin/live-metrics.js'); return mod.default(req, res); }
  catch (err) { res.status(200).json({ ok: true, liveModel: process.env.GEMINI_LIVE_MODEL || process.env.LIVE_MODEL || 'gemini-2.5-flash-native-audio-preview-12-2025', sessionsOpened: 0, sessionsClosed: 0, reconnects: 0, toolCalls: 0, toolCallsByName: {}, audioFramesSent: 0, audioBytesSent: 0, avgSessionDurationSec: 0, estimatedCostSession: 0, estimatedCostToday: 0, estimatedCostMonth: 0, burnRateLastHour: 0, error: err.message }); }
});
app.get('/api/admin/live/health', async (req, res) => {
  try { const mod = await import('./admin/live-health.js'); return mod.default(req, res); }
  catch (err) { res.status(200).json({ ok: true, truthConsistency: {}, cognitiveLoad: {}, meta: { error: err.message } }); }
});
app.post('/api/admin/live/cognitive-load', async (req, res) => {
  try { const mod = await import('./admin/cognitive-load.js'); return mod.default(req, res); }
  catch (err) { res.status(200).json({ ok: false, error: err.message }); }
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
        // amber_intents to klaster runtime/log (SS7) - nigdy klient anon.
        const { data } = await privateServerClient
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
    // Katalog publiczny -> klient anon. Kolumny zawezone do zatwierdzonego
    // kontraktu PUBLIC restaurants (audyt B1, 2026-08-10) - zgodne z grantem
    // etapu 10 (supabase/migrations/20260808000400_stage10_public_catalog_rls.sql).
    // Ksztalt odpowiedzi { ok, data } bez zmian - to nie jest naprawa kontraktu API.
    const { data, error } = await publicCatalogClient
      .from("restaurants")
      .select("id,name,address,city,cuisine_type,lat,lng,delivery_available,price_level,is_active,taxonomy_groups,taxonomy_cats,taxonomy_tags,image_url")
      .eq("is_active", true);
    if (error) throw error;
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// === ORDERS ===
app.all("/api/orders", async (req, res) => {
  try {
    const ordersHandler = await import("./orders.js");
    return ordersHandler.default(req, res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.all("/api/orders/:id", async (req, res) => {
  try {
    const ordersHandler = await import("./orders.js");
    return ordersHandler.default(req, res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// === ORDER FINALIZE (post-Stripe cleanup) ===
app.post("/api/orders/finalize", async (req, res) => {
  try {
    const finalizeHandler = await import("./orders/finalizeOrder.js");
    return finalizeHandler.default(req, res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// === PAYMENTS (STRIPE TEST MODE) ===
app.post("/api/payments/checkout-session", async (req, res) => {
  try {
    const paymentsHandler = await import("./payments/checkout-session.js");
    return paymentsHandler.default(req, res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/payments/verify-session", async (req, res) => {
  try {
    const paymentsHandler = await import("./payments/verify-session.js");
    return paymentsHandler.default(req, res);
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
  const server = app.listen(PORT, async () => {
    console.log(`🧠 FreeFlow Brain running locally on http://localhost:${PORT}`);
    if (process.env.LIVE_MODE === 'true') {
      attachLiveGateway(server);
      console.log('🔌 Gemini Live Gateway enabled on /api/voice/live/ws');
    } else {
      console.log('🔌 Gemini Live Gateway disabled (set LIVE_MODE=true to enable)');
    }
    await runStartupHealthReport();
  });
}

// 404 handler (Express 5 style)
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("🔥 Uncaught Error:", err);
  res.status(500).json({ error: 'Internal Server Error', details: err.message, type: err.name });
});

// --- KeepAlive removed for serverless stability ---
// import "./utils/keepAlive.js";
// import "./utils/trendsCron.js";

