// --- SAFE DOTENV LOADER ---
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

const envPath = path.resolve(process.cwd(), ".env");
const envLocalPath = path.resolve(process.cwd(), ".env.local");

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
  console.log("🌍 Loaded .env from:", envPath);
} else {
  console.warn("⚠️  No .env file found at:", envPath);
}

if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
  console.log("🌍 Loaded .env.local from:", envLocalPath);
}

console.log("✅ FreeFlow Watchdog initialized successfully.");

// --- SUPABASE CLIENT ---
import { createClient } from "@supabase/supabase-js";
if (!globalThis.supabase) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("❌ Missing Supabase environment variables");
  } else {
    globalThis.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    console.log("🧠 Global Supabase client initialized");
  }
}
export const supabase = globalThis.supabase;

// --- EXPRESS SETUP ---
import express from "express";
import cors from "cors";
import multer from "multer";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import OpenAI from "openai";
import speech from "@google-cloud/speech";
import textToSpeech from "@google-cloud/text-to-speech";
import { ALLOWED_HEADERS, isAllowedOrigin } from "./api/_cors.js";
import debugApi from "./api/debug.js";

const app = express();
app.use(express.json());
app.use(
  cors({
    origin(origin, callback) {
      // Allow requests without origin (e.g., Postman, curl, same-origin)
      if (!origin) {
        console.log('✅ CORS: No origin (same-origin or tool)');
        return callback(null, true);
      }
      // Check if origin is allowed
      if (isAllowedOrigin(origin)) {
        return callback(null, true);
      }
      console.warn("❌ Blocked by CORS:", origin);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    allowedHeaders: ALLOWED_HEADERS,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })
);

// --- CLIENTS INIT ---
let openai, sttClient, ttsClient;
const initClients = () => {
  if (!openai)
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });
  if (!sttClient) sttClient = new speech.SpeechClient();
  if (!ttsClient) ttsClient = new textToSpeech.TextToSpeechClient();
};

// --- MULTER CONFIG ---
const upload = multer({ storage: multer.memoryStorage() });

// === [1] HEALTH CHECK ===
app.get("/api/health", async (req, res) => {
  const health = {
    ok: true,
    node: process.version,
    service: "FreeFlow Voice Expert",
    version: process.env.npm_package_version || "dev",
    timestamp: new Date().toISOString(),
    supabase: { ok: false, time: null },
  };

  try {
    const t0 = performance.now();
    const { data, error } = await supabase.from("restaurants").select("id").limit(1);
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

// === [2] AMBER BRAIN ===
app.post("/api/brain", async (req, res) => {
  try {
    const brainRouter = await import("./api/brain/brainRouter.js");
    return brainRouter.default(req, res);
  } catch (error) {
    console.error("❌ Brain error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/brain/router", async (req, res) => {
  try {
    const brainRouter = await import("./api/brain/brainRouter.js");
    return brainRouter.default(req, res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/brain/stats", async (req, res) => {
  try {
    const stats = await import("./api/brain/stats.js");
    return stats.default(req, res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// === [3] RESTAURANTS ===
app.get("/api/restaurants", async (req, res) => {
  try {
    const { data, error } = await supabase.from("restaurants").select("*");
    if (error) throw error;
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/restaurants/nearby", async (req, res) => {
  try {
    const { lat, lng } = req.query;
    const handler = await import("./api/restaurants-nearby.js");
    return handler.default(req, res, lat, lng);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === [4] MENU ITEMS ===
app.get("/api/menu/:restaurantId", async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const { data, error } = await supabase
      .from("menu_items")
      .select("*")
      .eq("restaurant_id", restaurantId);
    if (error) throw error;
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// === [5] ORDERS ===
app.get("/api/orders", async (req, res) => {
  try {
    const ordersHandler = await import("./api/orders.js");
    return ordersHandler.default(req, res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/orders", async (req, res) => {
  try {
    const ordersHandler = await import("./api/orders.js");
    return ordersHandler.default(req, res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.patch("/api/orders/:id", async (req, res) => {
  try {
    const ordersHandler = await import("./api/orders.js");
    return ordersHandler.default(req, res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// === [6] TTS (Google i Chirp) ===
app.post("/api/tts", async (req, res) => {
  try {
    initClients();
    const { text } = req.body;
    const [response] = await ttsClient.synthesizeSpeech({
      input: { text },
      voice: { languageCode: "pl-PL", name: "pl-PL-Wavenet-A" },
      audioConfig: { audioEncoding: "MP3", speakingRate: 1.05 },
    });
    res.json({ ok: true, audioContent: response.audioContent.toString("base64") });
  } catch (err) {
    res.status(500).json({ ok: false, error: "TTS generation failed" });
  }
});

app.post("/api/tts-chirp-hd", async (req, res) => {
  try {
    const chirpHDHandler = await import("./api/tts-chirp-hd.js");
    return chirpHDHandler.default(req, res);
  } catch (error) {
    res.status(500).json({ error: "Chirp HD TTS failed" });
  }
});

app.post("/api/tts-chirp-stream", async (req, res) => {
  try {
    const chirpStreamHandler = await import("./api/tts-chirp-stream.js");
    return chirpStreamHandler.default(req, res);
  } catch (error) {
    res.status(500).json({ error: "Chirp Stream failed" });
  }
});

// === [8] DEBUG API ===
app.use('/api', debugApi);

// === [10] ADMIN API ===
import adminRouter from "./api/admin/router.js";
app.use('/api/admin', adminRouter);

// === [9] WATCHDOG SYSTEM ===
import { runWatchdog } from "./api/watchdog/core.js";

// === [7] WebSocket STT ===
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws) => {
  console.log("🔗 WebSocket connected");

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      console.log("🧠 Amber received:", data.text);

      // Wyślij odpowiedź z powrotem do klienta
      ws.send(JSON.stringify({
        reply: `Amber mówi: dostałam twoje "${data.text}" — przetwarzam.`,
        ok: true,
        timestamp: new Date().toISOString()
      }));
    } catch (err) {
      console.error("❌ WS Parse error:", err);
      ws.send(JSON.stringify({
        ok: false,
        error: "Failed to parse message",
        timestamp: new Date().toISOString()
      }));
    }
  });

  ws.on("close", () => console.log("❌ WebSocket disconnected"));

  // Wyślij wiadomość powitalną
  ws.send(JSON.stringify({
    ok: true,
    message: "FreeFlow STT WebSocket ready",
    timestamp: new Date().toISOString()
  }));
});

// --- START SERVER ---
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🚀 FreeFlow backend running on port ${PORT}`);
});

// --- WATCHDOG MONITORING ---
setInterval(async () => {
  try {
    await runWatchdog();
  } catch (e) {
    console.error("💥 Watchdog alert triggered:", e.message);
  }
}, 30000);

console.log("✅ FreeFlow Watchdog initialized successfully.");
