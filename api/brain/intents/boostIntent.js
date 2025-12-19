import { normalizeTxt } from "../helpers.js";

/**
 * Boosts intent based on strict expected context and short phrases.
 * @param {object|string} det - Detected intent object or string
 * @param {string} text - User text
 * @param {object} session - Session object
 */
export function boostIntent(det, text, session) {
  // 1. Jeśli brak session.expectedContext → zwróć det bez zmian.
  if (!session?.expectedContext) {
    return det;
  }

  // 1b. Jeśli już wykryto konkretne zamówienie (create_order) przez parser,
  // NIE zmieniaj go na potwierdzenie, nawet jeśli kontekst na to pozwala.
  const currentIntent = typeof det === 'object' ? det.intent : det;
  if (currentIntent === 'create_order' || currentIntent === 'add_to_cart') {
    console.log(`ℹ️ boostIntent: Skipping boost, already detected order intent: ${currentIntent}`);
    return det;
  }

  // Upewnij się że mamy czysty string intencji do zwracania w razie braku zmian
  // (Funkcja może przyjmować string lub obiekt, zwracać powinna to samo co dostała lub ulepszony obiekt)
  // Ale zgodnie z instrukcją "function boostIntent(det...)" - zakładamy że det to obiekt z detectIntent?
  // W brainRouter wywołanie to: boostIntent(text, hybridIntent, hybridConfidence, currentSession)
  // Wait, signature in brainRouter usage is: boostIntent(text, intentString, confidence, session)
  // BUT User instruction says: function boostIntent(det, text, session).
  // I need to align signature. I'll stick to what brainRouter currently uses OR adapt brainRouter.
  // brainRouter uses: boostIntent(text, hybridIntent, hybridConfidence, currentSession)

  // Let's adapt to receive params matching User Instruction concept but keeping compatibility if possible.
  // Actually, I should update brainRouter to call it correctly later.
  // Let's define signature: boostIntent(det, text, session).
  // Where 'det' is { intent, confidence } or just 'intent' string.

  // Checking brainRouter usage from step 825:
  // boostIntent(text, hybridIntent, hybridConfidence, currentSession)

  // I will implementing the User's logical signature and fix brainRouter call in Step 4.
  // Or I can keep the existing signature to minimize noise:
  // export function boostIntent(text, intent, confidence, session)
  // And internally map it.

  // User spec: 
  // function boostIntent(det, text, session):
  // 3. ... -> Zwróć nowy obiekt: { ...det, intent: 'show_menu', confidence: 0.95, boosted: true }

  // I will assume 'det' is an object { intent, confidence }.

  const ctx = session.expectedContext;
  const lower = normalizeTxt(text || "");

  // Limit words check (<= 12 words) to avoid false positives on long rants,
  // but allow "chętnie zobaczę co mają w menu" (6-7 words).
  const words = lower.split(/\s+/).length;
  if (words > 12) return det;

  // 3. Confirm Menu
  if (ctx === 'confirm_menu' || ctx === 'menu_request') { // Map consistently
    const confirmPhrases = ["tak", "tak pokaz", "tak pokaż", "chetnie", "chętnie", "chetnie zobacze", "chętnie zobaczę", "pokaz", "pokaż", "tak pokaz", "tak, pokaz", "jasne", "z przyjemnoscia", "z przyjemnością"];

    // Check strict match or inclusion for short phrases
    if (confirmPhrases.some(p => lower.includes(p))) {
      // Return structured object if det was object, or create new one
      return {
        // Preserve other props if det is object (spread first)
        ...(typeof det === 'object' ? det : {}),
        // Then override with boosted values
        intent: 'menu_request',
        confidence: 0.99,
        boosted: true
      };
    }
  }

  // 3b. Select Restaurant (NEW)
  if (ctx === 'select_restaurant') {
    // Ordinals & selection keywords
    const isSelection =
      /\b(pierwsz[aąye]|drug[aąie]|trzeci[aąe]|czwart[aąye]|piąt[aąye]|szóst[aąye])\b/.test(lower) ||
      /\b(\d+)\b/.test(lower) ||
      /\b(wybieram|poprosze|poproszę|wezme|wezmę|biore|biorę)\b/.test(lower) ||
      /\b(ta|to|ten|te)\b/.test(lower); // "ta pierwsza", "ten"

    if (isSelection) {
      return {
        // Preserve other props if det is object (spread first)
        ...(typeof det === 'object' ? det : {}),
        // Then override with boosted values
        intent: 'select_restaurant',
        confidence: 0.99,
        fromExpected: true, // Mark as expected match
        boosted: true
      };
    }
  }

  // 4. Confirm Choice
  if (ctx === 'confirm_choice' || ctx === 'confirm_order') {
    const confirmPhrases = ["tak", "potwierdzam", "poprosze", "poproszę", "jasne", "ok", "dobrze", "pewnie"];
    if (confirmPhrases.some(p => lower.includes(p))) {
      return {
        // Preserve other props if det is object (spread first)
        ...(typeof det === 'object' ? det : {}),
        // Then override with boosted values
        intent: 'confirm_order',
        confidence: 0.99,
        boosted: true
      };
    }
  }

  // 5. Default
  return det;
}
