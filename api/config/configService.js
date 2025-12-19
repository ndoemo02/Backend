// api/config/configService.js
// Dynamic configuration backed by Supabase system_config table.
// Never throws – always returns a sane default config.

import { supabase } from "../_supabase.js"

const KEYS = [
  "tts_engine",
  "tts_voice",
  "model",
  "streaming",
  "cache_enabled",
  "amber_prompt",
  "speech_style",
  "tts_pitch",
  "tts_rate",
  "tts_tone",
  "restaurant_aliases",
]

const DEFAULT_CONFIG = {
  tts_engine: { engine: process.env.TTS_ENGINE || "gpt-4o-mini-tts" },
  tts_voice: { voice: process.env.TTS_VOICE || "alloy" },
  model: { name: process.env.OPENAI_MODEL || "gpt-5" },
  streaming: { enabled: true },
  cache_enabled: true,
  amber_prompt: "",
  speech_style: "standard",
  tts_pitch: 0,
  tts_rate: 1.0,
  tts_tone: "swobodny",
  restaurant_aliases: {},
}

function safeMerge(base, value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...base, ...value }
  }
  // If value is a primitive (e.g. string) just wrap or override when base is primitive
  if (typeof base === "object" && base !== null && !Array.isArray(base)) {
    return { ...base, value }
  }
  return value ?? base
}

export async function getConfig() {
  try {
    const { data, error } = await supabase
      .from("system_config")
      .select("key, value")
      .in("key", KEYS)

    if (error) {
      console.warn("⚠️ getConfig: system_config query failed:", error.message)
      return { ...DEFAULT_CONFIG }
    }

    const map = {}
    for (const row of data || []) {
      if (!row || !row.key) continue
      map[row.key] = row.value
    }

    const cfg = {
      tts_engine: safeMerge(DEFAULT_CONFIG.tts_engine, map.tts_engine),
      tts_voice: safeMerge(DEFAULT_CONFIG.tts_voice, map.tts_voice),
      model: safeMerge(DEFAULT_CONFIG.model, map.model),
      streaming: safeMerge(DEFAULT_CONFIG.streaming, map.streaming),
      cache_enabled:
        typeof map.cache_enabled === "boolean"
          ? map.cache_enabled
          : DEFAULT_CONFIG.cache_enabled,
      amber_prompt: normalizePrompt(map.amber_prompt, DEFAULT_CONFIG.amber_prompt),
      speech_style:
        typeof map.speech_style === "string" && map.speech_style.trim().length > 0
          ? map.speech_style
          : DEFAULT_CONFIG.speech_style,
      tts_pitch:
        typeof map.tts_pitch === "number"
          ? map.tts_pitch
          : DEFAULT_CONFIG.tts_pitch,
      tts_rate:
        typeof map.tts_rate === "number"
          ? map.tts_rate
          : DEFAULT_CONFIG.tts_rate,
      tts_tone:
        typeof map.tts_tone === "string" && map.tts_tone.trim().length > 0
          ? map.tts_tone
          : DEFAULT_CONFIG.tts_tone,
        restaurant_aliases:
          map.restaurant_aliases && typeof map.restaurant_aliases === "object"
            ? map.restaurant_aliases
            : { ...DEFAULT_CONFIG.restaurant_aliases },
    }

    return cfg
  } catch (e) {
    console.warn("⚠️ getConfig: falling back to defaults:", e.message)
    return { ...DEFAULT_CONFIG }
  }
}

export async function updateConfig(key, value) {
  if (!KEYS.includes(key)) {
    console.warn("⚠️ updateConfig: unsupported key", key)
    return getConfig()
  }

  try {
    const payload = { key, value }
    const { error } = await supabase
      .from("system_config")
      .upsert(payload, { onConflict: "key" })

    if (error) {
      console.warn("⚠️ updateConfig: upsert failed:", error.message)
    }
  } catch (e) {
    console.warn("⚠️ updateConfig: unexpected error:", e.message)
  }

  // Always return the latest snapshot (or defaults on failure)
  return getConfig()
}

function normalizePrompt(raw, fallback = "") {
  if (raw == null) return fallback
  if (typeof raw === "string") return raw
  if (typeof raw === "object") {
    if (typeof raw.prompt === "string") return raw.prompt
    if (typeof raw.value === "string") return raw.value
  }
  return fallback
}

export async function getPrompt() {
  const cfg = await getConfig()
  return cfg.amber_prompt || ""
}

export async function updatePrompt(prompt) {
  const value = typeof prompt === "string" ? prompt : String(prompt ?? "")
  await updateConfig("amber_prompt", value)
  return getPrompt()
}

export async function getRestaurantAliases() {
  try {
    const cfg = await getConfig()
    return cfg.restaurant_aliases || {}
  } catch {
    return {}
  }
}

export async function upsertRestaurantAlias(alias, canonical) {
  const normalizedAlias = String(alias || "").trim().toLowerCase()
  if (!normalizedAlias) return getRestaurantAliases()
  const canonicalValue = Array.isArray(canonical)
    ? canonical.map((c) => String(c || "").trim()).filter(Boolean)
    : [String(canonical || "").trim()].filter(Boolean)
  if (!canonicalValue.length) return getRestaurantAliases()

  const current = await getRestaurantAliases()
  const updated = {
    ...current,
    [normalizedAlias]: canonicalValue.length === 1 ? canonicalValue[0] : canonicalValue,
  }
  await updateConfig("restaurant_aliases", updated)
  return updated
}

export async function deleteRestaurantAlias(alias) {
  const normalizedAlias = String(alias || "").trim().toLowerCase()
  if (!normalizedAlias) return getRestaurantAliases()
  const current = await getRestaurantAliases()
  if (!current[normalizedAlias]) return current
  const updated = { ...current }
  delete updated[normalizedAlias]
  await updateConfig("restaurant_aliases", updated)
  return updated
}


