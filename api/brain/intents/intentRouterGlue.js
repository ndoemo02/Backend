// api/brain/intents/intentRouterGlue.js

import { fallbackIntent } from "./fallbackIntent.js";
import { refineIntentLLM } from "./llmRefiner.js";

// eksport jak w main
export { detectIntent, normalizeTxt } from "../intent-router.js";

/**
 * resolveIntent — główna logika:
 * 1) coarse intent z detektora
 * 2) fallback rules
 * 3) LLM refiner
 */
export async function resolveIntent({ text, coarseIntent, session }) {
  // 1. fallback rules → podstawa
  const intentAfterFallback = fallbackIntent(text, coarseIntent, null, session);

  try {
    // 2. LLM refining — precyzowanie intencji
    const refined = await refineIntentLLM({
      text,
      coarseIntent: intentAfterFallback,
      session,
    });

    const finalIntent =
      refined?.intent && refined.intent !== "unknown"
        ? refined.intent
        : intentAfterFallback;

    return {
      intent: finalIntent,
      targetRestaurant: refined?.targetRestaurant || null,
      targetItems: refined?.targetItems || null,
      action: refined?.action || null,
      quantity: refined?.quantity || null,
    };
  } catch (err) {
    console.warn("⚠️ resolveIntent: LLM refinement failed, using fallback intent", err?.message);

    return {
      intent: intentAfterFallback,
      targetRestaurant: null,
      targetItems: null,
      action: null,
      quantity: null,
    };
  }
}
