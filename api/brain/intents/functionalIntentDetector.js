/**
 * ETAP 1: Detekcja intencji funkcjonalnej (CO użytkownik robi)
 * 
 * Wykrywa intencję NA PODSTAWIE ZAMIARU, nie frazy.
 * Zawsze zwraca jakiś intent (bezpieczny fallback do UNKNOWN_INTENT).
 */

import { normalizeTxt } from '../intent-router.js';

/**
 * Mapowanie intencji funkcjonalnych
 */
export const FUNCTIONAL_INTENTS = {
  ADD_ITEM: 'ADD_ITEM',
  CONTINUE_ORDER: 'CONTINUE_ORDER',
  CONFIRM_ORDER: 'CONFIRM_ORDER',
  CANCEL_ORDER: 'CANCEL_ORDER',
  UNKNOWN_INTENT: 'UNKNOWN_INTENT'
};

/**
 * Wzorce dla ADD_ITEM (dodawanie kolejnych pozycji do zamówienia)
 */
const ADD_ITEM_PATTERNS = [
  /\b(a\s+jeszcze|jeszcze\s+a)\b/i,
  /\b(dorzu[ćc]|dorzuci[ćc]|dodaj)\b/i,
  /\b(a\s+mo[żz]e\s+by[ćc]|mo[żz]e\s+by[ćc])\b/i,
  /\b(wezm[ęe]\s+jeszcze|chc[ęe]\s+jeszcze)\b/i,
  /\b(jeszcze\s+mog[ęe]|mog[ęe]\s+jeszcze)\b/i,
  /\b(a\s+mo[żz]e|mo[żz]e\s+a)\b/i,
  /\b(dodaj\s+jeszcze|jeszcze\s+dodaj)\b/i,
  /\b(do[łl][ąa][żz]\s+jeszcze|jeszcze\s+do[łl][ąa][żz])\b/i,
  /^dorzu[ćc]$/i, // Tylko "dorzuć" jako całe słowo
  /\bdorzu[ćc]\b/i // "dorzuć" w tekście
];

/**
 * Wzorce dla CONTINUE_ORDER (kontynuacja zamówienia)
 */
const CONTINUE_ORDER_PATTERNS = [
  /\b(jeszcze\s+co[śs]|co[śs]\s+jeszcze)\b/i,
  /\b(jakbym\s+chcia[łl]\s+jeszcze|chcia[łl]bym\s+jeszcze)\b/i,
  /\b(do[łl][ąa][żz]\s+co[śs]|co[śs]\s+do[łl][ąa][żz])\b/i,
  /\b(wezm[ęe]\s+jeszcze\s+co[śs]|co[śs]\s+jeszcze\s+wezm[ęe])\b/i,
  /^jeszcze\s+co[śs]$/i, // Tylko "jeszcze coś" jako cała fraza
  /\bjeszcze\s+co[śs]\b/i // "jeszcze coś" w tekście
];

/**
 * Wzorce dla CONFIRM_ORDER (potwierdzenie zamówienia)
 */
const CONFIRM_ORDER_PATTERNS = [
  /\b(tak|potwierdzam|z[łl][óo][żz])\b/i,
  /\b(jasne|ok|dobrze|pewnie)\b/i,
  /\b(potwierd[źz]|akceptuj[ęe])\b/i,
  /^(poprosz[ęe]|zamawiam)$/i, // "poproszę" / "zamawiam" tylko jako samodzielne słowo
  /^(tak|jasne|ok|pewnie)[,!\s]+(poprosz[ęe]|zamawiam)$/i // "tak, poproszę"
];

/**
 * Wzorce dla CANCEL_ORDER (anulowanie zamówienia)
 */
const CANCEL_ORDER_PATTERNS = [
  /\b(nie|anuluj|odwo[łl][aą][żz]|przesta[ńn])\b/i,
  /\b(nie\s+chc[ęe]|nie\s+potrzebuj[ęe])\b/i,
  /\b(rezygnuj[ęe]|wycofuj[ęe])\b/i,
  /^odwo[łl][aą][żz]$/i, // Tylko "odwołaj" jako całe słowo
  /\bodwo[łl][aą][żz]\b/i // "odwołaj" w tekście
];

/**
 * Detekcja intencji funkcjonalnej (ETAP 1)
 * 
 * @param {string} text - Tekst użytkownika
 * @param {object} session - Sesja użytkownika (opcjonalna)
 * @returns {object} - { intent: string, confidence: number, reason: string }
 */
export function detectFunctionalIntent(text, session = null) {
  // Bezpieczny fallback dla pustego inputu
  if (!text || typeof text !== 'string' || !text.trim()) {
    return {
      intent: FUNCTIONAL_INTENTS.UNKNOWN_INTENT,
      confidence: 0,
      reason: 'empty_input',
      rawText: text || ''
    };
  }

  const normalized = normalizeTxt(text.trim());
  const original = text.trim();
  const originalLower = original.toLowerCase();
  const normalizedLower = normalized.toLowerCase();

  // Sprawdź wzorce w kolejności priorytetu
  // Używamy zarówno original jak i normalized dla lepszego dopasowania

  // 1. CANCEL_ORDER (najwyższy priorytet - jeśli user mówi "nie", to znaczy "nie")
  // Sprawdź najpierw wyraźne wzorce anulowania (nie tylko "nie")
  const explicitCancelWords = ['anuluj', 'odwołaj', 'odwolaj', 'rezygnuję', 'rezygnuje', 'wycofuję', 'wycofuje'];
  const hasExplicitCancel = explicitCancelWords.some(word =>
    originalLower.includes(word) || normalizedLower.includes(word.toLowerCase())
  );

  if (hasExplicitCancel) {
    return {
      intent: FUNCTIONAL_INTENTS.CANCEL_ORDER,
      confidence: 0.9,
      reason: 'explicit_cancel_pattern',
      rawText: original
    };
  }

  // Sprawdź wzorce CANCEL_ORDER
  for (const pattern of CANCEL_ORDER_PATTERNS) {
    if (pattern.test(original) || pattern.test(originalLower) || pattern.test(normalized) || pattern.test(normalizedLower)) {
      // Sprawdź kontekst - jeśli oczekujemy potwierdzenia, "nie" = cancel
      if (session?.expectedContext === 'confirm_order' || session?.pendingOrder) {
        return {
          intent: FUNCTIONAL_INTENTS.CANCEL_ORDER,
          confidence: 0.95,
          reason: 'cancel_pattern_in_confirm_context',
          rawText: original
        };
      }
      // Jeśli nie ma kontekstu potwierdzenia, ale jest wyraźny wzorzec anulowania
      if (/\b(anuluj|odwo[łl][aą][żz]|rezygnuj[ęe])\b/i.test(original) ||
        /\b(anuluj|odwolaj|rezygnuje)\b/i.test(originalLower) ||
        /\b(anuluj|odwolaj|rezygnuje)\b/i.test(normalizedLower)) {
        return {
          intent: FUNCTIONAL_INTENTS.CANCEL_ORDER,
          confidence: 0.9,
          reason: 'explicit_cancel_pattern',
          rawText: original
        };
      }
    }
  }

  // 2. CONFIRM_ORDER (wysoki priorytet - jeśli oczekujemy potwierdzenia)
  if (session?.expectedContext === 'confirm_order' || session?.pendingOrder) {
    for (const pattern of CONFIRM_ORDER_PATTERNS) {
      if (pattern.test(original) || pattern.test(originalLower) || pattern.test(normalized) || pattern.test(normalizedLower)) {
        return {
          intent: FUNCTIONAL_INTENTS.CONFIRM_ORDER,
          confidence: 0.95,
          reason: 'confirm_pattern_in_confirm_context',
          rawText: original
        };
      }
    }
  }

  // 3. ADD_ITEM (dodawanie kolejnych pozycji)
  for (const pattern of ADD_ITEM_PATTERNS) {
    if (pattern.test(original) || pattern.test(originalLower) || pattern.test(normalized) || pattern.test(normalizedLower)) {
      return {
        intent: FUNCTIONAL_INTENTS.ADD_ITEM,
        confidence: 0.85,
        reason: 'add_item_pattern',
        rawText: original
      };
    }
  }

  // 4. CONTINUE_ORDER (kontynuacja zamówienia)
  for (const pattern of CONTINUE_ORDER_PATTERNS) {
    if (pattern.test(original) || pattern.test(originalLower) || pattern.test(normalized) || pattern.test(normalizedLower)) {
      return {
        intent: FUNCTIONAL_INTENTS.CONTINUE_ORDER,
        confidence: 0.85,
        reason: 'continue_order_pattern',
        rawText: original
      };
    }
  }

  // 5. Fallback - jeśli nie znaleziono żadnego wzorca
  return {
    intent: FUNCTIONAL_INTENTS.UNKNOWN_INTENT,
    confidence: 0.5,
    reason: 'no_functional_pattern_matched',
    rawText: original
  };
}

/**
 * Sprawdza czy intent jest funkcjonalny (z ETAPU 1)
 */
export function isFunctionalIntent(intent) {
  return Object.values(FUNCTIONAL_INTENTS).includes(intent);
}

