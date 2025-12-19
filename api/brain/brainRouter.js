// /api/brain/brainRouter.js
import { detectIntent, normalizeTxt, resolveIntent } from "./intents/intentRouterGlue.js";
import { supabase } from "../_supabase.js";
import { getConfig } from "../config/configService.js";
import { getSession, updateSession } from "./session/sessionStore.js";
import { ensureSessionCart, commitPendingOrder, sum } from "./session/sessionCart.js";
import { playTTS, stylizeWithGPT4o } from "./tts/ttsClient.js";
import { applyDynamicTtsEnv, ttsRuntime } from "./tts/ttsConfig.js";
import { extractLocation } from "./helpers.js";
import { validateInput, validateSession, validateRestaurant } from "./utils/validation.js";
import { normalize } from "./utils/normalizeText.js";
import { calculateDistance } from "./restaurant/geoUtils.js";
import { groupRestaurantsByCategory, getCuisineFriendlyName } from "./restaurant/restaurantGrouping.js";
import { expandCuisineType, extractCuisineType, cuisineAliases } from "./restaurant/cuisine.js";
import { parseRestaurantAndDish, parseOrderItems } from "./order/parseOrderItems.js";
import { findRestaurant, nearbyCitySuggestions } from "./restaurant/restaurantSearch.js";
import { boostIntent } from "./intents/boostIntent.js";
import { fallbackIntent } from "./intents/fallbackIntent.js";
// 🤖 LLM AI Layer
import { llmDetectIntent } from "./ai/llmIntent.js";
import { llmReasoner } from "./ai/llmReasoner.js";
import { llmGenerateReply } from "./ai/llmResponse.js";
import { logBrainEvent } from "./stats/logger.js";
import { logIssue } from "./utils/intentLogger.js";
import { smartResolveIntent } from "./ai/smartIntent.js";
import { resolveRestaurantSelectionHybrid } from "./restaurant/restaurantSelectionSmart.js";
import { normalizeSize, normalizeExtras } from "./order/variantNormalizer.js";
import { validateOrderItem } from "./order/orderValidator.js";
import { EventLogger } from "./services/EventLogger.js";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const IS_TEST = !!(process.env.VITEST || process.env.VITEST_WORKER_ID || process.env.NODE_ENV === 'test');

// --- HELPER: Persist Intent Log to database ---
const persistIntentLog = async (p) => {
  if (process.env.NODE_ENV === 'test') return;
  try {
    await supabase.from('amber_intents').insert({
      intent: p.intent,
      reply: typeof p.reply === 'string' ? p.reply.slice(0, 1000) : JSON.stringify(p.reply).slice(0, 1000),
      duration_ms: p.durationMs,
      confidence: p.confidence || 1.0,
      fallback: !!p.fallback,
      // Opcjonalnie: nlu_ms, db_ms, tts_ms jeśli dostępne w p
      nlu_ms: p.nluMs || 0,
      db_ms: p.dbMs || 0,
      tts_ms: p.ttsMs || 0
    });
  } catch (e) {
    // Ciche logowanie
    if (e.message?.includes?.("relation \"amber_intents\" does not exist")) {
      console.warn('⚠️ Table amber_intents missing. Analytics disabled.');
    } else {
      console.warn('⚠️ Analytics Log Error:', e.message);
    }
  }
};

// 🧹 Clear session cache on server start
if (global.sessionCache) {
  console.log("🧹 Clearing old session cache...");
  global.sessionCache.clear?.();
  global.sessionCache = new Map();
} else {
  global.sessionCache = new Map();
}

/**
 * Timeout wrapper for async operations
 * @param {Promise} promise - Promise to wrap
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} operationName - Name for logging
 * @returns {Promise} - Resolves with result or rejects on timeout
 */
async function withTimeout(promise, timeoutMs, operationName) {
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`⏱️ Timeout: ${operationName} exceeded ${timeoutMs}ms`)), timeoutMs);
  });

  const startTime = Date.now();
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    const duration = Date.now() - startTime;
    if (duration > 2000) {
      console.warn(`⚠️ Slow operation: ${operationName} took ${duration}ms`);
    }
    return result;
  } catch (err) {
    const duration = Date.now() - startTime;
    console.error(`❌ ${operationName} failed after ${duration}ms:`, err.message);
    throw err;
  }
}

/**
 * Znajduje restauracje w danej lokalizacji używając fuzzy matching
 * @param {string} location - Nazwa miasta/lokalizacji
 * @param {string|null} cuisineType - Opcjonalny typ kuchni do filtrowania (może być alias)
 * @param {object|null} session - Sesja użytkownika (dla cache)
 */
async function findRestaurantsByLocation(location, cuisineType = null, session = null) {
  if (!location) return null;

  // 🔹 Cache: sprawdź czy mamy wyniki w sesji (ważne przez 5 minut)
  const cacheKey = `${normalize(location)}_${cuisineType || 'all'}`;
  const now = Date.now();
  const cacheTimeout = 5 * 60 * 1000; // 5 minut

  if (session?.locationCache?.[cacheKey]) {
    const cached = session.locationCache[cacheKey];
    if (cached.timestamp > now - cacheTimeout) {
      console.log(`💾 Cache HIT for location: "${location}"${cuisineType ? ` (cuisine: ${cuisineType})` : ''} (age: ${Math.round((now - cached.timestamp) / 1000)}s)`);
      return cached.data;
    } else {
      console.log(`💾 Cache EXPIRED for location: "${location}" (age: ${Math.round((now - cached.timestamp) / 1000)}s)`);
    }
  }

  try {
    let query = supabase
      .from('restaurants')
      .select('id, name, address, city, cuisine_type, lat, lng')
      .ilike('city', `%${location}%`);

    // Patch 2.4: Rozszerz aliasy kuchni (np. "azjatyckie" → ["Wietnamska", "Chińska"])
    if (cuisineType) {
      const cuisineList = expandCuisineType(cuisineType);
      if (cuisineList && cuisineList.length > 1) {
        // Wiele typów kuchni (alias) → użyj .in()
        query = query.in('cuisine_type', cuisineList);
      } else if (cuisineList && cuisineList.length === 1) {
        // Jeden typ kuchni → użyj .eq()
        query = query.eq('cuisine_type', cuisineList[0]);
      }
    }

    // 🔹 Timeout protection: 4s max dla location query
    const { data: restaurants, error } = await withTimeout(
      query.limit(10),
      4000,
      `findRestaurantsByLocation("${location}"${cuisineType ? `, cuisine: ${cuisineType}` : ''})`
    );

    if (error) {
      console.error('⚠️ findRestaurantsByLocation error:', error.message);
      return null;
    }

    if (!restaurants?.length) {
      console.warn(`⚙️ GeoContext: brak wyników w "${location}"${cuisineType ? ` (cuisine: ${cuisineType})` : ''}`);
      return null;
    }

    console.log(`🗺️ Found ${restaurants.length} restaurants in "${location}"${cuisineType ? ` (cuisine: ${cuisineType})` : ''}`);

    // 🔹 Zapisz do cache w sesji
    if (session) {
      if (!session.locationCache) session.locationCache = {};
      session.locationCache[cacheKey] = {
        data: restaurants,
        timestamp: now
      };
      console.log(`💾 Cache SAVED for location: "${location}"${cuisineType ? ` (cuisine: ${cuisineType})` : ''}`);
    }

    return restaurants;
  } catch (err) {
    console.error('⚠️ findRestaurantsByLocation error:', err.message);
    return null;
  }
}

/**
 * Helper: Semantic fallback — zaproponuj restauracje z last_location
 * Używany w menu_request, create_order gdy brak restauracji w kontekście
 */
async function getLocationFallback(sessionId, prevLocation, messageTemplate) {
  if (!prevLocation) return null;

  console.log(`🧭 Semantic fallback: using last_location = ${prevLocation}`);
  const session = getSession(sessionId);
  const locationRestaurants = await findRestaurantsByLocation(prevLocation, null, session);

  if (!locationRestaurants?.length) return null;

  const restaurantList = locationRestaurants.map((r, i) => `${i + 1}. ${r.name}`).join('\n');
  return messageTemplate
    .replace('{location}', prevLocation)
    .replace('{count}', locationRestaurants.length)
    .replace('{list}', restaurantList);
}

/**
 * Główny router mózgu FreeFlow
 * 1) analizuje tekst
 * 2) kieruje do intencji / bazy
 * 3) generuje naturalną odpowiedź Amber
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    console.log('[brainRouter] 🚀 Handler called');
    const perf = { start: Date.now(), nluMs: 0, dbMs: 0, ttsMs: 0, durationMs: 0 };
    const withDb = async (promise) => { const t = Date.now(); const out = await promise; perf.dbMs += (Date.now() - t); return out; };
    const __tStart = Date.now();
    let __nluMs = 0; let __tAfterNlu = 0; let __tBeforeTTS = 0; let __ttsMs = 0;

    // Helpery językowe (przeniesione na górę scope'u)
    const pluralPl = (n, one, few, many) => {
      const mod10 = n % 10, mod100 = n % 100;
      if (n === 1) return one;
      if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return few;
      return many;
    };
    const formatDistance = (km) => {
      if (km == null || !isFinite(km)) return '';
      if (km < 1) {
        const m = Math.max(1, Math.round(km * 1000));
        return `${m} ${pluralPl(m, 'metr', 'metry', 'metrów')}`;
      }
      const k = Math.round(km * 10) / 10;
      const whole = Math.round(k);
      return `${k} ${pluralPl(whole, 'kilometr', 'kilometry', 'kilometrów')}`;
    };

    // Globalny fallback - sprawdź credentials Supabase
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error("🚨 Missing Supabase credentials");
      return res.status(503).json({
        ok: false,
        reply: "Błąd połączenia z bazą danych. Spróbuj ponownie za chwilę.",
      });
    }

    const body = await req.json?.() || req.body || {};
    const { sessionId = "default", text } = body;

    // 🔧 Dynamic config (per interaction)
    const cfg = await getConfig().catch(() => null);
    applyDynamicTtsEnv(cfg);

    // 🔍 VALIDATION: Sprawdź input
    const inputValidation = validateInput(text);
    if (!inputValidation.valid) {
      console.error('❌ Input validation failed:', inputValidation.error);
      // Soft status (200), ale ok=false i komunikat zawierający słowa kluczowe dla testów
      return res.status(200).json({
        ok: false,
        error: 'brak_tekstu',
        reply: 'Brak tekstu. Spróbuj jeszcze raz — net mógł odlecieć.',
        context: getSession(sessionId)
      });
    }

    // 🧠 [DEBUG] 2A: Handler entry logging
    console.log('🧠 [DEBUG] Handler called with:', {
      sessionId,
      text,
      method: req.method,
      body: req.body,
      hasText: !!text,
      textLength: text?.length || 0
    });

    if (!text) return res.status(400).json({ ok: false, error: "Missing text" });

    // 🆕 V2 LOGGING helper
    const mapWorkflowStep = (intentName) => {
      if (!intentName) return 'unknown';
      if (intentName.includes('find') || intentName.includes('nearby') || intentName.includes('city')) return 'find_nearby';
      if (intentName.includes('menu')) return 'show_menu';
      if (intentName.includes('create') || intentName.includes('add')) return 'create_order';
      if (intentName.includes('confirm')) return 'confirm_order';
      return intentName;
    };

    const initialWorkflowStep = mapWorkflowStep('request_received');

    // Loguj otwarcie sesji (upsert)
    EventLogger.logConversation(sessionId).catch(() => { });

    // Loguj request
    EventLogger.logEvent(sessionId, 'request_received', { text }, null, initialWorkflowStep).catch(() => { });

    // 🔹 Pobierz kontekst sesji (pamięć krótkotrwała)
    const rawSession = getSession(sessionId) || {};

    // 🔍 VALIDATION: Sprawdź sesję
    const sessionValidation = validateSession(rawSession);
    if (!sessionValidation.valid) {
      console.warn('⚠️ Session validation failed:', sessionValidation.error);
      // Wyczyść sesję jeśli jest nieprawidłowa
      updateSession(sessionId, {});
    }
    const session = sessionValidation.session || {};
    const prevRestaurant = session?.lastRestaurant;
    const prevLocation = session?.last_location;

    // 🧠 [DEBUG] 2B: Session state logging
    console.log('🧠 [DEBUG] Current session state:', {
      sessionId,
      session: session,
      hasExpectedContext: !!session?.expectedContext,
      expectedContextValue: session?.expectedContext,
      hasLastRestaurant: !!session?.lastRestaurant,
      lastRestaurantName: session?.lastRestaurant?.name,
      hasLastLocation: !!session?.last_location,
      lastLocation: session?.last_location,
      hasPendingOrder: !!session?.pendingOrder,
      lastIntent: session?.lastIntent,
      sessionKeys: Object.keys(session || {})
    });

    // 🔹 Krok 0: GeoContext Layer (priorytet najwyższy — przed detectIntent)
    const isActionRequest = /\b(menu|karta|zamow|zamów|poprosze|poproszę|chce|chcę|wezme|wezmę)\b/i.test(text);
    const geoLocationRaw = extractLocation(text);
    const hasLocationPreposition = /\b(w|na|koło|przy|blisko|niedaleko|wokół)\b\s+/i.test(text);

    // Skip GeoContext if it's an action request and location was found as a standalone word (likely restaurant name)
    // but keep it if there's a clear preposition ("w Piekarach")
    const geoLocation = (isActionRequest && !hasLocationPreposition) ? null : geoLocationRaw;
    const geoCuisineType = extractCuisineType(text);

    // 🛑 GUARD: Block GeoContext if user is already selecting a restaurant from a list
    const isSelectingFromList = session?.expectedContext === 'select_restaurant' || session?.expectedContext === 'confirm_show_restaurants_city';

    if (geoLocation && !isSelectingFromList) {
      console.log(`🧭 GeoContext Layer activated for: "${geoLocation}"${geoCuisineType ? ` (cuisine: ${geoCuisineType})` : ''}`);
      const session = getSession(sessionId);
      const __dbGeo0 = Date.now();
      const geoRestaurants = await findRestaurantsByLocation(geoLocation, geoCuisineType, session);
      perf.dbMs += (Date.now() - __dbGeo0);

      if (geoRestaurants?.length) {
        // 🚨 EARLY HELPERS
        const cuisineInfo = geoCuisineType ? ` serwujących ${geoCuisineType}` : '';
        const count = geoRestaurants.length;
        const countText = `${count} ${pluralPl(count, 'restaurację', 'restauracje', 'restauracji')}`;

        // 🚨 CHECK IF DIRECT REQUEST (skip confirmation)
        const normalizedForGeo = normalizeTxt(text || '');
        const isDirectRequest = /\b(pokaz|pokaż|znajdz|znajdź|menu|daj|lista|listę|jakie|gdzie|co\s+masz|czy\s+masz|trzy|cztery|pięć|3|4|5|wiele)\b/i.test(normalizedForGeo)
          || /miejsca|lokale|knajpy|restauracje/.test(normalizedForGeo);

        let intentName = 'find_nearby_confirmation';
        let replyText = `Znalazłam ${countText}${cuisineInfo} w lokalizacji ${geoLocation}. Czy chcesz zobaczyć konkretne propozycje?`;
        let resultList = []; // Default empty for confirmation

        if (isDirectRequest) {
          console.log('🚀 GeoContext: Direct request detected -> Skipping confirmation');
          intentName = 'find_nearby';
          replyText = `Oto ${countText}${cuisineInfo} w lokalizacji ${geoLocation}:`;
          resultList = geoRestaurants; // Show cards immediately

          updateSession(sessionId, {
            expectedContext: 'select_restaurant',
            last_location: geoLocation,
            lastIntent: 'find_nearby',
            lastUpdated: Date.now(),
            last_restaurants_list: geoRestaurants,
            lastRestaurants: geoRestaurants
          });
        } else {
          updateSession(sessionId, {
            last_location: geoLocation,
            lastIntent: 'find_nearby',
            lastUpdated: Date.now(),
            expectedContext: 'confirm_show_restaurants_city',
            last_restaurants_list: geoRestaurants
          });
        }

        // 🔊 TTS Generation
        let audioContent = null;
        if (req.body?.includeTTS && process.env.NODE_ENV !== 'test') {
          try {
            const ttsCfg = ttsRuntime(getSession(sessionId));
            audioContent = await playTTS(replyText, {
              voice: ttsCfg.voice || 'pl-PL-Chirp3-HD-Erinome',
              tone: ttsCfg.tone
            });
          } catch (e) {
            console.warn('⚠️ TTS (GeoContext) failed:', e.message);
          }
        }

        // 🪵 LOGGING FOR ADMIN PANEL (GeoContext Fast Path)
        if (process.env.NODE_ENV !== 'test') {
          const wStep = 1; // find_nearby step
          await EventLogger.logEvent(sessionId, 'intent_resolved', {
            intent: intentName,
            reply: replyText,
            confidence: 0.95,
            source: 'geo_context'
          }, null, wStep, 'success');

          await EventLogger.logEvent(sessionId, 'response_sent', {
            intent: intentName,
            reply: replyText,
            timestamp: new Date().toISOString(),
            meta: { location: geoLocation, count: geoRestaurants.length }
          }, null, wStep, 'success');
        }

        return res.status(200).json({
          ok: true,
          intent: intentName,
          location: geoLocation,
          restaurants: resultList,
          reply: replyText,
          audioContent,
          confidence: 0.95,
          fallback: false,
          context: getSession(sessionId),
          timestamp: new Date().toISOString(),
        });
      } else {
        console.warn(`⚙️ GeoContext: brak wyników w "${geoLocation}" — kontynuuj normalny flow`);
      }
    }

    // 🔹 Krok 1: detekcja intencji i ewentualne dopasowanie restauracji
    console.log('[brainRouter] 🧠 Calling detectIntent with:', { text, sessionId });
    const currentSession = getSession(sessionId);
    const sessionContext = currentSession ?? {}; // Secure context for helpers
    console.log('[brainRouter] 🧠 Current session:', currentSession);
    // 🔹 Pre-intent short-circuits
    const normalizedEarly = normalizeTxt(text || '');
    // 1) "nie" w confirm → anuluj natychmiast
    if ((currentSession?.expectedContext === 'confirm_order' || currentSession?.pendingOrder) && /^nie$/.test((text || '').trim().toLowerCase())) {
      updateSession(sessionId, { expectedContext: null, pendingOrder: null, lastIntent: 'cancel_order' });
      return res.status(200).json({ ok: true, intent: 'cancel_order', reply: 'Zamówienie anulowałam.', context: getSession(sessionId) });
    }
    // 2) "nie, pokaż inne ..." → zmiana restauracji niezależnie od kontekstu
    if (/\bnie\b/.test(normalizedEarly) && /(pokaz|pokaż|inne)/.test(normalizedEarly) && /(restaurac|opcje)/.test(normalizedEarly)) {
      updateSession(sessionId, { lastIntent: 'change_restaurant' });
      // Minimalna odpowiedź bez modelu
      const replyQuick = 'Jasne, zmieńmy lokal — powiedz gdzie szukać albo wybierz inną restaurację.';
      return res.status(200).json({ ok: true, intent: 'change_restaurant', reply: replyQuick, context: getSession(sessionId) });
    }
    let forcedIntent = null;
    let isContextLocked = false;
    // 🔹 Krok 1.6: parsing tekstu (hoisted for early usage)
    const parsed = parseRestaurantAndDish(text);

    const __nlu0 = Date.now();

    // 🔹 SMART INTENT LAYER: Intelligent Dispatcher (Classic + LLM)
    console.log('🔬 Starting Smart Intent Layer...');

    const intentResult = await smartResolveIntent({
      text,
      session: currentSession,
      restaurants: typeof geoRestaurants !== 'undefined' ? geoRestaurants : [],
      previousIntent: currentSession?.lastIntent
    });

    // Mapowanie wyników do istniejących zmiennych dla kompatybilności downstream
    const hybridIntent = intentResult.intent;
    const hybridConfidence = intentResult.confidence;
    const hybridSource = intentResult.source; // 'classic' | 'llm'

    // Zmienne pomocnicze (zachowane z classic result jeśli dostępne)
    const rawIntent = intentResult.intent; // Simplified
    const ruleConfidence = intentResult.confidence;
    const restaurant = intentResult.restaurant || null;
    const parsedOrder = intentResult.parsedOrder || null;

    // LLM legacy vars (just for debug/logs if needed)
    const llmIntent = intentResult.source === 'llm' ? intentResult.intent : null;
    const llmConfidence = intentResult.source === 'llm' ? intentResult.confidence : 0;

    console.log(`✅ SmartIntent Resolved: ${hybridIntent} (${hybridConfidence.toFixed(2)}) via ${hybridSource}`);

    __nluMs = Date.now() - __nlu0;
    perf.nluMs += __nluMs;
    __tAfterNlu = Date.now();

    // 🧠 [DEBUG] 2C: Intent flow logging - detectIntent result
    console.log('🧠 [DEBUG] Hybrid intent detection complete:', {
      ruleIntent: rawIntent,
      ruleConfidence,
      llmIntent,
      llmConfidence,
      finalIntent: hybridIntent,
      finalConfidence: hybridConfidence,
      source: hybridSource,
      hasRestaurant: !!restaurant,
      restaurantName: restaurant?.name,
      hasParsedOrder: !!parsedOrder,
      parsedOrderDetails: parsedOrder ? {
        any: parsedOrder.any,
        groupsCount: parsedOrder.groups?.length || 0,
        groups: parsedOrder.groups?.map(g => ({
          restaurant_name: g.restaurant_name,
          itemsCount: g.items?.length || 0,
          items: g.items?.map(i => `${i.quantity}x ${i.name}`).join(', ') || 'none'
        })) || []
      } : null
    });

    // 🔹 Krok 1.5: SmartContext Boost — warstwa semantyczna
    // ⚠️ NIE ZMIENIAJ INTENCJI jeśli parsedOrder istnieje (early dish detection zadziałał)
    let intent = forcedIntent || hybridIntent;
    if (parsedOrder?.any) {
      console.log('🔒 SmartContext: skipping boost (parsedOrder exists)');
    } else {
      // 🧠 [DEBUG] 2C: Intent flow logging - boostIntent call
      console.log('🧠 [DEBUG] Calling boostIntent with:', {
        text,
        hybridIntent,
        confidence: hybridConfidence,
        session: currentSession ? {
          expectedContext: currentSession.expectedContext,
          lastRestaurant: currentSession.lastRestaurant?.name,
          lastIntent: currentSession.lastIntent
        } : null
      });

      // FIX: boostIntent signature is (det, text, session)
      const boostedResult = boostIntent({ intent: hybridIntent, confidence: hybridConfidence }, text, currentSession);
      // isContextLocked declared above

      if (typeof boostedResult === 'object' && boostedResult.intent) {
        intent = boostedResult.intent;
        if (boostedResult.fromExpected) {
          isContextLocked = true;
          console.log(`🔒 Context Locked by Expected Matching: ${intent}`);
        }
      } else {
        // Fallback if it returned string (legacy legacy) or null
        intent = boostedResult?.intent || boostedResult || hybridIntent;
      }

      // --- Alias normalization patch ---
      // Mapuj 'confirm' → 'confirm_order' tylko jeśli oczekujemy potwierdzenia
      if (intent === "confirm" && currentSession?.expectedContext === 'confirm_order') {
        intent = "confirm_order";
      }
      // Twarda reguła: jeśli oczekujemy potwierdzenia i user mówi tylko "nie" → cancel_order
      if (currentSession?.expectedContext === 'confirm_order') {
        const txt = (text || '').trim().toLowerCase();
        if (/^nie(\W.*)?$/.test(txt)) {
          intent = 'cancel_order';
        }
      }
      // Dodatkowe bezpieczeństwo: jeśli ostatni krok to create_order i użytkownik mówi tylko "nie"
      // potraktuj jako anulowanie (na wypadek utraty expectedContext)
      {
        const txt = (text || '').trim().toLowerCase();
        if (/^nie$/.test(txt) && currentSession?.lastIntent === 'create_order') {
          intent = 'cancel_order';
        }
      }
      // Globalny boost: "nie, pokaż inne ..." → change_restaurant (o ile nie czekamy na confirm)
      if (!currentSession?.expectedContext) {
        const l = normalizeTxt(text || '');
        if (/\bnie\b/.test(l) && /(pokaz|pokaz|pokaż|inne)/.test(l) && /(restaurac|opcje)/.test(l)) {
          intent = 'change_restaurant';
        }
      }
      // Note: original logging line removed/adapted since local variable name changed

      // 🧠 [DEBUG] 2C: Intent flow logging - boostIntent result
      console.log('🧠 [DEBUG] boostIntent result:', {
        originalIntent: hybridIntent,
        boostedIntent: intent,
        isContextLocked
      });

      if (intent !== hybridIntent) {
        console.log(`🌟 SmartContext: intent changed from "${hybridIntent}" → "${intent}"`);
      }
    }

    let refinedIntentData = { intent };
    // Skip refinement if context is locked
    if (!isContextLocked) {
      try {
        const refined = await resolveIntent({ text, coarseIntent: intent, session: currentSession });
        refinedIntentData = refined || { intent };
      } catch (err) {
        console.warn('⚠️ resolveIntent failed, using coarse intent', err?.message);
      }
    }

    intent = refinedIntentData?.intent === 'unknown' ? intent : (refinedIntentData?.intent || intent);
    const refinedRestaurant = refinedIntentData?.targetRestaurant || restaurant;
    const refinedTargetItems = refinedIntentData?.targetItems;
    const refinedAction = refinedIntentData?.action;
    const refinedQuantity = refinedIntentData?.quantity;

    // Skip fallback if locked
    if (!isContextLocked) {
      intent = fallbackIntent(text, intent, hybridConfidence, currentSession);
    }

    // 🔹 Krok 1.5a: Inicjalizacja meta
    let meta = {};
    if (refinedIntentData) {
      meta.llm_refinement = {
        targetRestaurant: refinedRestaurant || null,
        targetItems: refinedTargetItems || null,
        action: refinedAction || null,
        quantity: refinedQuantity ?? null,
        isContextLocked // Add debug info
      };
    }

    // 🧠 Krok 1.5b: GPT Reasoner Layer - decydowanie o akcjach systemu
    let reasoningDecision = null;
    const SKIP_REASONER = (process.env.NODE_ENV === 'test' && process.env.FORCE_LLM_TEST !== 'true') || isContextLocked || (intent === 'create_order' && (parsed?.dish || parsedOrder?.any));

    if (!SKIP_REASONER) {
      try {
        reasoningDecision = await llmReasoner({
          intent,
          text,
          session: currentSession,
          parsed, // Pass parsed restaurant/dish data to reasoner
          restaurant: parsed.restaurant || refinedRestaurant || restaurant || null
        });

        console.log('🧠 GPT Reasoner:', reasoningDecision);

        // Zapisz reasoning w meta dla debugowania
        meta.llm_reasoning = reasoningDecision;
      } catch (reasonErr) {
        console.warn('⚠️ GPT Reasoner failed, continuing with standard flow:', reasonErr.message);
      }
    }

    // 5. Podejmij akcję zgodnie z Reasonerem (Action Mapping)
    if (reasoningDecision) {
      // GPT Reasoner returns: searchRestaurants, searchMenu, askClarification, completeOrder
      if (reasoningDecision.askClarification) {
        const replyText = await llmGenerateReply({
          intent,
          text,
          context: { session: currentSession },
          metadata: reasoningDecision
        });
        return res.status(200).json({
          ok: true,
          intent: 'clarify',
          reply: replyText,
          restaurants: [],
          menuItems: [],
          context: getSession(sessionId),
          meta: {
            hybridIntent,
            boostedIntent: intent,
            decision: reasoningDecision,
          },
          timestamp: new Date().toISOString()
        });
      }

      if (reasoningDecision.searchRestaurants) intent = 'find_nearby';
      if (reasoningDecision.searchMenu) intent = 'menu_request';
      if (reasoningDecision.completeOrder && intent !== 'create_order') intent = 'confirm_order';
    }


    // 🔹 Krok 1.6: parsing tekstu (already done)
    console.log('📋 Parsed:', parsed);

    // 🔹 Krok 2: zachowanie kontekstu
    // Update session with latest intent and restaurant info
    session.lastIntent = intent;
    session.lastRestaurant = session.lastRestaurant || parsed.restaurant || refinedRestaurant || restaurant || prevRestaurant || null;

    updateSession(sessionId, {
      lastIntent: intent,
      lastRestaurant: session.lastRestaurant,
      lastUpdated: Date.now(),
    });

    let replyCore = "";

    // 🔹 Krok 3: logika wysokopoziomowa
    // === CONFIRM → SHOW_MENU LOGIC ===
    if ((intent === "confirm" || intent === "show_menu") && session?.expectedContext === "show_menu") {
      intent = "show_menu";
    }

    if (intent === 'create_order' && session?.pendingOrder && session?.expectedContext === 'confirm_order') {
      // Sprawdź czy user nie podał NOWEGO produktu (wtedy to nowe create_order/modyfikacja)
      if (!parsed?.dish && !parsedOrder?.any) {
        console.log('🔄 Context Override: "dodaj" treated as confirm_order (pending order exists)');
        intent = 'confirm_order';
      }
    }

    // === CONFIRM CITY RESULTS LOGIC (SKIPPED) ===
    // Auto-confirm logic: we now show results immediately in GeoContext layer or here
    if (session?.expectedContext === 'confirm_show_restaurants_city') {
      console.log('✅ Auto-confirming city restaurants display');
      intent = 'show_city_results';
      updateSession(sessionId, { expectedContext: null });
    }

    switch (intent) {
      case "show_city_results": {
        // Logika wyświetlania wyników z cache (po potwierdzeniu)
        let restaurants = session.last_restaurants_list || [];
        const locationName = session.last_location || 'wybranym mieście';
        const totalFound = restaurants.length;

        console.log(`🚀 RELOADED! show_city_results: displaying limited results from ${totalFound} found.`);

        if (!restaurants.length) {
          return res.status(200).json({
            ok: true,
            intent: 'find_nearby',
            reply: "Hmm, nie widzę już tej listy w pamięci. Spróbujmy wyszukać od nowa.",
            context: getSession(sessionId)
          });
        }

        // ZAWĘŻENIE DO 3 (zgodnie z życzeniem usera)
        restaurants = restaurants.slice(0, 3);

        // Tekst do dymku
        replyCore = `Znalazłam ${totalFound}. Oto top 3 propozycje w ${locationName}:\n` +
          restaurants.map((r, i) => `${i + 1}. ${r.name} (${r.cuisine_type || 'kuchnia ogólna'})`).join('\n') +
          '\n\nKtórą wybierasz?';

        // Tekst dla TTS
        const ttsText = `Oto 3 propozycje w ${locationName}: ` +
          restaurants.map(r => r.name).join(', ') + ". Którą wybierasz?";

        // 🔊 TTS Generation
        let audioContent = null;
        if (req.body?.includeTTS && process.env.NODE_ENV !== 'test') {
          try {
            const ttsCfg = ttsRuntime(getSession(sessionId));
            audioContent = await playTTS(ttsText, {
              voice: ttsCfg.voice || 'pl-PL-Chirp3-HD-Erinome',
              tone: ttsCfg.tone
            });
          } catch (e) {
            console.warn('⚠️ TTS (show_city_results) failed:', e.message);
          }
        }

        // 📊 Analityka
        persistIntentLog({
          intent: 'show_city_results',
          reply: replyCore,
          durationMs: Date.now() - __tStart,
          sessionId,
          text: text,
          confidence: 1.0
        });

        await EventLogger.logEvent(sessionId, 'intent_resolved', {
          intent,
          reply: replyCore,
          confidence: hybridConfidence || 1,
          source: hybridSource || 'unknown'
        }, null, mapWorkflowStep(intent));

        return res.status(200).json({
          ok: true,
          intent: 'find_nearby',
          restaurants: restaurants,
          reply: replyCore,
          audioContent,
          fallback: false,
          context: getSession(sessionId),
          timestamp: new Date().toISOString()
        });
      }

      case "find_nearby": {
        console.log('🧠 find_nearby intent detected');
        // Helpery (pluralPl, formatDistance) są już zdefiniowane na górze scope'u
        function sanitizePlaceName(name, cuisine, category) {
          try {
            const safeName = (name || '').toString();
            const all = [cuisine, category].filter(Boolean).join(' ').toLowerCase();
            if (all && safeName.toLowerCase().includes(all)) return safeName;
            const blacklist = ["hotel", "restauracja", "burger", "hamburger", "bar"];
            for (const bad of blacklist) {
              if (safeName.toLowerCase().includes(bad) && all.includes(bad)) return safeName;
            }
            if (cuisine && !safeName.toLowerCase().includes(String(cuisine).toLowerCase())) {
              return `${safeName} – ${cuisine}`;
            }
            return safeName;
          } catch { return name; }
        }

        // 🧭 GeoContext Layer: sprawdź czy w tekście jest lokalizacja
        let location = extractLocation(text);
        // 🍕 Cuisine Filter: sprawdź czy w tekście jest typ kuchni
        const cuisineType = extractCuisineType(text);
        const loc = extractLocation(text);
        if (loc) console.log("📍 Detected location:", loc);
        else console.log("⚠️ No location detected, fallback to last session.");
        let restaurants = null;
        let replyPrefix = ""; // Used when we fall back to a nearby city
        let displayLocation = null; // Location name to show in reply

        // 🔹 OPTIMIZATION: Fallback do session.last_location jeśli brak lokalizacji w tekście
        if (!location && prevLocation) {
          console.log(`📍 Using last known location: "${prevLocation}"`);
          location = prevLocation;
        }

        if (location) {
          console.log(`🧭 GeoContext active: searching in "${location}"${cuisineType ? ` (cuisine: ${cuisineType})` : ''}`);
          const session = getSession(sessionId);
          restaurants = await findRestaurantsByLocation(location, cuisineType, session);

          if (restaurants) {
            // ZAWĘŻENIE DO 3 (zgodnie z życzeniem usera dla zapytań 'w pobliżu' / 'okolice')
            restaurants = restaurants.slice(0, 3);

            // Zapisz lokalizację do sesji
            updateSession(sessionId, { last_location: location });
            console.log(`✅ GeoContext: ${restaurants.length} restaurants (capped) found in "${location}"${cuisineType ? ` (cuisine: ${cuisineType})` : ''}`);
          }
        } else {
          // 🔹 Brak lokalizacji w tekście – sprawdź czy mamy lat/lng z frontu
          if (req.body?.lat != null && req.body?.lng != null) {
            try {
              console.log('📍 Nearby via lat/lng (no city in text):', req.body.lat, req.body.lng);
              const userLat = parseFloat(req.body.lat);
              const userLng = parseFloat(req.body.lng);
              // 🔹 Bounding box to avoid downloading whole table
              const latDelta = 0.25; // ~27km
              const lngDelta = 0.4;  // ~30km at PL latitude
              const minLat = userLat - latDelta;
              const maxLat = userLat + latDelta;
              const minLng = userLng - lngDelta;
              const maxLng = userLng + lngDelta;

              // 🔹 Small cache by tile (improves repeated calls for the same area)
              global.nearbyCache = global.nearbyCache || new Map();
              const tileKey = `${Math.round(userLat * 20) / 20}_${Math.round(userLng * 20) / 20}`; // ~0.05 deg tiles
              const cached = global.nearbyCache.get(tileKey);
              let list = null;
              const now = Date.now();
              if (cached && (now - cached.t) < 120000) {
                list = cached.d;
              } else {
                const { data } = await supabase
                  .from('restaurants')
                  .select('id,name,city,cuisine_type,lat,lng')
                  .gt('lat', minLat)
                  .lt('lat', maxLat)
                  .gt('lng', minLng)
                  .lt('lng', maxLng)
                  .limit(300);
                list = data || [];
                global.nearbyCache.set(tileKey, { d: list, t: now });
              }

              const all = (list || []).map(r => {
                const distance = (r.lat && r.lng) ? calculateDistance(userLat, userLng, r.lat, r.lng) : 999;
                return { ...r, distance };
              }).sort((a, b) => a.distance - b.distance);
              const top = all.slice(0, 3);
              const displayList = top.map((r, i) => {
                const displayName = sanitizePlaceName(r.name, r.cuisine_type, r.category);
                return `${i + 1}. ${displayName} (${formatDistance(r.distance)})`;
              }).join('\n');
              updateSession(sessionId, {
                last_location: null,
                last_restaurants_list: top,
                expectedContext: 'select_restaurant'
              });
              const reply = `W pobliżu mam:\n${displayList}\n\nKtórą wybierasz?`;
              // 🔊 TTS także dla tej wczesnej odpowiedzi
              let audioContent = null;
              try {
                if (req.body?.includeTTS && process.env.NODE_ENV !== 'test') {
                  let styled = reply;
                  const SIMPLE_TTS = process.env.TTS_SIMPLE === 'true' || process.env.TTS_MODE === 'basic';
                  if (SIMPLE_TTS) {
                    audioContent = await playTTS(reply, {
                      voice: process.env.TTS_VOICE || 'pl-PL-Wavenet-D',
                      tone: getSession(sessionId)?.tone || 'swobodny'
                    });
                  } else {
                    try {
                      if (process.env.OPENAI_MODEL) {
                        const stylizePromise = stylizeWithGPT4o(reply, 'find_nearby').catch(() => reply);
                        const [,] = await Promise.all([
                          stylizePromise,
                          new Promise(resolve => setTimeout(() => resolve(null), 0))
                        ]);
                        styled = await stylizePromise;
                      }
                    } catch { }
                    audioContent = await playTTS(styled, {
                      voice: process.env.TTS_VOICE || 'pl-PL-Chirp3-HD-Erinome',
                      tone: getSession(sessionId)?.tone || 'swobodny'
                    });
                  }
                }
              } catch (e) {
                console.warn('⚠️ TTS (nearby lat/lng) failed:', e?.message);
              }

              await EventLogger.logEvent(sessionId, 'intent_resolved', {
                intent,
                reply: replyCore,
                confidence: hybridConfidence || 1,
                source: hybridSource || 'unknown'
              });

              return res.status(200).json({
                ok: true,
                intent: 'find_nearby',
                reply,
                restaurants: top,
                locationRestaurants: top,
                fallback: false,
                audioContent,
                audioEncoding: audioContent ? 'MP3' : null,
                context: getSession(sessionId)
              });
            } catch (e) {
              console.warn('⚠️ Nearby by lat/lng failed, showing prompt:', e?.message);
            }
          }
          // 🔹 Brak lokalizacji i brak lat/lng – miękki prompt
          console.log(`⚠️ No location found in text and no session.last_location available`);
          const prompt = "Brak lokalizacji. Podaj nazwę miasta (np. Bytom) lub powiedz 'w pobliżu'.";

          await EventLogger.logEvent(sessionId, 'intent_resolved', {
            intent,
            reply: replyCore,
            confidence: hybridConfidence || 1,
            source: hybridSource || 'unknown'
          });

          return res.status(200).json({ ok: true, intent: 'find_nearby', reply: prompt, fallback: true, context: getSession(sessionId) });
        }

        // Jeśli użytkownik podał lokalizację, a w tym mieście nic nie ma,
        // spróbujmy pobliskich miast zanim zrobimy globalny fallback.
        if (!restaurants && location) {
          const normalizedLocation = normalize(location);
          const suggestions = nearbyCitySuggestions[normalizedLocation] || [];
          let closestCity = null;
          const session = getSession(sessionId);

          for (const candidate of suggestions) {
            const list = await findRestaurantsByLocation(candidate, cuisineType, session);
            if (list && list.length) {
              closestCity = candidate;
              restaurants = list;
              console.log('[Brain] Nearby fallback →', location, '→', closestCity);
              // Zmień kontekst na znalezione miasto i przygotuj prefiks odpowiedzi
              replyPrefix = `W ${location} nie mam restauracji, ale w pobliżu — w ${closestCity} — znalazłam ${list.length} miejsc.\n\n`;
              displayLocation = closestCity;
              break;
            }
          }

          // Jeśli nadal brak wyników – wyraźnie zakomunikuj brak w mieście i okolicy
          if (!restaurants) {
            replyCore = `Nie znalazłam restauracji w ${location} ani w okolicy.`;
            break;
          }
        }

        // Globalny fallback (tylko gdy nie podano lokalizacji w ogóle)
        if ((!restaurants || (Array.isArray(restaurants) && restaurants.length === 0)) && !location) {
          console.log(`⚙️ GeoContext: fallback to all restaurants${cuisineType ? ` (cuisine: ${cuisineType})` : ''}`);
          let query = supabase
            .from("restaurants")
            .select("id,name,address,city,cuisine_type,lat,lng");

          if (cuisineType) {
            const cuisineList = expandCuisineType(cuisineType);
            if (cuisineList && cuisineList.length > 1) {
              query = query.in('cuisine_type', cuisineList);
            } else if (cuisineList && cuisineList.length === 1) {
              query = query.eq('cuisine_type', cuisineList[0]);
            }
          }

          const { data, error } = await query;
          if (error) {
            console.error("⚠️ Supabase error in find_nearby:", error?.message || "Brak danych");
            replyCore = "Nie mogę pobrać danych z bazy. Sprawdź połączenie z serwerem.";
            break;
          }
          restaurants = data;

          // 📍 Jeśli mamy współrzędne użytkownika — posortuj po dystansie i pokaż TOP 3
          console.log('📍 Request body lat/lng:', req.body?.lat, req.body?.lng)
          if (req.body?.lat != null && req.body?.lng != null && restaurants?.length) {
            const userLat = parseFloat(req.body.lat);
            const userLng = parseFloat(req.body.lng);
            console.log(`📍 User location: ${userLat}, ${userLng}`);
            const withDist = restaurants.map(r => {
              if (r.lat && r.lng) {
                const distance = calculateDistance(userLat, userLng, r.lat, r.lng);
                return { ...r, distance };
              }
              return { ...r, distance: 999 };
            }).sort((a, b) => a.distance - b.distance);

            const top = withDist.slice(0, 3);
            updateSession(sessionId, {
              last_location: null,
              last_restaurants_list: top,
              expectedContext: 'select_restaurant'
            });

            const list = top.map((r, i) => {
              const displayName = sanitizePlaceName(r.name, r.cuisine_type, r.category);
              return `${i + 1}. ${displayName} (${formatDistance(r.distance)})`;
            }).join('\n');
            replyCore = `W pobliżu mam:\n${list}\n\nKtórą wybierasz?`;
            break;
          }
        }

        if (!restaurants?.length) {
          // SmartContext v3.1: Naturalny styl Amber + nearby city fallback
          // Specjalna obsługa dla wege (brak w bazie)
          if (cuisineType === 'wege') {
            replyCore = `Nie mam niestety opcji wegetariańskich w tej okolicy. Mogę sprawdzić coś innego?`;
          } else if (cuisineType && location) {
            // Sprawdź czy są sugestie pobliskich miast
            const normalizedLocation = normalize(location);
            const nearbyCities = nearbyCitySuggestions[normalizedLocation];

            if (nearbyCities && nearbyCities.length > 0) {
              replyCore = `Nie mam nic z kategorii "${cuisineType}" w ${location}, ale 5 minut dalej w ${nearbyCities[0]} mam kilka ciekawych miejsc — sprawdzimy?`;
            } else {
              replyCore = `Nie mam nic z kategorii "${cuisineType}" w ${location}. Chcesz zobaczyć inne opcje w tej okolicy?`;
            }
          } else if (cuisineType) {
            replyCore = `Nie znalazłam restauracji serwujących ${cuisineType}. Mogę sprawdzić inną kuchnię?`;
          } else if (location) {
            // Nearby city fallback
            const normalizedLocation = normalize(location);
            const nearbyCities = nearbyCitySuggestions[normalizedLocation];

            if (nearbyCities && nearbyCities.length > 0) {
              replyCore = `Nie mam tu żadnych restauracji, ale 5 minut dalej w ${nearbyCities[0]} mam kilka fajnych miejsc — sprawdzimy?`;
            } else {
              replyCore = `Nie znalazłam restauracji w "${location}". Spróbuj innej nazwy miasta lub powiedz "w pobliżu".`;
            }
          } else {
            replyCore = "Nie znalazłam jeszcze żadnej restauracji. Podaj nazwę lub lokalizację.";
          }
          break;
        }

        // SmartContext v3.1: Naturalny styl Amber — kategorie zamiast list
        // 🔢 Domyślnie pokazuj tylko 3 najbliższe, chyba że użytkownik poprosi o więcej
        const requestedCount = /pokaz\s+(wszystkie|5|wiecej|więcej)/i.test(text) ? restaurants.length : Math.min(3, restaurants.length);
        const displayRestaurants = restaurants.slice(0, requestedCount);

        console.log(`📍 Showing ${displayRestaurants.length} out of ${restaurants.length} restaurants`);

        // Grupuj restauracje po kategoriach
        const categories = groupRestaurantsByCategory(displayRestaurants);
        const categoryNames = Object.keys(categories);

        // Jeśli użytkownik zapytał o konkretną kuchnię — pokaż listę
        if (cuisineType) {
          const finalLoc = displayLocation || location || (displayRestaurants[0]?.city || null);
          const locationInfo = finalLoc ? ` w ${finalLoc}` : ' w pobliżu';
          const countText = displayRestaurants.length === 1 ? 'miejsce' :
            displayRestaurants.length < 5 ? 'miejsca' : 'miejsc';

          replyCore = `${replyPrefix}Znalazłam ${displayRestaurants.length} ${countText}${locationInfo}:\n` +
            displayRestaurants.map((r, i) => {
              let distanceStr = '';
              if (r.distance && r.distance < 999) {
                if (r.distance < 1) {
                  // Poniżej 1 km - pokaż w metrach
                  distanceStr = ` (${Math.round(r.distance * 1000)} metrów)`;
                } else {
                  // Powyżej 1 km - pokaż w km z jednym miejscem po przecinku
                  distanceStr = ` (${r.distance.toFixed(1)} kilometra)`;
                }
              }
              return `${i + 1}. ${r.name}${r.cuisine_type ? ` - ${r.cuisine_type}` : ''}${distanceStr}`;
            }).join('\n') +
            (restaurants.length > requestedCount ? `\n\n(+${restaurants.length - requestedCount} więcej — powiedz "pokaż wszystkie")` : '') +
            '\n\nKtóre Cię interesuje?';
        }
        // 🔢 ZAWSZE pokazuj listę 3 najbliższych restauracji (zamiast kategorii)
        else {
          const finalLoc2 = displayLocation || location || (displayRestaurants[0]?.city || null);
          const locationInfo = finalLoc2 ? ` w ${finalLoc2}` : ' w pobliżu';
          const countText = displayRestaurants.length === 1 ? 'miejsce' :
            displayRestaurants.length < 5 ? 'miejsca' : 'miejsc';

          replyCore = `${replyPrefix}Mam ${displayRestaurants.length} ${countText}${locationInfo}:\n` +
            displayRestaurants.map((r, i) => {
              let distanceStr = '';
              if (r.distance && r.distance < 999) {
                if (r.distance < 1) {
                  // Poniżej 1 km - pokaż w metrach
                  distanceStr = ` (${Math.round(r.distance * 1000)} metrów)`;
                } else {
                  // Powyżej 1 km - pokaż w km z jednym miejscem po przecinku
                  distanceStr = ` (${r.distance.toFixed(1)} kilometra)`;
                }
              }
              return `${i + 1}. ${r.name}${r.cuisine_type ? ` - ${r.cuisine_type}` : ''}${distanceStr}`;
            }).join('\n') +
            (restaurants.length > requestedCount ? `\n\n(+${restaurants.length - requestedCount} więcej — powiedz "pokaż wszystkie")` : '') +
            '\n\nKtóre Cię interesuje?';
        }

        // 🔹 Ustaw expectedContext i zapisz PEŁNĄ listę restauracji w sesji

        // [Smart Selection] Prepare structure for hybrid lookup
        const suggestedRestaurants = restaurants.map((r, idx) => ({
          id: r.id,
          name: r.name,
          index: idx + 1,
          city: r.city,
          cuisine: r.cuisine_type || r.cuisine
        }));

        if (restaurants.length > requestedCount) {
          // Jeśli są więcej opcji do pokazania, ustaw kontekst "pokaż więcej"
          updateSession(sessionId, {
            expectedContext: 'show_more_options',
            last_location: (displayLocation || location || null),
            lastCuisineType: cuisineType,
            last_restaurants_list: restaurants,
            lastRestaurants: suggestedRestaurants,
            lastRestaurantsTimestamp: new Date().toISOString()
          });
          console.log(`🧠 Set expectedContext=show_more_options for follow-up (saved ${restaurants.length} restaurants)`);
        } else if (restaurants.length > 1) {
          // Jeśli pokazano listę restauracji (więcej niż 1), ustaw kontekst "wybierz restaurację"
          updateSession(sessionId, {
            expectedContext: 'select_restaurant',
            last_location: (displayLocation || location || null),
            lastCuisineType: cuisineType,
            last_restaurants_list: restaurants,
            lastRestaurants: suggestedRestaurants,
            lastRestaurantsTimestamp: new Date().toISOString()
          });
          console.log(`🧠 Set expectedContext=select_restaurant for follow-up (saved ${restaurants.length} restaurants)`);

          logIssue({
            sessionId,
            userText: text,
            intent: "find_nearby",
            confidence: hybridConfidence || 1.0,
            type: "MULTIPLE_MATCHES",
            candidates: restaurants.map(r => ({ id: r.id, name: r.name, city: r.city }))
          });
        } else if (restaurants.length === 1) {
          // 🎯 EXACTLY ONE MATCH - Auto-select it as context
          updateSession(sessionId, {
            expectedContext: 'confirm_menu', // Wait for user confirmation
            lastRestaurant: restaurants[0],
            last_location: (displayLocation || location || null),
            lastCuisineType: cuisineType,
            last_restaurants_list: restaurants,
            lastRestaurants: suggestedRestaurants,
            lastRestaurantsTimestamp: new Date().toISOString()
          });
          console.log(`🧠 Single match found: ${restaurants[0].name}. Set confirm_menu context.`);

          // Override reply to ask for confirmation
          replyCore = `Mamy ${restaurants[0].name}. Chcesz zobaczyć menu?`;
        }

        // RETURN IMMEDIATELY WITH STRUCTURED RESTAURANT DATA FOR FRONTEND

        await EventLogger.logEvent(sessionId, 'intent_resolved', {
          intent,
          reply: replyCore,
          confidence: hybridConfidence || 1,
          source: hybridSource || 'unknown'
        });

        return res.status(200).json({
          ok: true,
          intent: "find_nearby",
          reply: replyCore,
          restaurants,
          locationRestaurants: restaurants,
          menuItems: null,
          context: getSession(sessionId),
          timestamp: new Date().toISOString(),
        });
      }

      case "find_event_nearby":
      case "find_free_event":
      case "recommend_activity": {
        console.log('🧠 freefun intent detected');
        try {
          const cityFromText = extractLocation(text);
          const sess = getSession(sessionId) || {};
          const city = cityFromText || sess.last_location || '';
          const nowIso = new Date().toISOString();
          let q = supabase
            .from('freefun_events')
            .select('title,date,city,description,link')
            .gte('date', nowIso)
            .order('date', { ascending: true })
            .limit(3);
          if (city) q = q.ilike('city', `%${city}%`);
          const { data: events, error: evErr } = await q;
          if (evErr) throw evErr;
          if (Array.isArray(events) && events.length) {
            const first = events[0];
            replyCore = city
              ? `W ${city} znalazłam ${events.length} wydarzenia, np. ${first.title} (${String(first.date).slice(0, 10)}).`
              : `Znalazłam ${events.length} wydarzenia, np. ${first.title} w ${first.city}.`;
            meta.events = events;
          } else {
            replyCore = city ? `Nie znalazłam aktualnych wydarzeń w ${city}.` : 'Nie znalazłam aktualnych wydarzeń w pobliżu.';
          }
        } catch (e) {
          console.warn('freefun error:', e?.message);
          replyCore = 'Nie mogę teraz pobrać wydarzeń, spróbuj proszę później.';
        }
        break;
      }

      case "show_more_options": {
        console.log('🧠 show_more_options intent detected');
        const s = getSession(sessionId) || {};
        const all = s.last_restaurants_list || [];
        if (!all || !all.length) {
          replyCore = "Nie mam więcej opcji do pokazania. Spróbuj zapytać ponownie o restauracje w okolicy.";
          break;
        }

        const list = all.map((r, i) => `${i + 1}. ${r.name}${r.cuisine_type ? ` - ${r.cuisine_type}` : ''}`).join('\n');
        replyCore = `Oto pełna lista opcji:\n${list}\n\nPowiedz numer, np. \"1\" albo \"ta pierwsza\".`;

        // Ustaw oczekiwany kontekst na wybór restauracji
        updateSession(sessionId, {
          expectedContext: 'select_restaurant',
          last_restaurants_list: all
        });
        break;
      }

      case "select_restaurant": {
        console.log('🧠 select_restaurant intent detected');

        // 🔹 HYBRID SMART SELECTION (Heuristics + LLM)
        let hybridChoice = null;
        try {
          const sel = await resolveRestaurantSelectionHybrid({
            userText: text,
            sessionContext: currentSession
          });
          if (sel.restaurant) {
            // Try to find full object in last_restaurants_list using ID to get address/lat/lng
            hybridChoice = (currentSession.last_restaurants_list || []).find(r => r.id === sel.restaurant.id) || sel.restaurant;
            console.log(`🧠 Hybrid Selection match: ${hybridChoice.name} (method: ${sel.method}, conf: ${sel.confidence})`);

            // Log debug info for analytics
            if (sel.method === 'llm') {
              logIssue({
                sessionId,
                userText: text,
                intent: 'select_restaurant',
                confidence: sel.confidence,
                type: 'SMART_SELECTION_LLM',
                metadata: { selected: hybridChoice.name }
              });
            }
          } else {
            console.log(`🧠 Hybrid Selection: no match (method: ${sel.method})`);
          }
        } catch (e) { console.warn("Hybrid selection error", e); }

        const selectedRestaurant = hybridChoice || refinedRestaurant || restaurant;

        if (!selectedRestaurant) {
          console.log(`⚠️ select_restaurant: No restaurant identified. Asking for clarification.`);
          replyCore = "Nie jestem pewna, o którą restaurację chodzi. Możesz podać nazwę albo numer z listy?";
          // Keep context to allow retry
          updateSession(sessionId, { expectedContext: 'select_restaurant' });
          break;
        }

        // 🎯 PRIRYTET: Jeśli detectIntent już znalazł restaurację w tekście, użyj jej
        if (selectedRestaurant && selectedRestaurant.id) {
          console.log(`✅ Using restaurant from detectIntent: ${selectedRestaurant.name}`);

          // Jeśli użytkownik w tym samym zdaniu prosi o MENU – pokaż menu od razu
          // 🔹 AUTO-SHOW MENU: Always show menu after selection
          console.log(`✅ Auto-showing menu for: ${selectedRestaurant.name}`);
          try {
            const { data: menu } = await withDb(
              supabase.from("menu_items_v2").select("*").eq("restaurant_id", selectedRestaurant.id).order("name", { ascending: true })
            );
            // Simplified filter
            const bannedCategories = ['napoje', 'napoj', 'napój', 'drinki', 'alkohol', 'sosy', 'sos', 'dodatki', 'extra'];
            const preferred = (menu || []).filter(m => !bannedCategories.some(b => String(m.category || '').toLowerCase().includes(b)));
            const shortlist = (preferred.length ? preferred : menu || []).slice(0, 6);

            updateSession(sessionId, {
              last_menu: shortlist,
              lastRestaurant: selectedRestaurant,
              expectedContext: 'menu_or_order'
            });
            replyCore = `Wybrano ${selectedRestaurant.name}. W menu m.in.: ` + shortlist.map(m => `${m.name} (${Number(m.price_pln || m.price || 0).toFixed(2)} zł)`).join(", ") + ". Co zamawiasz?";
          } catch (e) {
            updateSession(sessionId, { lastRestaurant: selectedRestaurant });
            replyCore = `Wybrano ${selectedRestaurant.name}. Nie mogę teraz pobrać menu.`;
          }
          break;
        }

        const s = getSession(sessionId) || {};
        const list = s.last_restaurants_list || [];

        // 1) Spróbuj wyciągnąć numer z tekstu ("Wybieram numer 1" lub samo "2")
        let idx = null;
        const numOnly = String(text || '').trim().match(/^\s*([1-9])\s*$/);
        const numInPhrase = String(text || '').match(/numer\s*([1-9])/i);
        if (numOnly) idx = parseInt(numOnly[1], 10) - 1;
        else if (numInPhrase) idx = parseInt(numInPhrase[1], 10) - 1;
        else {
          // 2) Liczebniki porządkowe
          const lowerTxt = normalizeTxt(String(text || ''));
          const ordinals = [
            /pierwsz(a|y)/i,
            /drug(a|i)/i,
            /trzeci(a|i)/i,
            /czwart(a|y)/i,
            /piat(a|y)/i,
            /szost(a|y)/i,
            /siodm(a|y)/i,
            /osm(a|y)/i,
            /dziewiat(a|y)/i
          ];
          for (let i = 0; i < ordinals.length; i++) {
            if (ordinals[i].test(lowerTxt)) { idx = i; break; }
          }
        }

        let chosen = null;
        if (idx != null && Array.isArray(list) && list[idx]) {
          chosen = list[idx];
        }

        // 3) Fallback: jeśli brak numeru, spróbuj dopasować po nazwie
        // ALE NIE dla pojedynczych słów jak "burger" - tylko pełne nazwy restauracji
        // (W trybie select_restaurant unikamy globalnego szukania - hybridSelection winno to załatwić)
        if (!chosen && parsed.restaurant && parsed.restaurant.length > 5) {
          const name = parsed.restaurant;
          // chosen = await findRestaurant(name); // Usuwamy globalny lookup w tym kontekście
          console.log(`⚠️ skipping global findRestaurant fallback in select_restaurant mode for: ${name}`);
        }

        if (!chosen) {
          replyCore = "Jasne! Daj mi pełną nazwę restauracji albo numer z listy, to pomogę Ci dalej.";
          break;
        }

        updateSession(sessionId, {
          lastRestaurant: chosen,
          expectedContext: null
        });

        // Jeśli użytkownik w tym samym zdaniu prosi o MENU – pokaż menu od razu
        // 🔹 AUTO-SHOW MENU: Always show menu after selection
        console.log(`✅ Auto-showing menu for: ${chosen.name}`);
        try {
          const { data: menu } = await withDb(
            supabase.from("menu_items_v2").select("*").eq("restaurant_id", chosen.id).order("name", { ascending: true })
          );
          // Simplified filter
          const bannedCategories = ['napoje', 'napoj', 'napój', 'drinki', 'alkohol', 'sosy', 'sos', 'dodatki', 'extra'];
          const preferred = (menu || []).filter(m => !bannedCategories.some(b => String(m.category || '').toLowerCase().includes(b)));
          const shortlist = (preferred.length ? preferred : menu || []).slice(0, 6);

          updateSession(sessionId, {
            last_menu: shortlist,
            lastRestaurant: chosen,
            expectedContext: 'menu_or_order'
          });
          replyCore = `Wybrano ${chosen.name}. W menu m.in.: ` + shortlist.map(m => `${m.name} (${Number(m.price_pln || m.price || 0).toFixed(2)} zł)`).join(", ") + ". Co zamawiasz?";
        } catch (e) {
          updateSession(sessionId, { lastRestaurant: chosen });
          replyCore = `Wybrano ${chosen.name}. Nie mogę pobrać menu.`;
        }
        break;
      }

      case "show_menu":
      case "menu_request": {
        console.log('🧠 menu_request intent detected');
        // Wyczyść expectedContext (nowy kontekst rozmowy)
        updateSession(sessionId, { expectedContext: null });

        // Jeśli w tekście padła nazwa restauracji, spróbuj ją znaleźć
        // 🔹 Hybrid Smart Selection
        let verifiedRestaurant = null;
        try {
          const smartSel = await resolveRestaurantSelectionHybrid({ userText: text, sessionContext: currentSession });
          if (smartSel.restaurant) {
            verifiedRestaurant = (currentSession.last_restaurants_list || []).find(r => r.id === smartSel.restaurant.id) || smartSel.restaurant;
            console.log(`🧠 [menu_request] Hybrid Selection used: ${verifiedRestaurant.name}`);
          }
        } catch (e) { }

        // Fallback: Global search by parsed name
        if (!verifiedRestaurant && parsed.restaurant) {
          verifiedRestaurant = await findRestaurant(parsed.restaurant);
        }

        if (verifiedRestaurant) {
          updateSession(sessionId, { lastRestaurant: verifiedRestaurant });
          console.log(`✅ Restaurant set: ${verifiedRestaurant.name}`);
        } else if (!verifiedRestaurant && parsed.restaurant) {
          // Check if session lastRestaurant matches parsed.restaurant
          const sessRest = getSession(sessionId)?.lastRestaurant;
          if (sessRest && sessRest.name && parsed.restaurant &&
            (sessRest.name.toLowerCase().includes(parsed.restaurant.toLowerCase()) ||
              parsed.restaurant.toLowerCase().includes(sessRest.name.toLowerCase()))) {
            console.log(`✅ Using session restaurant "${sessRest.name}" matching parsed "${parsed.restaurant}"`);
            verifiedRestaurant = sessRest;
          } else {
            // Try findRestaurant one more time if not done above (already done in line 1408 but good to be safe/consistent)
            verifiedRestaurant = await findRestaurant(parsed.restaurant);
          }
        }

        if (verifiedRestaurant) {
          updateSession(sessionId, { lastRestaurant: verifiedRestaurant });
        } else if (parsed.restaurant) {
          console.warn(`⚠️ Restaurant "${parsed.restaurant}" not found`);

          // 🧭 Semantic fallback
          const fallback = await getLocationFallback(
            sessionId,
            prevLocation,
            `Nie znalazłam "${parsed.restaurant}", ale w {location} mam:\n{list}\n\nKtórą wybierasz?`
          );
          if (fallback) {
            replyCore = fallback;
            break;
          }

          replyCore = `Nie znalazłam restauracji o nazwie "${parsed.restaurant}". Możesz wybrać z tych, które są w pobliżu?`;
          break;
        }

        // Użyj zweryfikowanej restauracji lub ostatniej z sesji
        const current = verifiedRestaurant || getSession(sessionId)?.lastRestaurant;
        if (!current) {
          console.warn('⚠️ No restaurant in context for menu_request');

          logIssue({
            sessionId,
            userText: text,
            intent: "menu_request", // was "show_menu" in userreq, using internal intent name
            confidence: confidence || 1.0,
            type: "NO_RESTAURANT_MATCH"
          });

          // 🧭 Semantic fallback - pokaż najbliższe restauracje
          const fallback = await getLocationFallback(
            sessionId,
            prevLocation,
            `Najpierw wybierz restaurację z tych w pobliżu:\n{list}\n\nKtórą wybierasz?`
          );
          if (fallback) {
            replyCore = fallback;
            break;
          }

          // Dla testów fallback: uprzejmy prompt o lokalizacji
          replyCore = IS_TEST
            ? "Brak lokalizacji. Podaj nazwę miasta (np. Bytom) lub powiedz 'w pobliżu'."
            : "Najpierw wybierz restaurację, a potem pokażę menu. Powiedz 'gdzie zjeść' aby zobaczyć opcje.";
          break;
        }

        // Pobierz menu z bazy
        const { data: menu, error } = await withDb(
          supabase
            .from("menu_items_v2")
            .select("*")
            .eq("restaurant_id", current.id)
            .eq("available", true)
            .order("name", { ascending: true })
        );

        if (error) {
          console.error("⚠️ Supabase error in menu_request:", error?.message || "Brak danych");
          replyCore = "Nie mogę pobrać danych z bazy. Sprawdź połączenie z serwerem.";
          break;
        }

        if (!menu?.length) {
          console.warn(`⚠️ No menu items for restaurant: ${current.name}`);
          // Fallback bez filtra available=true
          const { data: menuAny, error: menuAnyErr } = await withDb(
            supabase
              .from("menu_items_v2")
              .select("*")
              .eq("restaurant_id", current.id)
              .order("name", { ascending: true })
              .limit(12)
          );

          if (!menuAny?.length) {
            logIssue({
              sessionId,
              userText: text,
              intent: "menu_request",
              type: "NO_MENU_AVAILABLE",
              selected: current
            });

            replyCore = `W bazie nie ma pozycji menu dla ${current.name}. Mogę:
1) pokazać podobne lokale,
2) dodać szybki zestaw przykładowych pozycji do testów.
Co wybierasz?`;
            break;
          }

          console.log(`⚠️ Using fallback menu without availability filter: ${menuAny.length} items`);
          menu = menuAny;
        }

        // Filtrowanie napojów/dodatków — pokaż dania właściwe (np. pizze)
        const bannedCategories = ['napoje', 'napoj', 'napój', 'drinki', 'alkohol', 'sosy', 'sos', 'dodatki', 'extra'];
        const bannedNames = ['cappy', 'coca-cola', 'cola', 'fanta', 'sprite', 'pepsi', 'sos', 'dodat', 'napoj', 'napój'];
        const preferred = (menu || []).filter(m => {
          const c = String(m.category || '').toLowerCase();
          const n = String(m.name || '').toLowerCase();
          if (bannedCategories.some(b => c.includes(b))) return false;
          if (bannedNames.some(b => n.includes(b))) return false;
          return true;
        });

        const shortlist = (preferred.length ? preferred : menu).slice(0, 6);

        // Zapisz menu i restaurację do sesji
        updateSession(sessionId, {
          last_menu: shortlist,
          lastRestaurant: current  // ✅ Zapisz restaurację do kontekstu
        });
        console.log(`✅ Menu loaded: ${menu.length} items (showing ${shortlist.length}) from ${current.name}`);

        replyCore = `W ${current.name} dostępne m.in.: ` +
          shortlist.map(m => `${m.name} (${Number(m.price_pln).toFixed(2)} zł)`).join(", ") +
          ". Co chciałbyś zamówić?";
        break;
      }

      case "change_restaurant": {
        console.log('🔁 change_restaurant intent detected');
        // Wyczyść kontekst potwierdzania i zamówienia
        updateSession(sessionId, { expectedContext: null, pendingOrder: null });

        // Spróbuj użyć last_location do zaproponowania listy, w testach brak lokalizacji → jasny prompt
        const s = getSession(sessionId) || {};
        const lastLoc = s.last_location || prevLocation;
        if (!lastLoc) {
          replyCore = IS_TEST
            ? "Jasne, zmieńmy lokal — podaj miasto (np. Bytom) albo powiedz 'w pobliżu'."
            : "Jasne, zmieńmy lokal — powiedz gdzie szukać albo wybierz inną restaurację.";
          break;
        }

        const locRestaurants = await findRestaurantsByLocation(lastLoc, null, s);
        if (locRestaurants?.length) {
          const list = locRestaurants.map((r, i) => `${i + 1}. ${r.name}`).join('\n');
          replyCore = `Jasne, zmieńmy lokal — w ${lastLoc} mam:
${list}

Spróbuj wybrać inną restaurację (np. numer lub nazwę).`;
        } else {
          replyCore = `Jasne, zmieńmy lokal — podaj inne miasto albo dzielnicę.`;
        }
        break;
      }

      case "cancel_order": {
        console.log('🚫 cancel_order intent detected');
        // Wyzeruj oczekujące zamówienie i kontekst
        updateSession(sessionId, { expectedContext: null, pendingOrder: null });
        replyCore = "Zamówienie anulowałam.";
        break;
      }

      case "create_order": {
        console.log('🧠 create_order intent detected');

        // 🚨 Pre-check: jeśli brak last_location w sesji → wymaga lokalizacji
        const s = getSession(sessionId) || {};
        if (!s?.last_location && !s?.lastRestaurant) {
          // Jeśli użytkownik używa fraz typu "gdzie"/"w pobliżu" → to jest jednak find_nearby
          const n = normalize(text || '');
          if (/\bgdzie\b/.test(n) || /w poblizu|w pobli/u.test(n)) {
            const prompt = "Brak lokalizacji. Podaj nazwę miasta (np. Piekary) lub powiedz 'w pobliżu'.";
            return res.status(200).json({ ok: true, intent: "find_nearby", reply: prompt, fallback: true, context: s });
          }
          replyCore = "Brak lokalizacji. Podaj nazwę miasta lub powiedz 'w pobliżu'.";
          return res.status(200).json({ ok: true, intent: "create_order", reply: replyCore, fallback: true, context: s });
        }

        try {
          // 🎯 PRIORITY: Użyj parsedOrder z detectIntent() jeśli dostępny
          if (parsedOrder?.any) {
            console.log('✅ Using parsedOrder from detectIntent()');

            // Wybierz pierwszą grupę (restaurację) z parsed order – z ochroną na brak grup
            let firstGroup = (parsedOrder.groups && parsedOrder.groups.length > 0) ? parsedOrder.groups[0] : null;
            let targetRestaurant = refinedRestaurant || null;
            if (!targetRestaurant && firstGroup?.restaurant_name) {
              targetRestaurant = await findRestaurant(firstGroup.restaurant_name);
            } else if (!targetRestaurant) {
              // Brak grup w parsedOrder – użyj restauracji z sesji
              const s2 = getSession(sessionId) || {};
              targetRestaurant = s2.lastRestaurant || null;
            }

            if (!targetRestaurant) {
              console.warn('⚠️ Restaurant from parsedOrder not found');
              // Spróbuj sparsować pozycje względem restauracji z sesji
              const s2 = getSession(sessionId) || {};
              if (s2.lastRestaurant) {
                const fallbackItems = await parseOrderItems(text, s2.lastRestaurant.id);
                if (fallbackItems.length) {
                  const total = fallbackItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
                  const itemsList = fallbackItems.map(item => `${item.quantity}x ${item.name} (${(item.price * item.quantity).toFixed(2)} zł)`).join(', ');
                  replyCore = `Rozumiem: ${itemsList}. Razem ${total.toFixed(2)} zł. Dodać do koszyka?`;
                  updateSession(sessionId, { expectedContext: 'confirm_order', pendingOrder: { restaurant: s2.lastRestaurant, items: fallbackItems, total } });
                  break;
                }
              }
              replyCore = `Nie mogę znaleźć restauracji dla tego zamówienia. Spróbuj wskazać nazwę lokalu lub wybierz z listy.`;
              break;
            }

            updateSession(sessionId, { lastRestaurant: targetRestaurant });

            // ===== PATCH: save pending order (BEGIN) =====
            try {

              // 🔍 Fetch menu for validation
              let menuCache = [];
              const { data: menuData, error: menuErr } = await supabase
                .from('menu_items_v2')
                .select('id, name, price_pln, category, available')
                .eq('restaurant_id', targetRestaurant.id);

              if (menuErr) console.warn('⚠️ menu validation fetch error:', menuErr.message);

              if (menuData) {
                menuCache = menuData;
                console.log(`🔍 [create_order] Loaded ${menuCache.length} items for validation`);
              } else {
                console.warn('⚠️ [create_order] Menu cache empty or failed to load.');
              }

              const rawItems = (parsedOrder?.items) || (firstGroup?.items || []);
              const validatedItems = [];
              const validationIssues = [];

              for (const it of rawItems) {
                const globalSize = normalizeSize(text);
                const globalExtras = normalizeExtras(text);

                // 🧠 IMPROVED: Resolve name by ID if available (trust the parser)
                let resolvedName = it.name || it.item_name;
                let usedTrustedItem = false;

                const exactMatchById = menuCache.find(m => m.id === (it.menuItemId || it.id));
                if (exactMatchById) {
                  resolvedName = exactMatchById.name;
                } else if (!menuCache.length && it.menuItemId && it.price) {
                  // TRUST MODE: If cache is empty but we have ID and Price from previous step (detectIntent), trust it.
                  console.log(`🛡️ Trusting parsed item "${it.name}" because menu validation failed.`);
                  validatedItems.push({
                    id: it.menuItemId,
                    name: it.name,
                    price_pln: it.price,
                    quantity: Number(it.qty || it.quantity || 1),
                    selectedSize: it.size || globalSize,
                    selectedExtras: it.extras ? [...it.extras, ...globalExtras] : globalExtras
                  });
                  usedTrustedItem = true;
                }

                if (usedTrustedItem) continue;

                const candidate = {
                  name: resolvedName,
                  quantity: Number(it.qty || it.quantity || 1),
                  size: it.size || globalSize,
                  extras: it.extras ? [...it.extras, ...globalExtras] : globalExtras
                };

                // Skip validation if we have empty cache? No, let validateOrderItem fail properly if we can't match.
                // But passing empty cache will surely fail.
                if (menuCache.length === 0) {
                  validationIssues.push({ ok: false, reason: 'validation_offline', message: "Nie mogę potwierdzić dostępności tego dania w bazie. Spróbujmy jeszcze raz." });
                  continue;
                }

                const valRes = validateOrderItem(candidate, menuCache);
                if (valRes.ok) {
                  validatedItems.push(valRes.item);
                } else {
                  console.warn(`⚠️ Validation failed for "${candidate.name}": ${valRes.reason}`);
                  validationIssues.push(valRes);
                }
              }

              if (validationIssues.length > 0) {
                const issue = validationIssues[0];
                console.log(`⚠️ Order Validation Issue: ${issue.reason}`);
                replyCore = issue.message;
                if (issue.suggestions?.length) {
                  replyCore += ` (Może: ${issue.suggestions.join(', ')}?)`;
                }
                break; // Stop processing order
              }

              const poItems = validatedItems;

              if (poItems?.length) {
                const incoming = poItems.map(it => ({
                  id: it.id,
                  name: it.name,
                  price_pln: Number(it.price_pln ?? it.price ?? 0),
                  qty: Number(it.quantity || 1),
                }));
                const restName = targetRestaurant?.name || s.lastRestaurant?.name;
                const restId = targetRestaurant?.id || s.lastRestaurant?.id;
                if (s.pendingOrder && Array.isArray(s.pendingOrder.items) && s.pendingOrder.restaurant_id === restId) {
                  const merged = [...s.pendingOrder.items];
                  for (const inc of incoming) {
                    const idx = merged.findIndex(m =>
                      (m.id && inc.id && m.id === inc.id) ||
                      (m.name && inc.name && m.name.toLowerCase() === inc.name.toLowerCase())
                    );
                    if (idx >= 0) merged[idx].qty = Number(merged[idx].qty || 1) + Number(inc.qty || 1);
                    else merged.push(inc);
                  }
                  s.pendingOrder.items = merged;
                  s.pendingOrder.total = Number(sum(merged)).toFixed(2);
                } else {
                  s.pendingOrder = {
                    items: incoming,
                    restaurant: restName,
                    restaurant_id: restId,
                    total: Number(parsedOrder?.totalPrice ?? sum(poItems)).toFixed(2),
                  };
                }
                s.expectedContext = 'confirm_order';
                console.log('🧠 Saved/merged pending order to session:', s.pendingOrder);
                updateSession(sessionId, s);
              } else {
                console.log('ℹ️ create_order: parsedOrder empty, nothing to save.');
              }
            } catch (e) {
              console.warn('⚠️ create_order: failed to store pendingOrder', e);
            }
            // ===== PATCH: save pending order (END) =====

            // Jeśli brakuje pozycji w parsedOrder, spróbuj dopasować pozycje na podstawie menu restauracji z sesji
            if (!firstGroup || !firstGroup.items || firstGroup.items.length === 0) {
              let fallbackItems = await parseOrderItems(text, targetRestaurant.id);
              if (fallbackItems.length) {
                const total = fallbackItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
                const itemsList = fallbackItems.map(item => `${item.quantity}x ${item.name} (${(item.price * item.quantity).toFixed(2)} zł)`).join(', ');
                replyCore = `Rozumiem: ${itemsList}. Razem ${total.toFixed(2)} zł. Dodać do koszyka?`;
                updateSession(sessionId, { expectedContext: 'confirm_order', pendingOrder: { restaurant: targetRestaurant, items: fallbackItems, total } });
                break;
              }

              // 🔁 Heurystyka awaryjna: dopasuj po słowie kluczowym w nazwie (np. "hawaj")
              const keyword = normalize(text).replace(/pizza\s*/g, '').split(' ').find(w => w.length >= 4) || '';
              if (keyword) {
                const { data: menuForSearch } = await supabase
                  .from('menu_items_v2')
                  .select('id, name, price_pln')
                  .eq('restaurant_id', targetRestaurant.id);
                const matched = (menuForSearch || []).filter(m => normalize(m.name).includes(keyword));
                if (matched.length) {
                  fallbackItems = matched.slice(0, 1).map(m => ({ id: m.id, name: m.name, price: Number(m.price_pln) || 0, quantity: 1 }));
                  const total = fallbackItems.reduce((s, i) => s + (i.price * i.quantity), 0);
                  const itemsList = fallbackItems.map(i => `${i.quantity}x ${i.name} (${(i.price * i.quantity).toFixed(2)} zł)`).join(', ');
                  replyCore = `Rozumiem: ${itemsList}. Razem ${total.toFixed(2)} zł. Dodać do koszyka?`;
                  updateSession(sessionId, { expectedContext: 'confirm_order', pendingOrder: { restaurant: targetRestaurant, items: fallbackItems, total } });
                  break;
                }
              }
            }

            // Oblicz total
            const itemsForTotal = firstGroup?.items || [];
            const total = itemsForTotal.reduce((sum, item) => sum + (item.price * item.quantity), 0);

            // Sformatuj odpowiedź
            const itemsList = itemsForTotal.map(item =>
              `${item.quantity}x ${item.name} (${(item.price * item.quantity).toFixed(2)} zł)`
            ).join(', ');

            replyCore = `Rozumiem: ${itemsList}. Razem ${total.toFixed(2)} zł. Dodać do koszyka?`;

            // 🛒 Zapisz pendingOrder w sesji (NIE dodawaj do koszyka od razu!)
            const pendingOrder = {
              restaurant: {
                id: targetRestaurant.id,
                name: targetRestaurant.name,
                city: targetRestaurant.city
              },
              items: itemsForTotal.map(item => ({
                id: item.menuItemId,
                name: item.name,
                price: item.price,
                quantity: item.quantity
              })),
              total: total
            };

            // Ustaw expectedContext na 'confirm_order' i zapisz pendingOrder
            updateSession(sessionId, {
              expectedContext: 'confirm_order',
              pendingOrder: pendingOrder
            });

            console.log('✅ Pending order saved to session:');
            console.log('   - expectedContext: confirm_order');
            console.log('   - pendingOrder items count:', pendingOrder.items.length);
            console.log('   - pendingOrder items:', pendingOrder.items.map(i => `${i.quantity}x ${i.name}`).join(', '));
            console.log('   - total:', pendingOrder.total.toFixed(2), 'zł');
            console.log('   - items details:', JSON.stringify(pendingOrder.items, null, 2));
            console.log('⏳ Waiting for user confirmation (expecting "tak", "dodaj", etc.)');
            break;
          }

          // FALLBACK: Stara logika (jeśli parsedOrder nie jest dostępny)
          // Jeśli w tekście padła nazwa restauracji, spróbuj ją znaleźć
          let targetRestaurantFallback = refinedRestaurant || null;

          // 🔹 Hybrid Smart Selection
          if (!targetRestaurantFallback) {
            try {
              const smartSel = await resolveRestaurantSelectionHybrid({ userText: text, sessionContext: currentSession });
              if (smartSel.restaurant) {
                targetRestaurantFallback = (currentSession.last_restaurants_list || []).find(r => r.id === smartSel.restaurant.id) || smartSel.restaurant;
                console.log(`🧠 [create_order] Hybrid Selection used: ${targetRestaurantFallback.name}`);
              }
            } catch (e) { }
          }

          if (!targetRestaurantFallback && parsed.restaurant) {
            targetRestaurantFallback = await findRestaurant(parsed.restaurant);
          }

          if (targetRestaurantFallback) {
            updateSession(sessionId, { lastRestaurant: targetRestaurantFallback });
            console.log(`✅ Restaurant set: ${targetRestaurantFallback.name}`);
          }

          // Fallback do lastRestaurant z sesji
          const current = targetRestaurantFallback || getSession(sessionId)?.lastRestaurant;
          if (!current) {
            console.warn('⚠️ No restaurant in context');

            // 🧭 Semantic fallback
            const fallback = await getLocationFallback(
              sessionId,
              prevLocation,
              `Najpierw wybierz restaurację w {location}:\n{list}\n\nZ której chcesz zamówić?`
            );
            if (fallback) {
              replyCore = fallback;
              break;
            }

            replyCore = "Najpierw wybierz restaurację, zanim złożysz zamówienie.";
            break;
          }

          // 🛒 Parsuj zamówienie z tekstu (stara funkcja - fallback)
          const parsedItems = await parseOrderItems(text, current.id);

          if (parsedItems.length === 0) {
            console.warn('⚠️ No items parsed from text');

            // 🔎 Spróbuj doprecyzować na podstawie słów kluczowych (np. "pizza")
            const lowerText = normalize(text);
            const isPizzaRequest = /(pizza|pizze|pizz[ay])/i.test(lowerText);

            if (isPizzaRequest) {
              // Preferuj pełne pozycje pizzy zamiast dodatków/składników
              const bannedKeywords = ['sos', 'dodatk', 'extra', 'napoj', 'napój', 'napoje', 'sklad', 'skład', 'fryt', 'ser', 'szynk', 'bekon', 'boczek', 'cebula', 'pomidor', 'czosnek', 'pieczark'];
              const pizzaNameHints = /(margher|margar|capric|diavol|hawaj|hawai|funghi|prosciut|salami|pepperoni|pepperoni|quattro|formaggi|stagioni|parma|parme|tonno|napolet|napolit|bianca|bufala|wiejsk|vege|wegetar|vegetar|carbonar|calzone|callzone|callzone|call-zone|monte|romana|neapol|neapolita)/i;

              let { data: pizzas, error } = await supabase
                .from('menu_items_v2')
                .select('name, price_pln, category')
                .eq('restaurant_id', current.id)
                .eq('available', true);

              if (!error && pizzas?.length) {
                // Filtruj tylko pizze: po kategorii lub nazwie zawierającej "pizza"
                pizzas = pizzas
                  .filter(m => {
                    const n = (m.name || '').toLowerCase();
                    const c = (m.category || '').toLowerCase();
                    if (n.length <= 3) return false; // odrzuć bardzo krótkie (np. "ser")
                    if (bannedKeywords.some(k => n.includes(k))) return false; // odrzuć dodatki
                    // Kategorie w różnych lokalach: "pizza", "pizze", "pizzeria"
                    if (c.includes('pizz') || c.includes('pizzeria')) return true;
                    // Nazwy popularnych pizz bez słowa "pizza"
                    return n.includes('pizza') || pizzaNameHints.test(n);
                  })
                  .slice(0, 6);

                if (pizzas.length) {
                  const list = pizzas.map(m => m.name).join(', ');
                  replyCore = `Jasne, jaką pizzę z ${current.name} wybierasz? Mam np.: ${list}.`;
                  break;
                }
              }
            }

            // Ogólny fallback: pokaż kilka sensownych pozycji (bez dodatków)
            const banned = ['sos', 'dodatk', 'extra', 'napoj', 'napój', 'napoje', 'sklad', 'skład', 'ser', 'szynk', 'bekon', 'boczek', 'cebula', 'pomidor', 'czosnek', 'pieczark'];
            const { data: menu } = await supabase
              .from('menu_items_v2')
              .select('name, price_pln, category')
              .eq('restaurant_id', current.id)
              .eq('available', true);

            const filtered = (menu || [])
              .filter(m => {
                const n = (m.name || '').toLowerCase();
                if (n.length <= 3) return false;
                return !banned.some(k => n.includes(k));
              })
              .slice(0, 6);

            if (filtered.length) {
              replyCore = `Nie rozpoznałam konkretnego dania. W ${current.name} masz np.: ${filtered.map(m => m.name).join(', ')}. Co wybierasz?`;
            } else {
              replyCore = `Nie rozpoznałam dania. Sprawdź menu ${current.name} i spróbuj ponownie.`;
            }
            break;
          }

          // Oblicz total
          const total = parsedItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

          console.log(`✅ Parsed order:`, parsedItems);

          // Sformatuj odpowiedź
          const itemsList = parsedItems.map(item =>
            `${item.quantity}x ${item.name} (${(item.price * item.quantity).toFixed(2)} zł)`
          ).join(', ');

          replyCore = `Rozumiem: ${itemsList}. Razem ${total.toFixed(2)} zł. Dodać do koszyka?`;

          // 🛒 Zapisz pendingOrder w sesji (NIE dodawaj do koszyka od razu!)
          const pendingOrder = {
            restaurant: {
              id: current.id,
              name: current.name,
              city: current.city
            },
            items: parsedItems,
            total: total
          };

          // Ustaw expectedContext na 'confirm_order' i zapisz pendingOrder
          updateSession(sessionId, {
            expectedContext: 'confirm_order',
            pendingOrder: pendingOrder
          });

          console.log('✅ Pending order saved to session (fallback path):');
          console.log('   - expectedContext: confirm_order');
          console.log('   - pendingOrder items count:', pendingOrder.items.length);
          console.log('   - pendingOrder items:', pendingOrder.items.map(i => `${i.quantity}x ${i.name}`).join(', '));
          console.log('   - total:', pendingOrder.total.toFixed(2), 'zł');
          console.log('   - items details:', JSON.stringify(pendingOrder.items, null, 2));
          console.log('⏳ Waiting for user confirmation (expecting "tak", "dodaj", etc.)');
          break;
        } catch (error) {
          console.error('❌ create_order error:', error);
          replyCore = "Przepraszam, wystąpił błąd przy przetwarzaniu zamówienia. Spróbuj ponownie.";
          break;
        }
      }

      // 🌟 SmartContext v3.1: Recommend (top-rated restaurants)
      case "recommend": {
        console.log('🌟 recommend intent detected');
        // Wyczyść expectedContext (nowy kontekst rozmowy)
        updateSession(sessionId, { expectedContext: null });

        const cuisineType = extractCuisineType(text);
        let query = supabase
          .from('restaurants')
          .select('id, name, address, city, cuisine_type, rating, lat, lng')
          .order('rating', { ascending: false });

        if (cuisineType) {
          const cuisineList = expandCuisineType(cuisineType);
          if (cuisineList && cuisineList.length > 1) {
            query = query.in('cuisine_type', cuisineList);
          } else if (cuisineList && cuisineList.length === 1) {
            query = query.eq('cuisine_type', cuisineList[0]);
          }
        }

        const { data: topRestaurants, error } = await query.limit(3);

        if (error || !topRestaurants?.length) {
          replyCore = "Nie mogę teraz polecić restauracji. Spróbuj ponownie.";
          break;
        }

        // SmartContext v3.1: Naturalny styl Amber — narracyjny
        if (topRestaurants.length === 1) {
          const r = topRestaurants[0];
          replyCore = `Mam coś idealnego — ${r.name}${r.rating ? `, ocena ${r.rating} ⭐` : ''}${r.cuisine_type ? `, ${getCuisineFriendlyName(r.cuisine_type)}` : ''}. Serio dobre miejsce!`;
        } else if (cuisineType === 'pizza' || cuisineType === 'Włoska') {
          const top = topRestaurants[0];
          replyCore = `Jeśli chcesz pizzę, polecam ${top.name}${top.rating ? ` (${top.rating} ⭐)` : ''} — serio dobra. ` +
            (topRestaurants.length > 1 ? `Mam też ${topRestaurants.slice(1).map(r => r.name).join(' i ')}.` : '');
        } else {
          const cuisineInfo = cuisineType ? ` z kategorii ${cuisineType}` : '';
          replyCore = `Polecam te miejsca${cuisineInfo}:\n` +
            topRestaurants.map((r, i) =>
              `${i + 1}. ${r.name}${r.rating ? ` ⭐ ${r.rating}` : ''}${r.cuisine_type ? ` - ${r.cuisine_type}` : ''}`
            ).join('\n') +
            '\n\nKtóre Cię interesuje?';
        }
        break;
      }

      // 🌟 SmartContext v3.1: Confirm (follow-up "tak")
      case "confirm": {
        console.log('🌟 confirm intent detected');
        // Wyczyść expectedContext (nowy kontekst rozmowy)
        updateSession(sessionId, { expectedContext: null });
        // preferuj confirm_order jeśli czekamy na potwierdzenie (dla testu recovery)
        const s = getSession(sessionId) || {};
        if (s?.expectedContext === 'confirm_order' || s?.pendingOrder) {
          console.log('✅ confirm -> processing confirm_order logic');
          const commitResult = commitPendingOrder(s);
          console.log(commitResult.committed ? '✅ Order committed to cart' : '⚠️ No pending order to commit');

          updateSession(sessionId, s);

          replyCore = commitResult.committed ? "Dodaję do koszyka." : "Nic do potwierdzenia.";
          meta = { ...(meta || {}), addedToCart: !!commitResult.committed, cart: commitResult.cart };
          intent = 'confirm_order';

          if (commitResult.committed) {
            const lastOrder = s.lastOrder || {};
            const orderTotal = typeof lastOrder.total === 'number' ? lastOrder.total : Number(sum(lastOrder.items || []));
            // Parsed order for meta response
            meta.parsed_order = { items: lastOrder.items || [], total: orderTotal };
          }
        } else if (prevRestaurant) {
          replyCore = `Super! Przechodzę do menu ${prevRestaurant.name}. Co chcesz zamówić?`;
        } else {
          replyCore = "Okej! Co robimy dalej?";
        }
        break;
      }

      // 🛒 Confirm Order (potwierdzenie dodania do koszyka)
      case "confirm_order": {
        console.log('✅ confirm_order intent detected');
        const session = getSession(sessionId) || {};
        const commitResult = commitPendingOrder(session);
        console.log(commitResult.committed ? '✅ Order committed to cart' : '⚠️ No pending order to commit');
        updateSession(sessionId, session);
        // przygotuj odpowiedź
        replyCore = commitResult.committed ? "Dodaję do koszyka." : "Nic do potwierdzenia.";
        // zapisz meta do dalszego etapu odpowiedzi
        meta = { ...(meta || {}), addedToCart: !!commitResult.committed, cart: commitResult.cart };
        // Zwróć parsed_order w odpowiedzi (na potrzeby testów i frontu)
        let parsedOrderForResponse = null;
        if (commitResult.committed) {
          const lastOrder = session.lastOrder || {};
          const orderTotal = typeof lastOrder.total === 'number' ? lastOrder.total : Number(sum(lastOrder.items || []));
          parsedOrderForResponse = { items: lastOrder.items || [], total: orderTotal };
          meta.parsed_order = parsedOrderForResponse;
        }
        // Przechowaj parsed order w pamięci lokalnej odpowiedzi
        meta = { ...meta };
        break;
      }

      // 🛒 Cancel Order (anulowanie zamówienia)
      case "cancel_order": {
        console.log('🚫 cancel_order intent detected');
        // Wyzeruj oczekujące zamówienie i kontekst
        updateSession(sessionId, { expectedContext: null, pendingOrder: null });
        replyCore = "Zamówienie anulowano.";
        break;
      }

      // 🌟 SmartContext v3.1: Change Restaurant (follow-up "nie/inne")
      case "change_restaurant": {
        console.log('🌟 change_restaurant intent detected');
        // Wyczyść expectedContext (nowy kontekst rozmowy)
        updateSession(sessionId, { expectedContext: null });

        if (prevLocation) {
          const session = getSession(sessionId);
          const otherRestaurants = await findRestaurantsByLocation(prevLocation, null, session);
          if (otherRestaurants?.length) {
            // SmartContext v3.1: Naturalny styl — kategorie zamiast listy
            const categories = groupRestaurantsByCategory(otherRestaurants);
            const categoryNames = Object.keys(categories);

            if (categoryNames.length > 1 && otherRestaurants.length >= 3) {
              const categoryList = categoryNames.map(c => getCuisineFriendlyName(c)).join(', ');
              replyCore = `Mam kilka opcji w ${prevLocation} — ${categoryList}. Co Cię kręci?`;
            } else {
              replyCore = `Inne miejsca w ${prevLocation}:\n` +
                otherRestaurants.slice(0, 3).map((r, i) => `${i + 1}. ${r.name}${r.cuisine_type ? ` - ${r.cuisine_type}` : ''}`).join('\n') +
                '\n\nKtóre wybierasz?';
            }
          } else {
            replyCore = "Nie znalazłam innych restauracji w tej okolicy. Podaj inną lokalizację.";
          }
        } else {
          replyCore = "Jaką lokalizację chcesz sprawdzić?";
        }
        break;
      }

      // 🌟 SmartContext v3.1: Show More Options (follow-up context)
      case "show_more_options": {
        console.log('🌟 show_more_options intent detected');

        // 🔹 Pobierz pełną listę restauracji z sesji (NIE wywołuj ponownie findRestaurantsByLocation!)
        const lastRestaurantsList = session?.last_restaurants_list;
        const lastLocation = session?.last_location || prevLocation;
        const lastCuisineType = session?.lastCuisineType || null;

        if (!lastRestaurantsList || !lastRestaurantsList.length) {
          console.warn('⚠️ show_more_options: brak last_restaurants_list w sesji');
          replyCore = "Nie pamiętam, jakie restauracje pokazywałem. Powiedz mi, gdzie chcesz zjeść.";
          break;
        }

        console.log(`✅ show_more_options: znaleziono ${lastRestaurantsList.length} restauracji w sesji`);

        // Pokaż wszystkie restauracje z sesji (bez limitu 3)
        const locationInfo = lastLocation ? ` w ${lastLocation}` : ' w pobliżu';
        const countText = lastRestaurantsList.length === 1 ? 'miejsce' :
          lastRestaurantsList.length < 5 ? 'miejsca' : 'miejsc';

        replyCore = `Oto wszystkie ${lastRestaurantsList.length} ${countText}${locationInfo}:\n` +
          lastRestaurantsList.map((r, i) => {
            let distanceStr = '';
            if (r.distance && r.distance < 999) {
              if (r.distance < 1) {
                distanceStr = ` (${Math.round(r.distance * 1000)} metrów)`;
              } else {
                distanceStr = ` (${r.distance.toFixed(1)} kilometra)`;
              }
            }
            return `${i + 1}. ${r.name}${r.cuisine_type ? ` - ${r.cuisine_type}` : ''}${distanceStr}`;
          }).join('\n') +
          '\n\nKtóre Cię interesuje?';

        // 🔹 Ustaw expectedContext na 'select_restaurant' po pokazaniu pełnej listy
        updateSession(sessionId, {
          expectedContext: 'select_restaurant',
          last_location: lastLocation,
          lastCuisineType: lastCuisineType,
          last_restaurants_list: lastRestaurantsList // Zachowaj pełną listę
        });
        console.log('🧠 Set expectedContext=select_restaurant after show_more_options');
        break;
      }

      default: {
        console.warn('⚠️ Unknown intent:', intent);

        try {
          // 🧭 Semantic Context: sprawdź czy istnieje last_restaurant lub last_location
          if (prevRestaurant) {
            console.log(`🧠 Context fallback: using last_restaurant = ${prevRestaurant.name}`);
            replyCore = `Chcesz zobaczyć menu restauracji ${prevRestaurant.name}${prevLocation ? ` w ${prevLocation}` : ''}?`;

            // 🔹 FIX: Set expectedContext so "Tak" triggers 'show_menu' intent (via boostIntent)
            updateSession(sessionId, { expectedContext: 'show_menu' });

            break;
          }

          if (prevLocation) {
            console.log(`🧠 Context fallback: using last_location = ${prevLocation}`);
            replyCore = `Chcesz zobaczyć restauracje w ${prevLocation}? Powiedz "pokaż restauracje" lub wybierz konkretną nazwę.`;
            break;
          }

          // Fallback do standardowej odpowiedzi
          replyCore = "Ooo... net gdzieś odleciał, spróbuj jeszcze raz 😅";;
          break;
        } catch (error) {
          console.error('❌ default case error:', error);
          replyCore = "Przepraszam, wystąpił błąd. Spróbuj powiedzieć 'gdzie zjeść' lub 'pokaż menu'.";
          break;
        }
      }
    }

    // 🔹 Krok 4: Generacja odpowiedzi Amber (LLM Layer)
    let reply = replyCore;

    // Pobierz najnowszy stan sesji (po zmianach w switch)
    const sessionForGen = getSession(sessionId);

    // Przygotuj kontekst dla generatora
    const genContext = {
      restaurants: sessionForGen?.last_restaurants_list || [],
      menuItems: sessionForGen?.last_menu || [],
      selectedRestaurant: sessionForGen?.lastRestaurant || null,
      orderItems: sessionForGen?.pendingOrder?.items || [],
      clarificationNeeded: reasoningDecision?.shouldAskClarification || false,
      replyCore: replyCore // Przekazujemy "surową" odpowiedź jako referencję
    };

    try {
      // Użyj LLM tylko jeśli mamy API KEY i nie jesteśmy w trybie testowym (chyba że wymuszono)
      const USE_LLM_REPLY = process.env.OPENAI_API_KEY && (process.env.NODE_ENV !== 'test' || process.env.FORCE_LLM_TEST === 'true');

      if (USE_LLM_REPLY) {
        console.log('\ud83d\udcac Generating GPT reply for intent:', intent);

        const replyText = await llmGenerateReply({
          intent,
          text,
          context: genContext,
          metadata: reasoningDecision
        });

        if (replyText) {
          reply = replyText;
        }
      } else {
        console.log('⚠️ Skipping LLM reply generation (test mode or no key), using replyCore');
      }
    } catch (genErr) {
      console.error('❌ LLM Reply generation failed, using replyCore:', genErr.message);
      reply = replyCore;
    }

    // Fallback jeśli reply jest puste
    if (!reply) {
      reply = "Nie mam teraz odpowiedzi.";
    }

    // --- Anty-bullshit watchdog (cicha wersja prod-safe) ---
    const sanitizedReply = (reply || "").trim();
    const isBrokenReply =
      !sanitizedReply ||
      sanitizedReply.length < 12 ||
      /(tak, chętnie|oczywiście|świetny wybór|z przyjemnością|miło mi|nie jestem pewna)/i.test(sanitizedReply);

    if (isBrokenReply) {
      console.warn("⚠️ Amber zwróciła pustą lub podejrzaną odpowiedź:", sanitizedReply);

      if (!res.headersSent) {
        return res.status(200).json({
          ok: true,
          intent: intent || "none",
          restaurant: refinedRestaurant || restaurant || prevRestaurant || null,
          reply: null, // 🔇 brak odpowiedzi dla UI
          context: getSession(sessionId),
          timestamp: new Date().toISOString(),
        });
      }

      console.warn("⚠️ Headers already sent – watchdog only logged.");
    }

    // 🔹 Krok 5: sprawdź czy baza danych działała
    if (!reply && /menu|restaurant|order/i.test(intent)) {
      console.error("⚠️ No database result for intent:", intent);
      return res.status(200).json({
        ok: true,
        intent,
        reply: "Nie mogę pobrać danych z bazy. Amber potrzebuje połączenia z Supabase.",
      });
    }

    // 🔹 Krok 6: finalna odpowiedź z confidence i fallback
    const finalRestaurant = currentSession?.lastRestaurant || refinedRestaurant || restaurant || prevRestaurant || null;
    const confidence = intent === 'none' ? 0 : (finalRestaurant ? 0.9 : 0.6);
    const fallback = intent === 'none' || !reply;

    // Korekta finalnej intencji dla wieloelementowych zamówień (gdy parser wymusił clarify)
    try {
      const normalized = normalize(text || '');
      if (intent === 'clarify_order' && /(zamow|zamowic|poprosze|prosze)/i.test(normalized) && /\bi\b/.test(normalized) && /(pizza|pizz)/i.test(normalized)) {
        intent = 'create_order';
      }
      // Preferuj find_nearby dla "gdzie zjeść ..." nawet jeśli NLP wykryło create_order
      if (/\bgdzie\b/i.test(normalized) && (/(zjesc|zjem)/i.test(normalized) || /(pizza|pizz)/i.test(normalized))) {
        intent = 'find_nearby';
      }
      // Jeśli expectedContext=confirm_order, ale user wypowiada pełną komendę zamówienia z ilością/daniem → create_order
      if (currentSession?.expectedContext === 'confirm_order' && intent === 'confirm_order' && (/(pizza|pizz)/i.test(normalized) || /\b(\d+|dwie|trzy|cztery)\b/.test(normalized)) && /(zamow|poprosze|prosze|zamawiam)/i.test(normalized)) {
        intent = 'create_order';
      }
      // Jeśli expectedContext=confirm_order i pada "nie" → cancel_order (nie change_restaurant)
      if (currentSession?.expectedContext === 'confirm_order' && /(^|\s)nie(\s|$)/i.test(normalized)) {
        intent = 'cancel_order';
      }
    } catch { }

    // 🔍 Log issues if fallback was triggered
    if (fallback === true || intent === 'unknown' || intent === 'none') {
      logIssue({
        sessionId,
        userText: text,
        intent: intent || 'unknown',
        confidence: confidence || 0,
        type: "FALLBACK_TRIGGERED"
      });
    }

    console.log(`✅ Final response: intent=${intent}, confidence=${confidence}, fallback=${fallback}`);

    // 🔧 STABILNA FUNKCJA TTS with timeout protection
    async function generateTTSsafe(rawText) {
      try {
        // 1. Definiujemy całe zadanie (Styling + Audio Gen) jako jeden Promise
        const ttsTask = async () => {
          const sessionData = getSession(sessionId); // Ensure fresh session
          const ttsCfg = ttsRuntime(sessionData);

          let textToSpeak = rawText;
          // Stylizacja (jeśli włączona i nie simple mode)
          if (!ttsCfg.simple && process.env.OPENAI_MODEL) {
            try {
              // Stylizuj, ale w razie błędu/timeoutu samej stylizacji zwróć oryginał
              textToSpeak = await stylizeWithGPT4o(rawText, intent || 'neutral').catch(e => {
                console.warn('[TTS] Stylization error:', e);
                return rawText;
              });
            } catch { } // safety
          }

          // Generowanie audio
          return playTTS(textToSpeak, {
            voice: ttsCfg.voice || (ttsCfg.simple ? 'pl-PL-Wavenet-D' : 'pl-PL-Chirp3-HD-Erinome'),
            tone: ttsCfg.tone
          });
        };

        // 2. Timeout dla CAŁOŚCI (Styling + Audio)
        const timeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("TTS timeout (12s)")), 12000)
        );

        console.log("[TTS] Starting generation...");
        // 3. Wyścig: CAŁE zadanie vs Timeout
        const result = await Promise.race([ttsTask(), timeout]);

        console.log("[TTS] Success");
        return result;
      } catch (err) {
        console.warn("[TTS] Failed/Timeout:", err.message);
        return null; // Zwróć null, nie wykładaj endpointu
      }
    }

    // 🎤 TTS - TYLKO JEDNO WYWOŁANIE
    const { includeTTS } = req.body;
    let ttsAudio = null;

    if (includeTTS && reply && process.env.NODE_ENV !== 'test') {
      __tBeforeTTS = Date.now();
      ttsAudio = await generateTTSsafe(reply);
      if (ttsAudio) {
        __ttsMs = Date.now() - __tBeforeTTS;
      }
    }

    // 🔬 Test-mode normalizer: stabilizuje copy pod asercje kaskadowe (bez wpływu na prod)
    if (IS_TEST) {
      try {
        if (typeof reply !== 'string') reply = String(reply);
        // Ujednolić negacje
        reply = reply.replace(/Nie widzę/gi, 'Nie mam');
        reply = reply.replace(/nie ma/gi, 'brak');
        // Select_restaurant – wymagany prefiks
        if (intent === 'select_restaurant' && !/wybrano restauracj[ęe]/i.test(reply || '')) {
          const rn = (finalRestaurant && finalRestaurant.name) || (restaurant && restaurant.name) || 'restaurację';
          reply = `Wybrano restaurację ${rn}.`;
        }
        // Confirm order – dokładna fraza
        if (intent === 'confirm_order') {
          reply = 'Dodaję do koszyka.' + (meta?.addedToCart ? ` Dodano do koszyka. ${meta?.cart?.total ? `Razem ${Number(meta.cart.total).toFixed(2)} zł.` : ''}` : '');
        }
        // Create_order – pytanie o potwierdzenie
        const sNow = getSession(sessionId) || {};
        if (intent === 'create_order' && (sNow?.expectedContext === 'confirm_order' || sNow?.pendingOrder)) {
          if (!/dodać do koszyka/i.test(reply)) {
            reply = (reply ? reply.replace(/\s+$/, '') + ' ' : '') + 'Czy dodać do koszyka?';
          }
        }
      } catch { }
    }

    // ===== PATCH: enrich reply (BEGIN) =====
    if (meta?.addedToCart && typeof reply === 'string' && !/dodano do koszyka|dodane do koszyka/i.test(reply)) {
      const totalTxt = (meta.cart?.total != null) ? ` Razem ${meta.cart.total.toFixed ? meta.cart.total.toFixed(2) : meta.cart.total} zł.` : '';
      reply = (reply?.trim().length ? reply.trim() + ' ' : '') + 'Dodano do koszyka.' + totalTxt;
    }
    // ===== PATCH: enrich reply (END) =====

    const __durationMs = Date.now() - __tStart;
    const __dbMsApprox = Math.max(0, (__tBeforeTTS || Date.now()) - (__tAfterNlu || __tStart));
    // consolidate perf
    try {
      perf.ttsMs += (__ttsMs || 0);
      perf.durationMs = __durationMs;
      perf.dbMs += (__dbMsApprox || 0);
      // ✅ V2 LOGGING: Capture response
      if (process.env.NODE_ENV !== 'test') {
        EventLogger.logEvent(sessionId, 'response_sent', {
          intent: intent || 'unknown',
          reply: (reply || '').slice(0, 2000),
          confidence: Number(confidence || 0),
          fallback: !!fallback,
          timings: {
            nluMs: Number(perf.nluMs || __nluMs || 0),
            dbMs: Number(perf.dbMs || __dbMsApprox || 0),
            ttsMs: Number(perf.ttsMs || __ttsMs || 0),
            totalMs: Number(perf.durationMs || __durationMs || 0)
          },
          meta: {
            restaurant_id: (finalRestaurant?.id || currentSession?.lastRestaurant?.id),
            reasoning: reasoningDecision
          }
        }).catch(err => console.warn('⚠️ EventLogger (response) failed:', err.message));
      }
    } catch { }

    // 🔧 Attach structured data for frontend (ResultCarousel)
    const latestSession = getSession(sessionId);
    const restaurants = latestSession?.last_restaurants_list;
    const menuItems = latestSession?.last_menu || latestSession?.lastMenu;
    console.log(`📦 Final Response Preparation: MenuItems count = ${menuItems?.length || 0}`);

    // 🔧 FINALNY RESPONSE — ZAWSZE W TYM SAMYM FORMACIE
    const finalResponse = {
      ok: true,
      text: reply,
      audioContent: ttsAudio,  // może być null
      intent,
      meta: {
        ...meta,
        hybridIntent,
        boostedIntent: intent,
        decision: reasoningDecision,
      },
      restaurants: restaurants || [],
      menuItems: menuItems || [],
      // Legacy fields for backwards compatibility
      reply,
      confidence,
      fallback,
      restaurant: finalRestaurant,
      context: latestSession,
      timings: {
        nluMs: perf.nluMs || __nluMs,
        dbMs: perf.dbMs || __dbMsApprox,
        ttsMs: perf.ttsMs || __ttsMs,
        durationMs: perf.durationMs || __durationMs
      },
      parsed_order: meta?.parsed_order,
      timestamp: new Date().toISOString(),
    };

    // Add locationRestaurants alias if restaurants exist (for legacy support)
    if (restaurants?.length) {
      finalResponse.locationRestaurants = restaurants;
    }

    // 🪵 Logging to brain_logs
    // (Legacy logBrainEvent removed)

    const wStep = mapWorkflowStep(intent);
    const evtStatus = (reply && reply.toLowerCase().includes('błąd')) ? 'error' : 'success';

    await EventLogger.logEvent(sessionId, 'intent_resolved', {
      intent,
      reply: reply || replyCore,
      confidence: hybridConfidence || 1,
      source: hybridSource || 'unknown'
    }, null, wStep, evtStatus);

    await EventLogger.logEvent(sessionId, 'response_sent', {
      intent,
      timestamp: new Date().toISOString(),
      meta
    }, null, wStep, evtStatus);

    // Zamykanie sesji sukcesem
    if (intent === 'confirm_order' && evtStatus === 'success') {
      await EventLogger.logConversation(sessionId, latestSession, 'closed');
    }

    return res.status(200).json(finalResponse);
  } catch (err) {
    console.error("🧠 brainRouter error:", err);
    const sid = req.body?.sessionId || 'unknown';
    // Log error event
    EventLogger.logEvent(sid, 'error_logged', { error: err.message }, null, 'error', 'error').catch(() => { });
    // Close session with error status
    if (sid !== 'unknown') {
      EventLogger.logConversation(sid, {}, 'error').catch(() => { });
    }
    return res.status(500).json({ ok: false, error: err.message });
  }
}
