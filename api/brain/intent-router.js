import { supabase } from '../_supabase.js';
import { createOrder } from '../orders.js';
import { updateDebugSession } from './services/DebugSessionState.js';
import { getRestaurantAliases } from '../config/configService.js';

// ——— Utils: Import from helpers ———
import {
  normalize,
  stripDiacritics,
  normalizeTxt,
  expandRestaurantAliases,
  extractQuantity,
  extractSize,
  fuzzyIncludes as fuzzyIncludesHelper,
  levenshtein as levenshteinHelper
} from './helpers.js';

// Re-export for compatibility
export { normalize, stripDiacritics, normalizeTxt, extractQuantity, extractSize };

// Import functional intent detector (ETAP 1)
import {
  detectFunctionalIntent,
  FUNCTIONAL_INTENTS,
  isFunctionalIntent
} from './intents/functionalIntentDetector.js';

let aliasCache = { value: {}, ts: 0 };
async function getAliasMapCached() {
  const now = Date.now();
  if (aliasCache.value && (now - aliasCache.ts) < 60_000) {
    return aliasCache.value;
  }
  try {
    const data = await getRestaurantAliases();
    aliasCache = { value: data || {}, ts: Date.now() };
    return aliasCache.value;
  } catch {
    return aliasCache.value || {};
  }
}

function nameHasSize(name, size) {
  if (!size) return false;
  const n = normalizeTxt(name);
  return n.includes(String(size)) || (
    size === 26 && /\b(mala|mała|small)\b/.test(n) ||
    size === 32 && /\b(srednia|średnia|medium)\b/.test(n) ||
    size === 40 && /\b(duza|duża|large)\b/.test(n)
  );
}

function baseDishKey(name) {
  let n = normalizeTxt(name);
  n = n
    .replace(/\b(\d+\s*(cm|ml|g))\b/g, ' ')
    .replace(/\b(duza|duża|mala|mała|srednia|średnia|xl|xxl|small|medium|large)\b/g, ' ')
    .replace(/\(.*?\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (n.includes('margherita')) n = 'pizza margherita';
  if (n.includes('czosnkowa')) n = 'zupa czosnkowa';
  return n;
}

function dedupHitsByBase(hits, preferredSize = null) {
  const groups = new Map();
  for (const h of hits) {
    const key = `${h.restaurant_id}::${baseDishKey(h.name)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(h);
  }
  const selected = [];
  const clarifications = [];

  for (const [, arr] of groups) {
    if (arr.length === 1) {
      selected.push(arr[0]);
      continue;
    }
    // auto-pick po rozmiarze, jeśli podano w tekście
    if (preferredSize) {
      const pick = arr.find(x => nameHasSize(x.name, preferredSize));
      if (pick) { selected.push(pick); continue; }
    }
    // brak rozmiaru › pytamy
    clarifications.push({
      restaurant_id: arr[0].restaurant_id,
      restaurant_name: arr[0].restaurant_name,
      base: baseDishKey(arr[0].name),
      options: arr.map(x => ({ id: x.menuItemId, name: x.name, price: x.price }))
    });
  }
  return { selected, clarifications };
}

// Re-export fuzzyIncludes from helpers
export function fuzzyIncludes(name, text) {
  return fuzzyIncludesHelper(name, text);
}

const NAME_ALIASES = {
  // Zupy
  'czosnkowa': 'zupa czosnkowa',
  'czosnkowe': 'zupa czosnkowa',
  'czosnkowej': 'zupa czosnkowa',
  'zurek': 'żurek śląski',
  'zurku': 'żurek śląski',
  'zurkiem': 'żurek śląski',
  'pho': 'zupa pho bo',

  // Pizza
  'margherita': 'pizza margherita',
  'margherite': 'pizza margherita',
  'margerita': 'pizza margherita',  // częsty błąd STT
  'margarita': 'pizza margherita',  // częsty błąd STT
  'margheritą': 'pizza margherita',
  'pepperoni': 'pizza pepperoni',
  'hawajska': 'pizza hawajska',
  'hawajskiej': 'pizza hawajska',
  'diavola': 'pizza diavola',
  'diabolo': 'pizza diavola',       // częsty błąd STT/pronunciation
  'diabola': 'pizza diavola',       // częsty błąd STT/pronunciation
  'pizza diabolo': 'pizza diavola', // pełna nazwa z błędem
  'capricciosa': 'pizza capricciosa',

  // Mięsa
  'schabowy': 'kotlet schabowy',
  'schabowe': 'kotlet schabowy',
  'schabowego': 'kotlet schabowy',
  'kotlet': 'kotlet schabowy',
  'kotleta': 'kotlet schabowy',
  'gulasz': 'gulasz wieprzowy',
  'gulasza': 'gulasz wieprzowy',
  'gulaszem': 'gulasz wieprzowy',
  'rolada': 'rolada śląska',
  'rolade': 'rolada śląska',
  'rolady': 'rolada śląska',

  // Pierogi
  'pierogi': 'pierogi z mięsem',
  'pierogów': 'pierogi z mięsem',
  'pierogami': 'pierogi z mięsem',

  // Włoskie
  'lasagne': 'lasagne bolognese',
  'lasania': 'lasagne bolognese',  // częsty błąd STT
  'lasanie': 'lasagne bolognese',
  'tiramisu': 'tiramisu',
  'caprese': 'sałatka caprese',

  // Azjatyckie
  'pad thai': 'pad thai z krewetkami',
  'pad taj': 'pad thai z krewetkami',  // częsty błąd STT
  'padthai': 'pad thai z krewetkami',
  'sajgonki': 'sajgonki z mięsem',
  'sajgonek': 'sajgonki z mięsem',
  'sajgonkami': 'sajgonki z mięsem',

  // Napoje
  'kolę': 'coca-cola',

  // Inne
  'burger': 'burger',
  'burgera': 'burger',
  'placki': 'placki ziemniaczane',
  'placków': 'placki ziemniaczane',
  'frytki': 'frytki belgijskie',
  'frytek': 'frytki belgijskie',

  // Specjalny wyjątek: Głodzilla (Klaps Burgers) — łap także przekręcenia „godzilla”
  'głodzilla': 'głodzilla',
  'glodzilla': 'głodzilla',
  'godzilla': 'głodzilla',
  // krótsze rdzenie, aby złapać odmiany (np. „głodzillę”, „godzilli”, „glodzille”)
  'głodzil': 'głodzilla',
  'glodzil': 'głodzilla',
  'godzil': 'głodzilla',
};

/**
 * Deterministyczna mapa aliasów (zgodnie z wymaganiami)
 * Jeśli alias nie znaleziony › zwraca unknown_item, nie failuje
 */
const DETERMINISTIC_ALIAS_MAP = {
  // Napoje
  'cola': 'coca-cola',
  'kola': 'coca-cola',
  'kole': 'coca-cola',
  'kolę': 'coca-cola',
  'pepsi max': 'pepsi-max',
  'pepsi': 'pepsi',

  // Frytki
  'frytki': 'frytki belgijskie',
  'frytek': 'frytki belgijskie',
  'frytkami': 'frytki belgijskie',
  'małe frytki': 'fries_small',
  'duże frytki': 'fries_large',

  // Burgery
  'burger': 'burger',
  'burgera': 'burger',
  'burgery': 'burger',
  'vegas': 'smak vegas',

  // Pizza
  'margherita': 'pizza margherita',
  'margherite': 'pizza margherita',
  'margheritę': 'pizza margherita',
  'margheritą': 'pizza margherita',
  'margerita': 'pizza margherita',
  'margarita': 'pizza margherita',
  'pepperoni': 'pizza pepperoni',
  'hawajska': 'pizza hawajska',
  'hawajskiej': 'pizza hawajska',
  'diavola': 'pizza diavola',
  'diabolo': 'pizza diavola',
  'diabola': 'pizza diavola',
  'capricciosa': 'pizza capricciosa',

  // Zupy
  'czosnkowa': 'zupa czosnkowa',
  'czosnkowe': 'zupa czosnkowa',
  'czosnkowej': 'zupa czosnkowa',
  'zurek': 'żurek śląski',
  'zurku': 'żurek śląski',
  'zurkiem': 'żurek śląski',
  'pho': 'zupa pho bo',

  // Mięsa
  'schabowy': 'kotlet schabowy',
  'schabowe': 'kotlet schabowy',
  'schabowego': 'kotlet schabowy',
  'kotlet': 'kotlet schabowy',
  'kotleta': 'kotlet schabowy',
  'gulasz': 'gulasz wieprzowy',
  'gulasza': 'gulasz wieprzowy',
  'gulaszem': 'gulasz wieprzowy',
  'rolada': 'rolada śląska',
  'rolade': 'rolada śląska',
  'rolady': 'rolada śląska',

  // Pierogi
  'pierogi': 'pierogi z mięsem',
  'pierogów': 'pierogi z mięsem',
  'pierogami': 'pierogi z mięsem',

  // Włoskie
  'lasagne': 'lasagne bolognese',
  'lasania': 'lasagne bolognese',
  'lasanie': 'lasagne bolognese',
  'tiramisu': 'tiramisu',
  'caprese': 'sałatka caprese',

  // Azjatyckie
  'pad thai': 'pad thai z krewetkami',
  'pad taj': 'pad thai z krewetkami',
  'padthai': 'pad thai z krewetkami',
  'sajgonki': 'sajgonki z mięsem',
  'sajgonek': 'sajgonki z mięsem',
  'sajgonkami': 'sajgonki z mięsem',

  // Inne
  'placki': 'placki ziemniaczane',
  'placków': 'placki ziemniaczane',
  'głodzilla': 'głodzilla',
  'glodzilla': 'głodzilla',
  'godzilla': 'głodzilla'
};

/**
 * applyAliases - deterministyczna mapa aliasów z bezpiecznym fallbackiem
 * 
 * ZMIANA ZACHOWANIA:
 * - Używa deterministycznej mapy aliasów (nie fuzzy-match)
 * - Jeśli alias nie znaleziony › zwraca oryginalny tekst (nie failuje)
 * - NIE throw, NIE failuj, zawsze zwraca string
 * 
 * @param {string} text - Tekst do przetworzenia
 * @returns {string} - Tekst z zastosowanymi aliasami lub oryginał
 */
export function applyAliases(text) {
  // Bezpieczny fallback dla pustego/null/undefined
  if (!text || typeof text !== 'string') {
    return '';
  }

  const original = String(text).trim();
  if (!original) {
    return '';
  }

  let normalized = normalizeTxt(original);
  let output = original;
  let anyReplacement = false;

  // Przeszukaj deterministyczną mapę aliasów
  for (const [alias, fullName] of Object.entries(DETERMINISTIC_ALIAS_MAP)) {
    const aliasNorm = normalizeTxt(alias);
    const fullNorm = normalizeTxt(fullName);

    // Sprawdź czy znormalizowany tekst zawiera alias
    if (normalized.includes(aliasNorm) && !normalized.includes(fullNorm)) {
      // Spróbuj podmienić w oryginalnym tekście (zachowaj diakrytyki)
      const origRegex = new RegExp(alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      if (origRegex.test(output)) {
        output = output.replace(origRegex, fullName);
        anyReplacement = true;
      } else {
        // Fallback: zamień w wersji znormalizowanej
        normalized = normalized.replace(new RegExp(aliasNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), fullNorm);
        output = normalized;
        anyReplacement = true;
      }

      // Aktualizuj normalized dla kolejnych iteracji
      normalized = normalizeTxt(output);
    }
  }

  // Zawsze zwróć string (nawet jeśli brak zamian)
  return anyReplacement ? output : original;
}

function fuzzyMatch(a, b) {
  if (!a || !b) return false;
  a = normalize(a);
  b = normalize(b);
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const dist = levenshteinHelper(a, b);
  return dist <= 2;
}

// ——— Menu catalog & order parsing ———
function isValidRestaurantContextId(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  // Session identifiers (sess_...) must never be used as restaurant_id.
  if (/^sess[_-]/i.test(trimmed)) return false;
  return true;
}

async function loadMenuCatalog(session) {
  // Preferujemy wyłącznie identyfikatory restauracji z kontekstu restauracji.
  // Nigdy nie używamy session.id jako restaurant_id.
  const idCandidates = [
    session?.currentRestaurant?.id,
    session?.lastRestaurant?.id,
    session?.restaurant?.id,
    session?.last_menu_restaurant_id,
  ];
  const lastId = idCandidates.find(isValidRestaurantContextId) || null;

  console.log(`[loadMenuCatalog] ?? Session:`, session);
  console.log(`[loadMenuCatalog] ?? lastRestaurant:`, session?.lastRestaurant);
  console.log(`[loadMenuCatalog] ?? lastId:`, lastId);

  try {
    let query = supabase
      .from('menu_items_v2')
      .select('id,name,price_pln,restaurant_id')
      .limit(500); // lekko, ale wystarczy

    if (lastId) {
      query = query.eq('restaurant_id', lastId);
      console.log(`[loadMenuCatalog] ? Loading menu for restaurant: ${lastId} (${session?.lastRestaurant?.name})`);
    } else {
      console.log(`[loadMenuCatalog] ?? Loading all menu items (no restaurant in session)`);
    }

    // ?? Timeout protection: 3s max dla menu query
    const startTime = Date.now();
    const { data: menuItems, error: menuError } = await Promise.race([
      query,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Menu query timeout (3s)')), 3000)
      )
    ]);

    const queryDuration = Date.now() - startTime;
    if (queryDuration > 1000) {
      console.warn(`?? Slow menu query: ${queryDuration}ms`);
    }

    if (menuError) {
      console.error('[intent-router] menu load error', menuError);
      return [];
    }

    if (!menuItems?.length) {
      console.warn('[intent-router] No menu items found');
      return [];
    }

    // Pobierz nazwy restauracji
    const restaurantIds = [...new Set(menuItems.map(mi => mi.restaurant_id))];

    // ?? Timeout protection: 2s max dla restaurants query
    const restStartTime = Date.now();
    const { data: restaurants, error: restError } = await Promise.race([
      supabase
        .from('restaurants')
        .select('id,name')
        .eq('is_active', true)
        .in('id', restaurantIds),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Restaurants query timeout (2s)')), 2000)
      )
    ]);

    const restQueryDuration = Date.now() - restStartTime;
    if (restQueryDuration > 1000) {
      console.warn(`?? Slow restaurants query: ${restQueryDuration}ms`);
    }

    if (restError) {
      console.error('[intent-router] restaurants load error', restError);
      return [];
    }

    const restaurantMap = {};
    restaurants?.forEach(r => {
      restaurantMap[r.id] = r.name;
    });

    const catalog = menuItems.map(mi => ({
      id: mi.id,
      name: mi.name,
      price: mi.price_pln,
      restaurant_id: mi.restaurant_id,
      restaurant_name: restaurantMap[mi.restaurant_id] || 'Unknown'
    }));

    console.log(`[loadMenuCatalog] ? Loaded ${catalog.length} menu items from ${restaurantIds.length} restaurants`);
    console.log(`[loadMenuCatalog] ? Sample items:`, catalog.slice(0, 3).map(c => c.name).join(', '));
    return catalog;
  } catch (err) {
    console.error('[intent-router] loadMenuCatalog error:', err.message);
    return [];
  }
}

function extractRequestedItems(text) {
  // Wyodrębnij żądane pozycje z tekstu (proste rozpoznawanie po aliasach i nazwach)
  const normalized = normalizeTxt(text);
  const requestedSet = new Set();

  // Sprawdź aliasy
  for (const [alias, fullName] of Object.entries(NAME_ALIASES)) {
    if (normalized.includes(alias)) {
      requestedSet.add(fullName);
    }
  }

  return Array.from(requestedSet).map(name => ({ name }));
}

// Rozpoznaj wiele dań w jednym tekście (split by "i", "oraz", ",")
function splitMultipleItems(text) {
  // Usuń słowa kluczowe zamówienia
  let cleaned = text
    .replace(/\b(zamów|zamówić|poproszę|chcę|wezmę|chciałbym|chciałabym)\b/gi, '')
    .trim();

  // Split by separators
  const parts = cleaned.split(/\s+(i|oraz|,)\s+/i).filter(p => p && !['i', 'oraz', ','].includes(p.toLowerCase()));

  // Jeśli nie ma separatorów, zwróć cały tekst
  if (parts.length <= 1) {
    return [text];
  }

  return parts;
}

export function parseOrderItems(text, catalog) {
  // Null checks
  if (!text || typeof text !== 'string') {
    console.warn('[parseOrderItems] Invalid text input:', text);
    return {
      any: false,
      groups: [],
      clarify: [],
      available: [],
      unavailable: [],
      needsClarification: false,
      missingAll: true
    };
  }

  // 1. Strip courtesy/order prefixes EARLY to prevent "Poproszę X" becoming an unknown item
  const PREFIXES = /^(poproszę|zamawiam|wezmę|dodaj|chciałbym|chciałabym|proszę|biorę|dla\s+mnie)\s+/i;
  let cleanText = text.replace(PREFIXES, '').trim();

  // 2. STOP PHRASES: Menu/exploratory questions are NOT dish items
  // "co oferują", "jakie macie", "menu" should not be parsed as order items
  const STOP_PHRASES = [
    'co oferują', 'co oferujecie', 'co macie', 'jakie macie',
    'menu', 'pokaż menu', 'pokaz menu', 'oferta', 'karta',
    'co polecasz', 'co polecacie', 'polecisz', 'polecicie',
    'co jest', 'jakie są', 'jakie sa', 'co mają', 'co maja'
  ];

  const normalizedClean = normalizeTxt(cleanText);
  for (const phrase of STOP_PHRASES) {
    if (normalizedClean.includes(phrase) || normalizedClean === phrase) {
      console.log(`[parseOrderItems] ??? STOP PHRASE detected: "${phrase}" - not a dish order`);
      return {
        any: false,
        groups: [],
        clarify: [],
        available: [],
        unavailable: [],
        needsClarification: false,
        missingAll: false,
        stopPhrase: phrase  // Mark as stop phrase for debugging
      };
    }
  }

  // Use cleanText for alias application and further processing
  let textAliased;
  let unknownItems = [];

  try {
    textAliased = applyAliases(cleanText);
    // Jeśli applyAliases zwróciło oryginał i nie znalazło aliasu,
    // sprawdź czy to może być unknown_item
    if (textAliased === cleanText) {
      // Sprawdź czy tekst nie pasuje do żadnego aliasu
      const normalized = normalizeTxt(cleanText);
      const hasKnownAlias = Object.keys(DETERMINISTIC_ALIAS_MAP).some(alias =>
        normalized.includes(normalizeTxt(alias))
      );
      if (!hasKnownAlias && cleanText.trim().length > 0) {
        // Może być unknown_item - zapisz do późniejszej weryfikacji
        unknownItems.push({ name: cleanText, reason: 'no_alias_match' });
      }
    }
  } catch (err) {
    console.warn('[parseOrderItems] applyAliases error:', err.message);
    textAliased = cleanText; // Fallback do oryginału
    unknownItems.push({ name: cleanText, reason: 'alias_error' });
  }

  const preferredSize = extractSize(textAliased);
  const requestedItems = extractRequestedItems(cleanText);

  // Obsługa pustego menu lub braku katalogu
  if (!catalog || !Array.isArray(catalog) || catalog.length === 0) {
    console.warn('[parseOrderItems] Invalid or empty catalog:', catalog);
    return {
      any: false,
      groups: [],
      clarify: [],
      available: [],
      unavailable: requestedItems?.map(i => i.name).filter(Boolean) || [],
      needsClarification: true, // Wymaga wyjaśnienia (brak katalogu)
      missingAll: true,
      unknownItems: unknownItems
    };
  }

  // Multi-item parsing: split text by "i", "oraz", ","
  // Bezpieczne parsowanie - nie throw
  let itemTexts = [];
  try {
    itemTexts = splitMultipleItems(textAliased);
  } catch (err) {
    console.warn('[parseOrderItems] splitMultipleItems error:', err.message);
    itemTexts = [textAliased]; // Fallback do całego tekstu
  }

  const allHits = [];

  function normalizePlural(word) {
    if (!word) return '';
    return String(word)
      .replace(/i$/, '')
      .replace(/y$/, '')
      .replace(/ów$/, '')
      .replace(/ami$/, '')
      .replace(/ach$/, '');
  }

  for (const itemText of itemTexts) {
    if (!itemText || typeof itemText !== 'string') continue;

    try {
      const qty = extractQuantity(itemText) || 1; // Domyślnie 1 jeśli brak ilości
      const hits = catalog
        .filter(it => {
          try {
            if (!it || !it.name) return false;

            // 1. Spróbuj exact/fuzzy
            if (fuzzyIncludes(it.name, itemText)) return true;

            // 2. Fallback plural
            const normalizedInput = normalizePlural(itemText.toLowerCase());
            const normalizedMenu = normalizePlural(it.name.toLowerCase());

            if (normalizedInput.includes(normalizedMenu) || normalizedMenu.includes(normalizedInput)) {
              return true;
            }

            return false;
          } catch (err) {
            console.warn('[parseOrderItems] processing error:', err.message);
            return false; // Bezpieczne - nie dopasuj jeśli błąd
          }
        })
        .map(it => ({
          menuItemId: it.id || null,
          name: it.name || 'Unknown',
          price: typeof it.price === 'number' ? it.price : 0, // Bezpieczna konwersja
          quantity: qty,
          restaurant_id: it.restaurant_id || null,
          restaurant_name: it.restaurant_name || 'Unknown',
          matchScore: 1.0
        }));
      allHits.push(...hits);
    } catch (err) {
      console.warn('[parseOrderItems] Error processing item:', itemText, err.message);
      // Kontynuuj z następnym itemem - nie failuj całego parsowania
      unknownItems.push({ name: itemText, reason: `processing_error: ${err.message}` });
    }
  }

  // Bezpieczne deduplikowanie
  let selected = [];
  let clarifications = [];
  try {
    const dedupResult = dedupHitsByBase(allHits, preferredSize);
    selected = dedupResult.selected || [];
    clarifications = dedupResult.clarifications || [];
  } catch (err) {
    console.warn('[parseOrderItems] dedupHitsByBase error:', err.message);
    selected = allHits; // Fallback - użyj wszystkich hitów
    clarifications = [];
  }

  // Sprawdź czy są niedostępne pozycje (fallback) – nie psuj głównego dopasowania
  // Bezpieczne filtrowanie - nie throw
  const matched = (selected || []).filter(h => {
    try {
      return h && (h.matchScore || 0) > 0.75;
    } catch {
      return false;
    }
  });

  const requestedNames = (requestedItems || []).map(i => {
    try {
      return i && i.name ? i.name.toLowerCase() : '';
    } catch {
      return '';
    }
  }).filter(Boolean);

  const availableNames = matched.map(m => {
    try {
      return m && m.name ? m.name.toLowerCase() : '';
    } catch {
      return '';
    }
  }).filter(Boolean);

  // Helper do bezpiecznego fuzzy porównania nazwy dania (nie throw)
  const fuzzyNameHit = (needle, haystackName) => {
    try {
      if (!needle || !haystackName) return false;
      const n = normalizeTxt(needle);
      const h = normalizeTxt(haystackName);
      if (!n || !h) return false;
      if (h.includes(n) || n.includes(h)) return true;
      // lżejszy próg: przynajmniej 1 wspólny token >2 znaków
      const toks = n.split(' ').filter(Boolean).filter(t => t.length > 2);
      return toks.some(t => h.includes(t));
    } catch {
      return false; // Bezpieczne - nie dopasuj jeśli błąd
    }
  };

  // Pozycję uznajemy za „dostępną”, jeśli:
  // - jest w matched (availableNames) ORAZ fuzzy pasuje, LUB
  // - nie jest w matched (np. wymaga doprecyzowania rozmiaru), ale występuje w całym katalogu (też fuzzy)
  const unavailableNames = requestedNames.filter(requestedName => {
    // 1) Sprawdź na liście już dopasowanych
    const inMatched = availableNames.some(an => fuzzyNameHit(requestedName, an));
    if (inMatched) return false;

    // 2) Sprawdź w całym katalogu (by nie oznaczać jako unavailable, gdy są warianty wymagające clarify)
    const existsInCatalog = catalog.some(it => fuzzyNameHit(requestedName, it?.name));
    return !existsInCatalog;
  });

  console.log(`[parseOrderItems] ?? Summary:`);
  console.log(`  - requestedNames: [${requestedNames.join(', ')}]`);
  console.log(`  - availableNames: [${availableNames.join(', ')}]`);
  console.log(`  - unavailableNames: [${unavailableNames.join(', ')}]`);
  console.log(`  - matched.length: ${matched.length}`);
  console.log(`  - clarifications.length: ${clarifications?.length || 0}`);

  // Bezpieczne grupowanie - nie throw
  const byR = {};
  for (const h of matched) {
    try {
      if (!h || !h.restaurant_id) continue; // Pomiń nieprawidłowe hitów
      const restaurantId = h.restaurant_id;
      if (!byR[restaurantId]) {
        byR[restaurantId] = {
          restaurant_id: restaurantId,
          restaurant_name: h.restaurant_name || 'Unknown',
          items: []
        };
      }
      byR[restaurantId].items.push({
        menuItemId: h.menuItemId || null,
        name: h.name || 'Unknown',
        price: typeof h.price === 'number' ? h.price : 0,
        quantity: typeof h.quantity === 'number' ? h.quantity : 1
      });
    } catch (err) {
      console.warn('[parseOrderItems] Error grouping item:', err.message);
      // Kontynuuj z następnym itemem
    }
  }

  // Jeśli są unknown items i nie znaleziono dopasowań, dodaj je do unavailable
  const finalUnavailable = [...unavailableNames];
  if (unknownItems.length > 0 && matched.length === 0 && allHits.length === 0) {
    unknownItems.forEach(item => {
      if (!finalUnavailable.includes(item.name)) {
        finalUnavailable.push(item.name);
      }
    });
  }

  return {
    any: Object.values(byR).length > 0,  // FIX: true ONLY when real grouped matches exist (not just raw hits)
    groups: Object.values(byR),
    clarify: clarifications || [],
    available: matched || [],
    unavailable: finalUnavailable,
    needsClarification: finalUnavailable.length > 0 || (clarifications && clarifications.length > 0) || unknownItems.length > 0,
    unknownItems: unknownItems // Nowe pole dla nieznanych pozycji
  };
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
    setTimeout(() => reject(new Error(`?? Timeout: ${operationName} exceeded ${timeoutMs}ms`)), timeoutMs);
  });

  const startTime = Date.now();
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    const duration = Date.now() - startTime;
    if (duration > 2000) {
      console.warn(`?? Slow operation: ${operationName} took ${duration}ms`);
    }
    return result;
  } catch (err) {
    const duration = Date.now() - startTime;
    console.error(`? ${operationName} failed after ${duration}ms:`, err.message);
    throw err;
  }
}

/**
 * Bezpieczny fallback - zawsze zwraca jakiś intent
 */
function safeFallbackIntent(text, reason = 'unknown_error') {
  return {
    intent: 'UNKNOWN_INTENT',
    confidence: 0,
    reason: reason,
    rawText: text || '',
    restaurant: null,
    fallback: true
  };
}

// Helper do wykrywania intencji eksploracyjnej (pytania o menu/ofertę)
function isExploratory(text) {
  const t = normalizeTxt(text);
  if (/^(co|jakie)\s+(jest|s[aą]|macie|oferujecie|polecasz)/.test(t)) return true;
  if (/\b(menu|karta|oferta|cennik)\b/.test(t)) return true;
  if (/^poka[zż]/.test(t) && !/\b(zamawiam|bior[ęe]|poprosz[ęe])\b/.test(t)) return true;
  return false;
}

function isExplicitCheckoutBridge(text = '') {
  const raw = String(text || '').trim();
  const t = normalizeTxt(raw);

  if (!t) return false;

  const hasCheckoutAction =
    /\b(checkout\w*|kasa|platnosc\w*|zaplac\w*|finaliz\w*|zloz(?:yc)?\s+zamowienie|przejd[zź](?:my)?\s+do\s+platnosci)\b/i.test(t) ||
    /\b(pokaz|podejrze\w*|podejrzyj|podglad\w*|zobacz|sprawdz|otworz|idz|przejd[zź](?:my)?)\b.*\b(koszyk\w*|zam[oó]wienie\w*)\b/i.test(t) ||
    /\b(chcial?bym|chcialabym|chce)\b.*\b(podejrze\w*|podejrzyj|zobacz|sprawdz)\b.*\b(koszyk\w*|zam[oó]wienie\w*)\b/i.test(t) ||
    /^\s*(koszyk|zam[oó]wienie)\s*$/i.test(t);

  const isAddToCartCommand = /\b(dodaj|dorzuc|wrzuc)\b.*\bdo\b.*\bkoszyk\w*\b/i.test(t);
  return hasCheckoutAction && !isAddToCartCommand;
}

export async function detectIntent(text, session = null, entities = {}) {
  console.log('[intent-router] ?? detectIntent called with:', { text, sessionId: session?.id });

  // Bezpieczny fallback dla pustego inputu
  if (!text || typeof text !== 'string' || !text.trim()) {
    const fallback = safeFallbackIntent(text, 'empty_input');
    updateDebugSession({
      intent: fallback.intent,
      restaurant: null,
      sessionId: session?.id || null
    });
    return fallback;
  }

  try {
    // ==========================================
    // ETAP 1: DETEKCJA INTENCJI FUNKCJONALNEJ
    // ==========================================
    // Wykryj intencję NA PODSTAWIE ZAMIARU, nie frazy
    const functionalIntent = detectFunctionalIntent(text, session);

    // Jeśli wykryto funkcjonalny intent (ADD_ITEM, CONTINUE_ORDER, etc.)
    // i ma wysoką pewność, zwróć go od razu (bez parsowania treści)
    if (isFunctionalIntent(functionalIntent.intent) && functionalIntent.confidence >= 0.85) {
      console.log(`[intent-router] ? Functional intent detected: ${functionalIntent.intent} (confidence: ${functionalIntent.confidence})`);

      // Mapuj funkcjonalne intenty na intenty używane w systemie
      let mappedIntent = functionalIntent.intent;
      if (functionalIntent.intent === FUNCTIONAL_INTENTS.CONFIRM_ORDER) {
        mappedIntent = 'confirm_order';
      } else if (functionalIntent.intent === FUNCTIONAL_INTENTS.CANCEL_ORDER) {
        mappedIntent = 'cancel_order';
      } else if (functionalIntent.intent === FUNCTIONAL_INTENTS.ADD_ITEM ||
        functionalIntent.intent === FUNCTIONAL_INTENTS.CONTINUE_ORDER) {
        mappedIntent = 'create_order'; // ADD_ITEM i CONTINUE_ORDER › create_order
      }

      updateDebugSession({
        intent: mappedIntent,
        restaurant: null,
        sessionId: session?.id || null,
        confidence: functionalIntent.confidence
      });

      return {
        intent: mappedIntent,
        confidence: functionalIntent.confidence,
        reason: functionalIntent.reason,
        rawText: functionalIntent.rawText,
        restaurant: null,
        functionalIntent: functionalIntent.intent // Zachowaj oryginalny funkcjonalny intent
      };
    }

    // ==========================================
    // ETAP 2: PARSOWANIE TREŚCI (CO KONKRETNIE)
    // ==========================================
    // Dopiero po wykryciu intentu parsuj produkty, ilości, warianty

    // --- Korekta STT / lokalizacji ---
    let normalizedText = text.toLowerCase()
      .replace(/\bsokolica\b/g, "okolicy") // typowa halucynacja STT
      .replace(/\bw\s*okolice\b/g, "w okolicy") // brak spacji itp.
      .replace(/\bw\s*okolicach\b/g, "w okolicy")
      .replace(/\bpizzeriach\b/g, "pizzerie") // dopasowanie intencji
      .trim();

    const lower = normalizeTxt(normalizedText);

    if (isExplicitCheckoutBridge(text)) {
      updateDebugSession({
        intent: 'open_checkout',
        restaurant: session?.lastRestaurant?.name || null,
        sessionId: session?.id || null,
        confidence: 0.98
      });
      return {
        intent: 'open_checkout',
        confidence: 0.98,
        source: 'explicit_checkout_bridge_classic',
        restaurant: session?.lastRestaurant || session?.currentRestaurant || null
      };
    }

    // ?? SUPER-EARLY EXIT: Pytania "gdzie zjeść …" zawsze traktuj jako find_nearby
    // niezależnie od kontekstu sesji (żeby nie przechodziło w create_order gdy jest "pizza")
    if (/\bgdzie\b/.test(lower)) {
      updateDebugSession({ intent: 'find_nearby', restaurant: null, sessionId: session?.id || null, confidence: 0.85 });
      return { intent: 'find_nearby', restaurant: null };
    }

    // ======================================================================
    // GREETING GATE — EARLY EXIT (prevents catalog load on neutral input)
    // Must run BEFORE any catalog/menu/parseOrderItems calls.
    // ======================================================================
    const GREETING_PATTERNS = /^(cze[sś][cć]|hej|hej\s|witaj|dzień\s+dobry|dzien\s+dobry|siema|siemanko|yo|hi|hello|dobry\s+wieczór|dobry\s+wieczor|dobranoc|serwus|moro|hejka|elo|cześć|czesc)([!.,?\s].*)?$/i;
    if (GREETING_PATTERNS.test(text.trim())) {
      console.log('[intent-router] ?? GREETING GATE: Detected greeting – skipping catalog load.');
      updateDebugSession({ intent: 'greeting', restaurant: null, sessionId: session?.id || null, confidence: 1.0 });
      return { intent: 'greeting', confidence: 1.0, source: 'greeting_gate', restaurant: null };
    }

    // ===========================================
    // HOURS INTENT (FAQ)
    // ===========================================
    const hoursPatterns = [
      /do której/i,
      /godzin/i,
      /czynne/i,
      /zamykacie/i,
      /otwarte/i
    ];

    if (hoursPatterns.some(r => r.test(text))) {
      return {
        intent: 'restaurant_hours',
        confidence: 0.95,
        source: 'faq_guard',
        entities: {},
        domain: 'system'
      };
    }

    // ——— CONFIRM FLOW - DELEGATED TO boostIntent() in brainRouter.js ———
    // Logika potwierdzania zamówień jest teraz obsługiwana przez:
    // 1. boostIntent() w brainRouter.js (wykrywa confirm_order/cancel_order)
    // 2. case "confirm_order" i "cancel_order" w brainRouter.js
    // Ta sekcja została usunięta, aby uniknąć konfliktów z session.pendingOrder

    // ——— EARLY DISH DETECTION (PRIORITY 1) ———
    console.log('[intent-router] ?? Starting early dish detection for text:', text);
    console.log('[intent-router] ?? Normalized text:', normalizedText);

    // ?? KROK 1: Priorytetyzuj kontekst sesji
    // Sprawdź czy użytkownik ma już restaurację w sesji
    let targetRestaurant = null;
    let restaurantsList = null; // ?? Cache dla późniejszego użycia
    const hasSessionRestaurant = session?.currentRestaurant?.id || session?.lastRestaurant?.id;

    console.log(`[intent-router] ?? Session restaurant: ${hasSessionRestaurant ? session.lastRestaurant.name : 'NONE'}`);

    // ?? Sprawdź czy tekst zawiera silne wskaźniki nowej restauracji
    const hasRestaurantIndicators = /\b(w|z|restauracja|restauracji|pizzeria|pizzerii|menu\s+w|menu\s+z)\b/i.test(normalizedText);
    console.log(`[intent-router] ?? Restaurant indicators in text: ${hasRestaurantIndicators}`);

    // ?? Uruchom agresywne wykrywanie restauracji TYLKO jeśli:
    // 1. NIE MA restauracji w sesji, LUB
    // 2. Tekst zawiera silne wskaźniki nowej restauracji
    const shouldSearchRestaurants = !hasSessionRestaurant || hasRestaurantIndicators;

    if (shouldSearchRestaurants) {
      console.log(`[intent-router] ?? Searching for restaurant in text (reason: ${!hasSessionRestaurant ? 'no session restaurant' : 'has indicators'})`);

      try {
        // ?? Optimization: If we are in selection mode, restrict search to the list from session
        const isSelectionMode = session?.expectedContext === 'select_restaurant' || session?.expectedContext === 'confirm_show_restaurants_city';
        const sessionList = session?.lastRestaurants || session?.last_restaurants_list;

        if (isSelectionMode && Array.isArray(sessionList) && sessionList.length > 0) {
          console.log(`[intent-router] ?? Restricted search to ${sessionList.length} restaurants from session`);
          restaurantsList = sessionList;
        } else {
          // ?? Timeout protection: 3s max dla query
          const restaurantsQuery = supabase
            .from('restaurants')
            .select('id, name')
            .eq('is_active', true);

          const { data } = await withTimeout(
            restaurantsQuery,
            3000,
            'restaurants query in detectIntent'
          );
          restaurantsList = data; // ?? Zapisz do cache
        }

        if (restaurantsList?.length) {
          console.log(`[intent-router] ?? Checking ${restaurantsList.length} restaurants for fuzzy match`);

          // ?? Early exit: sprawdź najpierw exact match (szybkie)
          for (const r of restaurantsList) {
            const normalizedName = normalizeTxt(r.name);
            if (normalizedText.includes(normalizedName)) {
              targetRestaurant = r;
              console.log(`[intent-router] ?? Restaurant detected in text (exact): ${r.name}`);
              break; // ?? Early exit
            }
          }

          // ?? Fuzzy match tylko jeśli exact match nie zadziałał
          if (!targetRestaurant) {
            const textWords = normalizedText.split(' ');

            for (const r of restaurantsList) {
              const normalizedName = normalizeTxt(r.name);
              const nameWords = normalizedName.split(' ');
              let matchedWords = 0;

              for (const nameWord of nameWords) {
                // ?? Optymalizacja: sprawdź najpierw exact match słowa (szybkie)
                if (textWords.includes(nameWord)) {
                  matchedWords++;
                  continue;
                }

                // ?? Levenshtein alleen voor woorden >= 7 znaków (krótkie słowa › exact match)
                // Dit voorkomt "testy"›"tasty" false positive
                if (nameWord.length >= 7) {
                  for (const textWord of textWords) {
                    // Only compare if lengths are similar (±2 chars)
                    if (Math.abs(textWord.length - nameWord.length) <= 2 && textWord.length >= 7) {
                      const dist = levenshteinHelper(textWord, nameWord);
                      if (dist <= 1) {
                        matchedWords++;
                        break; // ?? Early exit z inner loop
                      }
                    }
                  }
                }
              }

              // ?? Stricter threshold: require 3/4 of words to match (było 1/2)
              const threshold = Math.ceil(nameWords.length * 0.75);
              if (matchedWords >= threshold) {
                targetRestaurant = r;
                console.log(`[intent-router] ?? Restaurant detected in text (fuzzy): ${r.name} (matched: ${matchedWords}/${nameWords.length})`);
                break; // ?? Early exit
              }
            }
          }
        } else {
          console.log(`[intent-router] ? No restaurants found in database`);
        }
      } catch (err) {
        console.error('[intent-router] ? Error searching restaurants:', err.message);
        // ?? Nie rzucaj błędu - kontynuuj z session restaurant
      }
    } else {
      console.log(`[intent-router] ?? Skipping restaurant search - using session restaurant: ${session.lastRestaurant.name}`);
    }

    // ?? KROK 2: Załaduj katalog menu
    // Priorytet: targetRestaurant (z tekstu) > session.lastRestaurant
    try {
      const sessionWithRestaurant = targetRestaurant
        ? { ...session, lastRestaurant: targetRestaurant, currentRestaurant: targetRestaurant }
        : (session?.lastRestaurant ? session : {
          ...session,
          lastRestaurant: session?.currentRestaurant || session?.lastRestaurant || session?.restaurant || null
        });

      // ?? Timeout protection: 5s max dla loadMenuCatalog
      const catalog = await withTimeout(
        loadMenuCatalog(sessionWithRestaurant),
        5000,
        'loadMenuCatalog in detectIntent'
      );
      console.log(`[intent-router] Catalog loaded: ${catalog.length} items`);

      // ======================================================================
      // ORDER PARSING GATE — only call parseOrderItems when there is evidence
      // of an actual order intent. This prevents neutral/greeting inputs from
      // cascading into choose_restaurant via fuzzy catalog matching.
      // Conditions (any one sufficient):
      //   a) text contains a known dish alias
      //   b) text contains a quantity indicator ("2x", "trzy", …)
      //   c) text contains an explicit order verb
      //   d) session already has a currentRestaurant/lastRestaurant context
      // ======================================================================
      const ORDER_VERB_GATE = /\b(zamawiam|zamów|zamow|poproszę|proszę|poprosz[ęe]|chcę|chce|wezmę|wezm[ęe]|biore|bior[ęe]|dodaj|dla\s+mnie|chciał(bym|abym)|skusz[ęe]|zdecyduj[ęe]|lec[ęe]\s+na)\b/i;
      const QUANTITY_GATE = /\b(\d+\s*(x|razy|sztuk)?|dwa|dwie|trzy|cztery|pięć|jeden|jedna)\b/i;
      const DISH_ALIAS_GATE = new RegExp(
        Object.keys(DETERMINISTIC_ALIAS_MAP)
          .sort((a, b) => b.length - a.length) // longest first
          .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('|'),
        'i'
      );
      const hasSessionRestaurantCtx = !!(session?.lastRestaurant?.id || session?.currentRestaurant?.id);

      const passesOrderGate =
        ORDER_VERB_GATE.test(normalizedText) ||
        QUANTITY_GATE.test(normalizedText) ||
        DISH_ALIAS_GATE.test(normalizeTxt(normalizedText)) ||
        hasSessionRestaurantCtx;

      if (!passesOrderGate) {
        console.log(`[intent-router] ??? ORDER PARSING GATE: No order evidence in "${text}" – skipping parseOrderItems.`);
      } else if (catalog.length && !isExploratory(normalizedText)) {
        console.log('[intent-router] ?? Calling parseOrderItems...');
        console.log('[intent-router] ?? Catalog items:', catalog.map(c => c.name).join(', '));
        const parsed = parseOrderItems(normalizedText, catalog);
        console.log(`[intent-router] ? Parsed result:`, JSON.stringify(parsed, null, 2));
        console.log(`[intent-router] ?? parsed.any = ${parsed.any}`);
        console.log(`[intent-router] ?? parsed.groups.length = ${parsed.groups?.length || 0}`);

        // Obsługa pustego menu
        if (parsed.missingAll) {
          console.log('?? No menu items found in catalog');
          updateDebugSession({
            intent: 'no_menu_items',
            restaurant: null,
            sessionId: session?.id || null,
            confidence: 0.8
          });
          return {
            intent: 'no_menu_items',
            reply: 'Nie znalazłam żadnych pozycji w menu tej restauracji. Może chcesz sprawdzić coś innego?',
            confidence: 0.8,
            fallback: true
          };
        }

        // Sprawdź czy są niedostępne pozycje (nawet jeśli parsed.any === false)
        // ?? ALE: jeśli tekst zawiera nazwę restauracji, to nie zwracaj clarify_order
        // (user może mówić np. "klaps burger" = nazwa restauracji, a nie zamówienie)
        if (parsed.unavailable && parsed.unavailable.length > 0 && parsed.needsClarification) {
          // Jeśli parser i tak coś znalazł (available), preferuj create_order zamiast clarify
          if ((parsed.available && parsed.available.length > 0) || (parsed.groups && parsed.groups.length > 0)) {
            updateDebugSession({
              intent: 'create_order',
              restaurant: parsed.groups?.[0]?.restaurant_name || null,
              sessionId: session?.id || null,
              confidence: 0.82
            });
            return { intent: 'create_order', parsedOrder: parsed };
          }
          const missing = parsed.unavailable.join(', ');

          // ?? PRIORITY CHECK: Before returning clarify_order, check if this is actually a "find_nearby" intent
          // (e.g. user said "pokaż restauracje w okolicy", parser thought "restauracje w okolicy" is an item)
          const strongNearbyKeywords = ['w okolicy', 'w poblizu', 'blisko', 'restauracje', 'gdzie zjem', 'szukam'];
          if (strongNearbyKeywords.some(k => lower.includes(k))) {
            console.log(`[intent-router] ?? Unavailable items detected, BUT text contains strong "find_nearby" keywords. Prioritizing find_nearby.`);
            updateDebugSession({
              intent: 'find_nearby',
              restaurant: null,
              sessionId: session?.id || null,
              confidence: 0.85
            });
            return { intent: 'find_nearby', restaurant: null };
          }

          const restaurantName = session?.lastRestaurant?.name || 'tym menu';
          console.log(`?? Unavailable items detected: ${missing} in ${restaurantName}`);

          // ?? OPTIMIZATION: Użyj cache z KROK 1 zamiast robić nowy query
          let containsRestaurantName = false;

          if (restaurantsList?.length) {
            console.log(`?? Checking if text contains restaurant name (using cached list): "${normalizedText}"`);
            const textWords = normalizedText.split(' ');

            for (const r of restaurantsList) {
              const normalizedName = normalizeTxt(r.name);
              const nameWords = normalizedName.split(' ');
              let matchedWords = 0;

              // ?? Optymalizacja: exact match najpierw
              for (const nameWord of nameWords) {
                if (textWords.includes(nameWord)) {
                  matchedWords++;
                } else {
                  // Levenshtein tylko jeśli exact match nie zadziałał
                  for (const textWord of textWords) {
                    const dist = levenshteinHelper(textWord, nameWord);
                    if (dist <= 1) {
                      matchedWords++;
                      break;
                    }
                  }
                }
              }

              const threshold = Math.ceil(nameWords.length / 2);
              if (matchedWords >= threshold) {
                containsRestaurantName = true;
                console.log(`? Text contains restaurant name: ${r.name} — skipping clarify_order`);
                break;
              }
            }
          } else {
            console.log(`?? No cached restaurants list - skipping restaurant name check`);
          }

          // Jeśli tekst NIE zawiera nazwy restauracji, to zwróć clarify_order
          if (!containsRestaurantName) {
            updateDebugSession({
              intent: 'clarify_order',
              restaurant: restaurantName,
              sessionId: session?.id || null,
              confidence: 0.9
            });
            return {
              intent: 'clarify_order',
              parsedOrder: parsed,
              reply: `Nie znalazłam aktualnie ${missing} w menu ${restaurantName}, może chciałbyś coś innego?`,
              confidence: 0.9,
              unavailable: parsed.unavailable
            };
          }
        }

        if (parsed.any) {
          const uniqueRestaurants = parsed.groups.length;
          // Check for restaurant ambiguity (multiple restaurant matches and no locked context)
          const isRestaurantAmbiguous = uniqueRestaurants > 1 && !targetRestaurant && !session?.lastRestaurant?.id;

          if (isRestaurantAmbiguous) {
            console.log(`[intent-router] ?? Ambiguous order! Found matches in ${uniqueRestaurants} restaurants.`);
            console.log(`[intent-router] ?? Returning choose_restaurant intent.`);

            const options = parsed.groups.map(g => ({
              restaurant_id: g.restaurant_id,
              restaurant_name: g.restaurant_name,
              items: g.items
            }));

            updateDebugSession({
              intent: 'choose_restaurant',
              restaurant: null,
              sessionId: session?.id || null,
              confidence: 0.95
            });

            return {
              intent: 'choose_restaurant',
              entities: { ...entities, parsedOrder: parsed, options, ambiguous: true },
              reply: `Tę pozycję serwuje kilka restauracji: ${parsed.groups.map(g => g.restaurant_name).join(', ')}. Z której mam zamówić?`,
              confidence: 0.95
            };
          }

          console.log(`??? ? EARLY DISH DETECTION SUCCESS! Dish detected: ${parsed.groups.map(g => g.items.map(i => i.name).join(', ')).join(' | ')}`);
          console.log(`??? ? Returning create_order immediately (HIGHEST PRIORITY)`);
          console.log(`??? ? parsedOrder:`, JSON.stringify(parsed, null, 2));

          updateDebugSession({
            intent: 'create_order',
            restaurant: parsed.groups[0]?.restaurant_name || null,
            sessionId: session?.id || null,
            confidence: 0.85
          });
          return {
            intent: 'create_order',
            entities: { ...entities, parsedOrder: parsed }, // Pass parsedOrder in entities
            parsedOrder: parsed,   // Keep root for backward compat if needed
            confidence: 0.85
          };
        } else {
          console.log('[intent-router] ? No dishes matched in catalog (parsed.any = false)');
          console.log('[intent-router] ? Continuing to KROK 4 (targetRestaurant check)...');
        }
      } else {
        console.log('[intent-router] Catalog is empty or order gate skipped, skipping dish detection');
      }
    } catch (e) {
      console.error('[intent-router] dish parse error:', e);
    }

    // ?? KROK 3: Przygotuj słowa kluczowe (przed sprawdzeniem targetRestaurant)
    // Bazowe słowa kluczowe (BEZ polskich znaków - znormalizowane przez normalizeTxt)
    const findNearbyKeywords = [
      'zjesc', 'restaurac', 'restauracje', 'pokaz restauracje', 'pizza', 'pizze', 'kebab', 'burger', 'zjesc cos', 'gdzie',
      'w okolicy', 'blisko', 'cos do jedzenia', 'posilek', 'obiad',
      'gdzie zjem', 'co polecasz', 'restauracje w poblizu',
      'mam ochote', 'ochote na', 'chce cos', 'chce pizze', 'chce kebab', 'chce burger',
      'szukam', 'szukam czegos', 'szukam pizzy', 'szukam kebaba',
      'cos azjatyckiego', 'cos lokalnego', 'cos szybkiego',
      'dostepne', 'co jest dostepne', 'co dostepne', 'co mam w poblizu',
      'co w okolicy', 'co jest w okolicy'
    ];

    const menuKeywords = [
      'menu', 'co moge zjesc', 'co maja', 'pokaz menu', 'pokaż menu', 'co jest w menu',
      'dania', 'potrawy', 'co serwuja', 'co podaja', 'karta dan', 'karta dań',
      'co jest dostepne', 'co dostepne', 'co maja w menu'
    ];

    const orderKeywords = [
      'zamow', 'poprosze', 'prosze', 'chce zamowic', 'zloz zamowienie', 'zamowic cos',
      'dodaj do zamowienia', 'zloz', 'wybieram', 'biore', 'wezme', 'chce', 'chcę'
    ];

    // Pobierz nauczone frazy z bazy
    const { data: learned } = await supabase
      .from('phrases')
      .select('text, intent');

    const learnedNearby = learned?.filter(p => p.intent === 'find_nearby') || [];
    const learnedMenu = learned?.filter(p => p.intent === 'menu_request') || [];
    const learnedOrder = learned?.filter(p => p.intent === 'create_order') || [];

    const dynamicNearbyKeywords = learnedNearby.map(p => normalizeTxt(p.text));
    const dynamicMenuKeywords = learnedMenu.map(p => normalizeTxt(p.text));
    const dynamicOrderKeywords = learnedOrder.map(p => normalizeTxt(p.text));

    // Deduplikacja — usuń duplikaty między bazowymi a dynamicznymi
    const allNearbyKeywords = [...new Set([...findNearbyKeywords, ...dynamicNearbyKeywords])];
    const allMenuKeywords = [...new Set([...menuKeywords, ...dynamicMenuKeywords])];
    const allOrderKeywords = [...new Set([...orderKeywords, ...dynamicOrderKeywords])];

    // ?? KROK 4: Jeśli w early dish detection znaleziono restaurację, ale nie znaleziono dań
    // to zwróć odpowiedni intent na podstawie słów kluczowych
    console.log(`[intent-router] ?? KROK 4: Checking targetRestaurant:`, targetRestaurant);
    if (targetRestaurant) {
      console.log(`[intent-router] ?? KROK 4: Restaurant found in early detection: ${targetRestaurant.name}, checking keywords...`);
      console.log(`[intent-router] ?? KROK 4: Lower text: "${lower}"`);
      console.log(`[intent-router] ?? KROK 4: Menu keywords:`, allMenuKeywords);
      console.log(`[intent-router] ?? KROK 4: Order keywords:`, allOrderKeywords);

      // Sprawdź słowa kluczowe
      if (allMenuKeywords.some(k => lower.includes(k))) {
        console.log(`[intent-router] ?? KROK 4: Menu keyword found, returning menu_request`);
        console.log(`[intent-router] ?? KROK 4: This may override create_order from KROK 2!`);
        updateDebugSession({
          intent: 'menu_request',
          restaurant: targetRestaurant.name,
          sessionId: session?.id || null,
          confidence: 0.9
        });
        return { intent: 'menu_request', restaurant: targetRestaurant };
      }

      const hasPizzaKeywordTR = /\bpizz/i.test(lower);
      if (allOrderKeywords.some(k => lower.includes(k)) || hasPizzaKeywordTR) {
        console.log(`[intent-router] ? Order keyword found, returning create_order`);
        updateDebugSession({
          intent: 'create_order',
          restaurant: targetRestaurant.name,
          sessionId: session?.id || null,
          confidence: 0.9
        });
        return { intent: 'create_order', restaurant: targetRestaurant };
      }

      // W przeciwnym razie › select_restaurant
      console.log(`[intent-router] ? No specific keywords, returning select_restaurant`);
      updateDebugSession({
        intent: 'select_restaurant',
        restaurant: targetRestaurant.name,
        sessionId: session?.id || null,
        confidence: 0.9
      });
      return { intent: 'select_restaurant', restaurant: targetRestaurant };
    } else {
      console.log(`[intent-router] ? No targetRestaurant found, continuing to keyword detection`);
    }

    // Słowa kluczowe już zdefiniowane wcześniej

    // ?? Szybka reguła: „w okolicy / w pobliżu / blisko” › preferuj find_nearby
    if (/\b(w pobliżu|w poblizu|w okolicy|blisko)\b/i.test(lower)) {
      updateDebugSession({
        intent: 'find_nearby',
        restaurant: null,
        sessionId: session?.id || null,
        confidence: 0.85
      });
      return { intent: 'find_nearby', restaurant: null };
    }

    // ?? PRIORYTET 0: Sprawdź czy w tekście jest ilość (2x, 3x, "dwa razy", etc.)
    // Jeśli tak, to najprawdopodobniej user chce zamówić, nie wybierać restauracji
    const quantityPattern = /(\d+\s*x|\d+\s+razy|dwa\s+razy|trzy\s+razy|kilka)/i;
    if (quantityPattern.test(text)) {
      console.log('?? Quantity detected › create_order');
      return { intent: 'create_order', restaurant: null };
    }

    // ?? PRIORYTET 1: Sprawdź czy w tekście jest nazwa restauracji (fuzzy matching)
    // ?? WAŻNE: Jeśli session.lastRestaurant istnieje i tekst zawiera słowa kluczowe zamówienia,
    // NIE szukaj innych restauracji - user prawdopodobnie zamawia z już wybranej restauracji
    const hasLastRestaurant = session?.lastRestaurant;
    const hasOrderKeyword = allOrderKeywords.some(k => lower.includes(k));
    const hasPizzaKeyword = /\bpizz/i.test(lower); // pizza/pizze/pizzy/pizzę etc.
    const hasDishKeyword = /(margher|margarit|capric|diavol|hawaj|hawai|funghi|prosciut|salami|pepperoni|quattro|formagg|stagioni|parma|tonno|romana|vege|wegetar|carbonar)/i.test(lower);

    if (hasLastRestaurant && (hasOrderKeyword || hasPizzaKeyword || hasDishKeyword)) {
      console.log('?? PRIORYTET 0.5: lastRestaurant exists + order keyword detected › skip restaurant search');
      console.log(`   Using session restaurant: ${session.lastRestaurant.name}`);
      // Nie szukaj innych restauracji - zwróć create_order z restauracją z sesji
      return { intent: 'create_order', restaurant: session.lastRestaurant };
    }

    // Jeśli tak, to najprawdopodobniej user chce wybrać restaurację lub zobaczyć menu
    console.log('?? PRIORYTET 1: Sprawdzam restauracje w tekście:', text);

    // ?? Użyj cache z KROK 1 jeśli dostępny, w przeciwnym razie pobierz
    if (!restaurantsList) {
      const { data } = await supabase
        .from('restaurants')
        .select('id, name')
        .eq('is_active', true);
      restaurantsList = data;
    }

    console.log('?? Znaleziono restauracji:', restaurantsList?.length || 0);

    if (restaurantsList?.length) {
      let normalizedText = normalizeTxt(text);
      try {
        const aliasMap = await getAliasMapCached();
        normalizedText = expandRestaurantAliases(normalizedText, aliasMap);
      } catch {
        normalizedText = expandRestaurantAliases(normalizedText);
      }
      console.log('?? Normalizowany tekst:', normalizedText);
      for (const r of restaurantsList) {
        const normalizedName = normalizeTxt(r.name);
        console.log('?? Sprawdzam restaurację:', r.name, '->', normalizedName);

        // Sprawdź czy nazwa restauracji jest w tekście (fuzzy match)
        // 1. Exact substring match
        if (normalizedText.includes(normalizedName)) {
          console.log('? Exact match found:', r.name);
          // Jeśli jest "menu" › menu_request
          if (allMenuKeywords.some(k => lower.includes(k))) {
            return { intent: 'menu_request', restaurant: r };
          }
          // Jeśli jest "zamów"/"wybieram" › create_order
          if (allOrderKeywords.some(k => lower.includes(k))) {
            return { intent: 'create_order', restaurant: r };
          }
          // W przeciwnym razie › select_restaurant
          return { intent: 'select_restaurant', restaurant: r };
        }

        // 2. Fuzzy match — sprawdź czy słowa z nazwy restauracji są w tekście
        const nameWords = normalizedName.split(' ');
        const textWords = normalizedText.split(' ');
        let matchedWords = 0;
        console.log('?? Fuzzy match - name words:', nameWords, 'text words:', textWords);

        for (const nameWord of nameWords) {
          // ?? Exact match first: check if word is exactly in text
          if (textWords.includes(nameWord)) {
            matchedWords++;
            console.log('? Exact word match:', nameWord);
            continue;
          }

          // ?? Fuzzy tylko dla słów >= 7 znaków (zapobiega "testy"›"tasty")
          if (nameWord.length >= 7) {
            for (const textWord of textWords) {
              if (textWord.length >= 7 && Math.abs(textWord.length - nameWord.length) <= 2) {
                const dist = levenshteinHelper(textWord, nameWord);
                console.log('?? Comparing:', textWord, 'vs', nameWord, 'distance:', dist);
                if (dist <= 1) {
                  matchedWords++;
                  console.log('? Fuzzy match!');
                  break;
                }
              }
            }
          }
        }

        // ?? Stricter threshold: require 75% of words to match (było 50%)
        const threshold = Math.ceil(nameWords.length * 0.75);
        console.log('?? Matched words:', matchedWords, 'out of', nameWords.length, 'threshold:', threshold);
        // Jeśli ?75% słów z nazwy restauracji pasuje › uznaj za match
        if (matchedWords >= threshold) {
          console.log('? Fuzzy match found:', r.name);
          // Jeśli jest "menu" › menu_request
          if (allMenuKeywords.some(k => lower.includes(k))) {
            updateDebugSession({
              intent: 'menu_request',
              restaurant: r.name,
              sessionId: session?.id || null,
              confidence: 0.9
            });
            return { intent: 'menu_request', restaurant: r };
          }
          // Jeśli jest "zamów"/"wybieram" › create_order
          if (allOrderKeywords.some(k => lower.includes(k))) {
            updateDebugSession({
              intent: 'create_order',
              restaurant: r.name,
              sessionId: session?.id || null,
              confidence: 0.9
            });
            return { intent: 'create_order', restaurant: r };
          }
          // W przeciwnym razie › select_restaurant
          updateDebugSession({
            intent: 'select_restaurant',
            restaurant: r.name,
            sessionId: session?.id || null,
            confidence: 0.9
          });
          return { intent: 'select_restaurant', restaurant: r };
        }
      }
    }

    // ?? PRIORYTET 2: Sprawdź menu keywords (bardziej specyficzne niż order)
    if (allMenuKeywords.some(k => lower.includes(k))) {
      updateDebugSession({
        intent: 'menu_request',
        restaurant: null,
        sessionId: session?.id || null,
        confidence: 0.8
      });
      return { intent: 'menu_request', restaurant: null };
    }

    // ?? PRIORYTET 3: Sprawdź order keywords
    if (allOrderKeywords.some(k => lower.includes(k))) {
      updateDebugSession({
        intent: 'create_order',
        restaurant: null,
        sessionId: session?.id || null,
        confidence: 0.8
      });
      return { intent: 'create_order', restaurant: null };
    }

    // ?? PRIORYTET 4: Sprawdź nearby keywords
    console.log('[intent-router] Checking nearby keywords...');
    console.log('[intent-router] Text:', text);
    console.log('[intent-router] Normalized:', lower);
    console.log('[intent-router] All nearby keywords:', allNearbyKeywords);

    const matchingKeywords = allNearbyKeywords.filter(k => lower.includes(k));
    console.log('[intent-router] Matching keywords:', matchingKeywords);

    if (matchingKeywords.length > 0) {
      console.log('[intent-router] ? Found nearby intent!');
      updateDebugSession({
        intent: 'find_nearby',
        restaurant: null,
        sessionId: session?.id || null,
        confidence: 0.8
      });
      return { intent: 'find_nearby', restaurant: null };
    }

    // Jeśli Amber nie zna frazy — zapisuje ją do bazy do przyszłego uczenia
    try {
      await supabase.from('phrases').insert({ text: text, intent: 'none' });
    } catch (err) {
      console.warn('?? Phrase insert skipped:', err.message);
    }

    // Bezpieczny fallback - zawsze zwróć jakiś intent (NIE 'none')
    const fallback = safeFallbackIntent(text, 'no_keywords_matched');
    updateDebugSession({
      intent: fallback.intent,
      restaurant: null,
      sessionId: session?.id || null,
      confidence: 0.0
    });
    return fallback;
  } catch (err) {
    console.error('?? detectIntent error:', err.message);
    // Bezpieczny fallback - zawsze zwróć jakiś intent (NIE throw, NIE crash)
    const fallback = safeFallbackIntent(text, `error_in_detection: ${err.message}`);
    updateDebugSession({
      intent: fallback.intent,
      restaurant: null,
      sessionId: session?.id || null,
      confidence: 0.0
    });
    return fallback;
  }
}

export async function handleIntent(intent, text, session) {
  try {
    switch (intent) {
      case "select_restaurant": {
        // Ten case jest obsługiwany w brainRouter.js
        return { reply: "Restauracja wybrana, przechodzę do brainRouter..." };
      }

      case "create_order": {
        const restaurant = session?.lastRestaurant;
        if (!restaurant) {
          return { reply: "Najpierw wybierz restaurację, zanim złożysz zamówienie." };
        }

        try {
          const order = await createOrder(restaurant.id, session?.userId || "guest");
          return {
            reply: `Zamówienie utworzone w ${restaurant.name}. Numer: ${order?.id || "brak danych"}.`,
            order,
          };
        } catch (err) {
          console.error("?? createOrder error:", err.message);
          return { reply: "Nie udało się utworzyć zamówienia. Spróbuj ponownie." };
        }
      }

      case "menu_request": {
        const restaurant = session?.lastRestaurant;
        if (!restaurant) {
          return { reply: "Najpierw wybierz restaurację, żebym mogła pobrać menu." };
        }

        try {
          const { data: menu, error } = await supabase
            .from("menu_items_v2")
            .select("name, price_pln")
            .eq("restaurant_id", restaurant.id)
            .eq("available", true)
            .limit(6);

          if (error) {
            console.error("?? Supabase error in menu_request:", error?.message || "Brak danych");
            return {
              ok: false,
              intent: "menu_request",
              restaurant,
              reply: "Nie mogę pobrać danych z bazy. Sprawdź połączenie z serwerem.",
            };
          }

          if (!menu?.length) {
            return { reply: `W bazie nie ma pozycji menu dla ${restaurant.name}.` };
          }

          return {
            reply: `W ${restaurant.name} dostępne: ${menu
              .map((m) => `${m.name} (${Number(m.price_pln).toFixed(2)} zł)`)
              .join(", ")}.`,
          };
        } catch (err) {
          console.error("?? menu_request error:", err.message);
          return { reply: "Nie mogę pobrać menu. Sprawdź połączenie z bazą." };
        }
      }

      case "find_nearby": {
        try {
          const { data, error } = await supabase
            .from("restaurants")
            .select("name, address, city")
            .limit(5);

          if (error) {
            console.error("?? Supabase error in find_nearby:", error?.message || "Brak danych");
            return {
              ok: false,
              intent: "find_nearby",
              restaurant: null,
              reply: "Nie mogę pobrać danych z bazy. Sprawdź połączenie z serwerem.",
            };
          }

          if (!data?.length) {
            return { reply: "Nie znalazłam restauracji w pobliżu." };
          }

          return {
            reply:
              "W pobliżu możesz zjeść w: " +
              data.map((r) => `${r.name} (${r.city || r.address})`).join(", "),
          };
        } catch (err) {
          console.error("?? find_nearby error:", err.message);
          return { reply: "Nie mogę pobrać listy restauracji. Sprawdź połączenie." };
        }
      }

      case "none":
        return { reply: "Nie jestem pewna, co masz na myśli — spróbuj inaczej." };

      default:
        console.warn(`?? Unknown intent: ${intent}`);
        return { reply: "Nie jestem pewna, co masz na myśli — spróbuj inaczej." };
    }
  } catch (err) {
    console.error("?? handleIntent error:", err.message);
    return { reply: "Wystąpił błąd podczas przetwarzania. Spróbuj ponownie." };
  }
}

export async function trainIntent(phrase, correctIntent) {
  try {
    const normalized = normalizeTxt(phrase);
    const { data: existing, error } = await supabase
      .from('phrases')
      .select('id, text, intent');

    if (error) {
      console.error('?? trainIntent fetch error:', error.message);
      return { ok: false, error: error.message };
    }

    const already = existing?.find(p => fuzzyMatch(normalized, p.text));
    if (already) {
      const { error: updateError } = await supabase
        .from('phrases')
        .update({ intent: correctIntent })
        .eq('id', already.id);

      if (updateError) {
        console.error('?? trainIntent update error:', updateError.message);
        return { ok: false, error: updateError.message };
      }

      console.log(`? Updated phrase "${phrase}" › ${correctIntent}`);
      return { ok: true, action: 'updated' };
    } else {
      const { error: insertError } = await supabase
        .from('phrases')
        .insert({ text: phrase, intent: correctIntent });

      if (insertError) {
        console.error('?? trainIntent insert error:', insertError.message);
        return { ok: false, error: insertError.message };
      }

      console.log(`? Inserted phrase "${phrase}" › ${correctIntent}`);
      return { ok: true, action: 'inserted' };
    }
  } catch (err) {
    console.error('?? trainIntent error:', err.message);
    return { ok: false, error: err.message };
  }
}
