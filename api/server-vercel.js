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
import { registerLiveRoutes, attachLiveGateway } from './voice/live/index.js';
import { validateSessionId } from './brain/session/sessionIdContract.js';

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
// telemetrii. Rownolegle tworzyl `supabaseAdmin`, ktorego NIC w repo nie
// importowalo - martwy kod. Blok catch podmienial klienta na zaslepke
// zwracajaca pusta tablice, wiec awaria konfiguracji wygladala jak
// "brak danych" zamiast jak blad.
//
// Teraz:
//   publicCatalogClient  (klucz anon)   -> wylacznie restaurants / menu
//   privateServerClient  (service_role) -> orders, RPC
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
    const sessionIdVerdict = validateSessionId(body.session_id || body.sessionId);
    if (!sessionIdVerdict.ok) return res.status(400).json({ ok: false, error: sessionIdVerdict.error });
    const sessionId = sessionIdVerdict.sessionId;
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


// === LOGS ===
app.get('/api/logs', async (req, res) => {
  try {
    const mod = await import('./logs.js');
    return mod.default(req, res);
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});


// Conversations V2


// Orders stats (KPI) — prefers RPC get_order_stats, falls back to aggregations


// --- Amber Control Deck endpoints ---

// --- Diagnostic test endpoints (Supabase / config visibility) ---


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

// === OWNER RESTAURANTS (B1 owner-read + D3 owner-write: auth.getUser + owner_id server-side) ===
app.get('/api/owner/restaurants', async (req, res) => {
  try {
    const mod = await import('./owner/restaurants.js');
    return mod.default(req, res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/owner/restaurants/:id', async (req, res) => {
  try {
    const mod = await import('./owner/restaurants.js');
    return mod.default(req, res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.patch('/api/owner/restaurants/:id', async (req, res) => {
  try {
    const mod = await import('./owner/restaurants.js');
    return mod.default(req, res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// === OWNER MENU (D3: menu_items_v2, service_role, ownership przez restaurant_id) ===
app.get('/api/owner/restaurants/:id/menu', async (req, res) => {
  try {
    const mod = await import('./owner/restaurantMenu.js');
    return mod.default(req, res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/owner/restaurants/:id/menu', async (req, res) => {
  try {
    const mod = await import('./owner/restaurantMenu.js');
    return mod.default(req, res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.patch('/api/owner/restaurants/:restaurantId/menu/:itemId', async (req, res) => {
  try {
    const mod = await import('./owner/restaurantMenu.js');
    return mod.default(req, res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/api/owner/restaurants/:restaurantId/menu/:itemId', async (req, res) => {
  try {
    const mod = await import('./owner/restaurantMenu.js');
    return mod.default(req, res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// === RESTAURANT RESOLVER (public: name/alias -> {id,name}) ===
app.get('/api/restaurants/resolve', async (req, res) => {
  try {
    const mod = await import('./restaurants/resolve.js');
    return mod.default(req, res);
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

