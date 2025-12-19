export function applyDynamicTtsEnv(cfg) {
  try {
    if (!cfg) return;
    if (cfg.tts_engine?.engine) {
      // Map logical engine to existing env toggles
      const engine = String(cfg.tts_engine.engine);
      process.env.TTS_MODE = engine;
      process.env.TTS_SIMPLE = engine === "basic" ? "true" : "false";
      // vertex / chirp use Vertex by default
      const useVertex = engine === "vertex" || engine === "chirp" || engine === "vertex-tts";
      process.env.TTS_USE_VERTEX = useVertex ? "true" : "false";
    }
    if (cfg.tts_voice?.voice) {
      process.env.TTS_VOICE = String(cfg.tts_voice.voice);
    }
    if (cfg.streaming && typeof cfg.streaming.enabled === "boolean") {
      process.env.OPENAI_STREAM = cfg.streaming.enabled ? "true" : "false";
    }
    if (typeof cfg.cache_enabled === "boolean") {
      process.env.CACHE_ENABLED = cfg.cache_enabled ? "true" : "false";
    }
  } catch (e) {
    console.warn("⚠️ applyDynamicTtsEnv failed:", e.message);
  }
}

export function ttsRuntime(session) {
  return {
    simple: process.env.TTS_SIMPLE === 'true' || process.env.TTS_MODE === 'basic',
    voice: process.env.TTS_VOICE,
    tone: session?.tone || 'swobodny'
  };
}
