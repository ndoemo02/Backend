import { supabase } from "../_supabase.js";
import { playTTS } from "../tts.js"; // Twój handler TTS
import { getSystemHealth } from "../admin/system-status.js";

async function logEvent(level, message) {
  console.log(`[${level.toUpperCase()}] ${message}`);
  await supabase.from("system_logs").insert([{ level, message }]);
}

async function speakAlert(message) {
  try {
    await playTTS(`Szefie, ${message}`, { voice: "pl-PL-Wavenet-E" });
  } catch (e) {
    console.error("TTS Alert failed:", e);
  }
}

export async function runWatchdog() {
  // 1. Basic Heartbeat
  try {
    const { data, error } = await supabase.from("restaurants").select("id").limit(1);
    if (error) throw error;
    await logEvent("info", "Supabase heartbeat OK");
  } catch (err) {
    await logEvent("critical", `Supabase connection failed: ${err.message}`);
    await speakAlert("mamy problem z warstwą Supabase.");
    throw err;
  }

  // 2. Dashboard Health Check & Events Logging
  try {
    const health = await getSystemHealth();

    // Log specialized event for the Admin Panel to read
    await supabase.from("system_events").insert([{
      type: "PANEL_STATUS",
      payload: {
        metrics_state: health.metrics,
        overall_state: health.state,
        label: health.label,
        confidence: health.confidence
      },
      created_at: new Date().toISOString()
    }]);

    if (health.state !== "ALL SYSTEMS OPERATIONAL") {
      await logEvent("warning", `Dashboard Status: ${health.state} - ${health.label}`);
    }
  } catch (e) {
    console.warn("Watchdog Health Check failed:", e.message);
  }

  // 3. API Check
  try {
    const apiTest = await fetch("https://freeflow-backend.vercel.app/api/health");
    if (!apiTest.ok) throw new Error(apiTest.statusText);
    await logEvent("info", "API layer OK");
  } catch (err) {
    await logEvent("critical", `API connection failed: ${err.message}`);
    await speakAlert("mamy problem z warstwą API.");
  }
}

