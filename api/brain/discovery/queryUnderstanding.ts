/**
 * queryUnderstanding.ts
 * ─────────────────────────────────────────────────────────────
 * Skonsolidowany "mózg" taksonomii — single source of truth.
 *
 * Kontrakt: freeflow-food-taxonomy.md v2
 *
 * Zawiera:
 *   - Wszystkie typy (TopGroupID, CategoryID, CoreTag, VibeID, DietaryID, ...)
 *   - Keyword maps (L1/L2/CoreTags + Vibe + Dietary)
 *   - TAXONOMY_DISPLAY (emoji + etykiety dla frontendowych chipsów)
 *   - Fast-Parser (deterministyczny, <10ms)
 *   - Scoring + filtering + ranking
 *   - Adapter: LegacyRestaurant → TaxonomyMatch
 *   - LLM Fallback hook (szkielet, do podpięcia w FAZA 3)
 *
 * Importuj z tego pliku — nie hardcoduj keywords w handlerach.
 * ─────────────────────────────────────────────────────────────
 */

// ═══════════════════════════════════════════════════════════════
// TYPY
// ═══════════════════════════════════════════════════════════════

// ─── L1: Top Groups ──────────────────────────────────────────

export type TopGroupID =
  | 'fast_food'
  | 'pizza_italian'
  | 'asian'
  | 'polish'
  | 'grill'
  | 'desserts_cafe';

// ─── L2: Categories (dzieci L1) ──────────────────────────────

export type CategoryID =
  // fast_food
  | 'burgers' | 'kebab' | 'pizza_takeaway' | 'hot_snacks'
  // pizza_italian
  | 'pizza' | 'pasta' | 'risotto'
  // asian
  | 'sushi' | 'ramen_noodles' | 'vietnamese' | 'chinese' | 'thai'
  // polish
  | 'pierogi' | 'zupy' | 'tradycyjne'
  // grill
  | 'kebab_grill' | 'steak' | 'bbq'
  // desserts_cafe
  | 'cafe' | 'cake_bakery' | 'ice_cream';

// ─── Core Tags (cross-cutting, service-level) ────────────────

export type CoreTag = 'spicy' | 'vege' | 'quick' | 'open_now' | 'delivery';

// ─── Vibe (atmosfera / nastrój) ──────────────────────────────

export type VibeID = 'romantic' | 'cozy' | 'business' | 'loud' | 'family';

// ─── Dietary (wymagania dietetyczne) ─────────────────────────

export type DietaryID = 'vegan' | 'vegetarian' | 'gluten_free' | 'keto' | 'halal' | 'lactose_free';
export type PreferenceID = 'light' | 'high_protein' | 'low_calorie';
export type PriceBand = 'budget' | 'mid' | 'premium';
export type DiscoverySort = 'distance' | 'price' | 'rating';
export type Proximity = 'near';
export type DiscoverySource = 'text' | 'live';

export interface DiscoveryClarification {
  kind: 'preference';
  token: 'fit';
  question: string;
  choices: Array<{ id: PreferenceID; labelPl: string }>;
  blocking: true;
}

// ─── Parsed Query — output parsera ───────────────────────────

export interface ParsedQuery {
  topGroups: TopGroupID[];
  categories: CategoryID[];
  tags: CoreTag[];
  vibes: VibeID[];
  dietarys: DietaryID[];
  preferences: PreferenceID[];
  open_now: boolean;
  priceBand: PriceBand | null;
  sort: DiscoverySort | null;
  proximity: Proximity | null;
  unresolved: string[];
  clarification: DiscoveryClarification | null;
  source: DiscoverySource;
  confidence: 'deterministic' | 'partial' | 'empty';
  rawText: string;
}

// ─── Taxonomy Match — cechy restauracji ──────────────────────

export interface TaxonomyMatch {
  topGroups: TopGroupID[];
  categories: CategoryID[];
  tags: CoreTag[];
  vibes: VibeID[];
  dietarys: DietaryID[];
}

// ─── Display entry dla frontendowych chipsów ─────────────────

export interface TaxonomyDisplayEntry {
  emoji: string;
  labelPl: string;
}

// ─── Legacy Restaurant (DB row) ──────────────────────────────

export interface LegacyRestaurant {
  id: string;
  name: string;
  city?: string;
  address?: string;
  cuisine_type?: string;
  description?: string;
  menu?: unknown;
  tags?: string[];
  price_level?: number;
  rating?: number;
  distance?: number;
  lat?: number;
  lng?: number;
  supportsDelivery?: boolean;
  supports_delivery?: boolean;
  deliveryAvailable?: boolean;
  delivery_available?: boolean;
  taxonomy_groups?: TopGroupID[] | string[] | string | null;
  taxonomy_cats?: CategoryID[] | string[] | string | null;
  taxonomy_tags?: CoreTag[] | string[] | string | null;
  taxonomy_vibes?: VibeID[] | string[] | string | null;
  taxonomy_dietarys?: DietaryID[] | string[] | string | null;
  [key: string]: unknown;
}

// ─── Enriched Restaurant ─────────────────────────────────────

export interface EnrichedRestaurant extends LegacyRestaurant {
  _taxonomy: TaxonomyMatch;
  _price_level: number;
  _supports_delivery: boolean;
  _vibes: VibeID[];
  _dietarys: DietaryID[];
}

// ─── Scoring / Ranking types ─────────────────────────────────

export interface ScoredRestaurant {
  restaurant: LegacyRestaurant;
  score: number;
  scoreBreakdown: ScoreBreakdown;
}

export interface ScoreBreakdown {
  topGroupScore: number;
  categoryScore: number;
  tagScore: number;
  keywordScore: number;
  openNowBoost: number;
  vibeScore: number;
  dietaryScore: number;
  total: number;
}

export type DiscoveryFallback = 'llm' | null;

export interface DiscoveryResult {
  items: ScoredRestaurant[];
  fallback: DiscoveryFallback;
  fallbackReason?: string;
  totalBeforeFilter: number;
  totalAfterFilter: number;
}

// ─── LLM Fallback types ──────────────────────────────────────

export interface LLMFallbackRequest {
  parsedQuery: ParsedQuery;
  restaurants: LegacyRestaurant[];
}

export interface LLMFallbackResult {
  rankedRestaurantIds: string[];
  reasoning: string;
  chips: string[];
}


// ═══════════════════════════════════════════════════════════════
// KEYWORD MAPS
// ═══════════════════════════════════════════════════════════════

export const TOP_GROUP_KEYWORDS: Record<TopGroupID, string[]> = {
  fast_food: [
    'fast food', 'burger', 'burgery', 'hot dog', 'hotdog',
    'zapiekanka', 'frytki', 'nuggets', 'szybkie jedzenie', 'na szybko',
  ],
  pizza_italian: [
    'pizza', 'pizzę', 'pizzy', 'pizzeria', 'pizzerii', 'pizzerię', 'pasta', 'spaghetti',
    'carbonara', 'bolognese', 'lasagne', 'risotto', 'włoska', 'włoskie', 'włoski', 'włochy',
  ],
  asian: [
    'sushi', 'ramen', 'wok', 'maki', 'nigiri', 'pho',
    'pad thai', 'dim sum', 'azjatyckie', 'azjatycka', 'azjatycki', 'azja',
    'chińskie', 'chińska', 'chinka',
    'tajskie', 'tajska',
    'japońskie', 'japońska',
    'wietnamskie', 'wietnamska',
  ],
  polish: [
    'pierogi', 'żurek', 'barszcz', 'schabowy', 'bigos',
    'kotlet', 'rosół', 'gołąbki', 'polska', 'polski', 'polskie',
    'polska kuchnia', 'kuchnia polska', 'domowe', 'tradycyjne', 'tradycyjna',
  ],
  grill: [
    'kebab', 'döner', 'doner', 'stek', 'steki', 'wołowina',
    'żeberka', 'bbq', 'z rusztu', 'grill', 'grillowane',
  ],
  desserts_cafe: [
    'kawa', 'kawę', 'cappuccino', 'latte', 'espresso',
    'ciasto', 'tort', 'lody', 'naleśniki', 'waffle', 'gofry',
    'deser', 'desery', 'kawiarnia', 'cukiernia',
  ],
};

export const CATEGORY_KEYWORDS: Record<CategoryID, string[]> = {
  // fast_food
  burgers:       ['burger', 'burgery', 'hamburger', 'cheeseburger', 'smash burger'],
  kebab:         ['kebab', 'döner', 'doner', 'shawarma', 'falafel', 'gyros'],
  pizza_takeaway:['pizza na wynos', 'pizza z dostawą'],
  hot_snacks:    ['frytki', 'nuggets', 'hot dog', 'hotdog', 'zapiekanka', 'tortilla'],

  // pizza_italian
  pizza:         ['pizza', 'pizzę', 'pizzy', 'pizzeria', 'pizzerii', 'pizzerię', 'neapolitańska', 'margarita'],
  pasta:         ['pasta', 'spaghetti', 'carbonara', 'bolognese', 'lasagne', 'tagliatelle'],
  risotto:       ['risotto', 'bruschetta', 'tiramisu'],

  // asian
  sushi:         ['sushi', 'maki', 'nigiri', 'temaki', 'sashimi', 'uramaki', 'japońskie', 'japońska'],
  ramen_noodles: ['ramen', 'udon', 'soba', 'pad thai', 'lo mein', 'makaron azjatycki'],
  vietnamese:    ['pho', 'bun bo', 'banh mi', 'wietnamskie', 'wietnamska', 'wietnam'],
  chinese:       ['chińskie', 'chińska', 'wok', 'dim sum', 'chow mein', 'chinka'],
  thai:          ['tajskie', 'tajska', 'pad thai', 'green curry', 'tom yum'],

  // polish
  pierogi:       ['pierogi', 'kopytka', 'uszka'],
  zupy:          ['żurek', 'barszcz', 'rosół', 'zupa', 'flaki', 'grochówka', 'zupy'],
  tradycyjne:    ['schabowy', 'bigos', 'kotlet', 'gołąbki', 'zrazy', 'tradycyjne', 'tradycyjna', 'tradycyjny'],

  // grill
  kebab_grill:   ['kebab z grilla', 'kebab sit-down'],
  steak:         ['stek', 'steki', 'wołowina', 't-bone', 'ribeye', 'antrykot'],
  bbq:           ['bbq', 'żeberka', 'pulled pork', 'smoker', 'wędzony'],

  // desserts_cafe
  cafe:          ['kawa', 'kawę', 'espresso', 'cappuccino', 'latte', 'americano', 'kawiarnia'],
  cake_bakery:   ['ciasto', 'tort', 'croissant', 'muffin', 'chleb', 'piekarnia', 'cukiernia'],
  ice_cream:     ['lody', 'gelato', 'naleśniki', 'waffle', 'gofry'],
};

export const CORE_TAG_KEYWORDS: Record<CoreTag, string[]> = {
  spicy:    ['ostre', 'ostro', 'ostry', 'ostra', 'pikantne', 'pikantny', 'pikantna', 'chilli', 'sriracha', 'piekące'],
  vege:     ['wege', 'wegetariańskie', 'wegetariański', 'bez mięsa', 'wegańskie', 'vegan', 'roślinne'],
  quick:    ['szybko', 'szybkie', 'szybki', 'na szybko', 'express', 'fast'],
  open_now: ['teraz', 'otwarte', 'otwarta', 'czynne', 'czynna', 'otwarta teraz', 'czy otwarte'],
  delivery: ['dostawa', 'dowóz', 'przynieś', 'wolt', 'uber eats', 'glovo', 'z dostawą', 'na wynos z dostawą'],
};

export const PRICE_BAND_KEYWORDS: Record<PriceBand, string[]> = {
  budget: ['tanie', 'tanio', 'niedrogie', 'budżetowe', 'budzetowe', 'budżet', 'budzet', 'cheap'],
  mid: ['średnia półka', 'srednia polka', 'średniej półce', 'sredniej polce', 'średni budżet', 'sredni budzet', 'średnia cena', 'srednia cena', 'umiarkowane ceny', 'mid range'],
  premium: ['premium', 'fine dining', 'ekskluzywne', 'droższe', 'drozsze', 'wysoka półka', 'wysoka polka'],
};

export const SORT_KEYWORDS: Record<DiscoverySort, string[]> = {
  distance: ['najbliżej', 'najblizej', 'blisko', 'w pobliżu', 'w poblizu', 'nearby', 'closest'],
  price: ['najtaniej', 'najtańsze', 'najtansze', 'po cenie', 'sortuj po cenie'],
  rating: ['najlepiej oceniane', 'najwyżej oceniane', 'najwyzej oceniane', 'top rated', 'najlepsze oceny'],
};

export const PROXIMITY_KEYWORDS: Record<Proximity, string[]> = {
  near: ['blisko', 'w pobliżu', 'w poblizu', 'w okolicy', 'obok', 'nearby', 'closest'],
};

export const VIBE_KEYWORDS: Record<VibeID, string[]> = {
  romantic: [
    'romantyczna', 'romantyczne', 'romantyczny', 'na randkę', 'na randke',
    'kolacja przy świecach', 'przytulnie', 'z widokiem', 'elegancko',
    'kolacja we dwoje', 'walentynki', 'nastrojowa', 'kameralna kolacja',
  ],
  cozy: [
    'przytulna', 'przytulne', 'kameralna', 'kameralne',
    'domowa atmosfera', 'ciepła atmosfera', 'mila atmosfera', 'miła atmosfera',
    'spokojnie', 'spokojna', 'kameralny', 'klimatyczna', 'klimatyczne',
  ],
  business: [
    'biznesowa', 'biznesowe', 'na spotkanie', 'biznesowy lunch',
    'biznesowa kolacja', 'konferencyjna', 'dla firm', 'lunch biznesowy',
    'formalna', 'elegancka', 'reprezentacyjna',
  ],
  loud: [
    'głośna', 'głośno', 'imprezowa', 'na imprezę', 'z muzyką',
    'muzyka na żywo', 'pub', 'bar', 'klubowa', 'energetyczna',
    'koncert', 'dj', 'potanczyc', 'potańczyć',
  ],
  family: [
    'rodzinna', 'rodzinne', 'dla dzieci', 'dla rodziny', 'z dziećmi',
    'plac zabaw', 'kącik dla dzieci', 'przyjazna dzieciom', 'familijna',
    'na rodzinny obiad', 'dla całej rodziny',
  ],
};

export const DIETARY_KEYWORDS: Record<DietaryID, string[]> = {
  vegan: [
    'vegańskie', 'wegańska', 'vegańska', 'vegański', 'wegański', 'vegan',
    'bez produktów odzwierzęcych', '100% roślinne', 'w pełni roślinne',
  ],
  vegetarian: [
    'wege', 'wegetariańskie', 'wegetariański', 'wegetariańska',
    'bez mięsa', 'vegetarian', 'dania bezmięsne', 'bezmięsne',
  ],
  gluten_free: [
    'bezglutenowe', 'bez glutenu', 'gluten free', 'bezglutenowa', 'bezglutenowy',
    'bezglutenowego', 'bezglutenowej', 'bezglutenowych',
    'dieta bezglutenowa', 'dla celiaków', 'celiakia',
  ],
  keto: [
    'keto', 'ketogeniczna', 'ketogeniczne', 'niskowęglowodanowa',
    'low carb', 'dieta keto', 'keto friendly',
  ],
  halal: [
    'halal', 'halalne', 'mięso halal', 'dania halal',
    'certyfikat halal', 'halal friendly',
  ],
  lactose_free: [
    'bez laktozy', 'bezlaktozowe', 'lactose free', 'bezlaktozowa', 'bezlaktozowy',
    'dla alergików', 'bez nabiału', 'bez mleka',
  ],
};

export const PREFERENCE_KEYWORDS: Record<PreferenceID, string[]> = {
  light: [
    'lekkie', 'lekki', 'lekka', 'lekko', 'lekkiego', 'lekką', 'lekkim',
    'lżejsze', 'lzejsze',
    'lekki posiłek', 'lekki posilek', 'lekka kolacja', 'lekki obiad',
  ],
  high_protein: [
    'wysokobiałkowe', 'wysokobialkowe', 'wysokobiałkowy', 'wysokobialkowy',
    'wysokobiałkowa', 'wysokobialkowa', 'dużo białka', 'duzo bialka', 'high protein',
  ],
  low_calorie: [
    'niskokaloryczne', 'niskokaloryczny', 'niskokaloryczna',
    'mało kalorii', 'malo kalorii', 'low calorie',
  ],
};


// ═══════════════════════════════════════════════════════════════
// TAXONOMY DISPLAY — emoji + etykiety dla frontendowych chipsów
// ═══════════════════════════════════════════════════════════════

export const TAXONOMY_DISPLAY: Record<string, TaxonomyDisplayEntry> = {
  // Top Groups (L1)
  fast_food:       { emoji: '🍔', labelPl: 'Fast Food' },
  pizza_italian:   { emoji: '🍕', labelPl: 'Włoska' },
  asian:           { emoji: '🍜', labelPl: 'Azjatycka' },
  polish:          { emoji: '🥟', labelPl: 'Polska' },
  grill:           { emoji: '🥩', labelPl: 'Grill' },
  desserts_cafe:   { emoji: '🍰', labelPl: 'Desery/Kawa' },

  // Categories (L2)
  burgers:         { emoji: '🍔', labelPl: 'Burgery' },
  kebab:           { emoji: '🥙', labelPl: 'Kebab' },
  pizza_takeaway:  { emoji: '🍕', labelPl: 'Pizza na wynos' },
  hot_snacks:      { emoji: '🌭', labelPl: 'Przekąski' },
  pizza:           { emoji: '🍕', labelPl: 'Pizza' },
  pasta:           { emoji: '🍝', labelPl: 'Pasta' },
  risotto:         { emoji: '🍚', labelPl: 'Risotto' },
  sushi:           { emoji: '🍣', labelPl: 'Sushi' },
  ramen_noodles:   { emoji: '🍜', labelPl: 'Ramen' },
  vietnamese:      { emoji: '🍲', labelPl: 'Wietnamska' },
  chinese:         { emoji: '🥡', labelPl: 'Chińska' },
  thai:            { emoji: '🍛', labelPl: 'Tajska' },
  pierogi:         { emoji: '🥟', labelPl: 'Pierogi' },
  zupy:            { emoji: '🍲', labelPl: 'Zupy' },
  tradycyjne:      { emoji: '🍖', labelPl: 'Tradycyjne' },
  kebab_grill:     { emoji: '🥩', labelPl: 'Kebab z grilla' },
  steak:           { emoji: '🥩', labelPl: 'Steki' },
  bbq:             { emoji: '🔥', labelPl: 'BBQ' },
  cafe:            { emoji: '☕', labelPl: 'Kawa' },
  cake_bakery:     { emoji: '🧁', labelPl: 'Piekarnia' },
  ice_cream:       { emoji: '🍦', labelPl: 'Lody' },

  // Core Tags
  spicy:           { emoji: '🌶️', labelPl: 'Ostre' },
  vege:            { emoji: '🥬', labelPl: 'Wege' },
  quick:           { emoji: '⚡', labelPl: 'Szybkie' },
  open_now:        { emoji: '🟢', labelPl: 'Otwarte' },
  delivery:        { emoji: '🛵', labelPl: 'Dostawa' },

  // Vibe
  romantic:        { emoji: '🕯️', labelPl: 'Romantyczna' },
  cozy:            { emoji: '🛋️', labelPl: 'Przytulna' },
  business:        { emoji: '💼', labelPl: 'Biznesowa' },
  loud:            { emoji: '🎸', labelPl: 'Imprezowa' },
  family:          { emoji: '👨‍👩‍👧‍👦', labelPl: 'Rodzinna' },

  // Dietary
  vegan:           { emoji: '🌱', labelPl: 'Vegańskie' },
  vegetarian:      { emoji: '🥬', labelPl: 'Wegetariańskie' },
  gluten_free:     { emoji: '🌾', labelPl: 'Bez glutenu' },
  keto:            { emoji: '🥑', labelPl: 'Keto' },
  halal:           { emoji: '🕌', labelPl: 'Halal' },
  lactose_free:    { emoji: '🥛', labelPl: 'Bez laktozy' },
  light:           { emoji: '🪶', labelPl: 'Lekkie' },
  high_protein:    { emoji: '💪', labelPl: 'Wysokobiałkowe' },
  low_calorie:     { emoji: '◌', labelPl: 'Niskokaloryczne' },
};

// ─── Chip (do renderowania w UI) ─────────────────────────────

export interface TaxonomyChip {
  id: string;
  emoji: string;
  labelPl: string;
  dimension: 'topGroup' | 'category' | 'tag' | 'vibe' | 'dietary' | 'preference' | 'priceBand' | 'proximity' | 'sort';
}

export function buildChips(parsed: ParsedQuery): TaxonomyChip[] {
  const chips: TaxonomyChip[] = [];

  for (const id of parsed.topGroups) {
    const entry = TAXONOMY_DISPLAY[id];
    if (entry) chips.push({ id, emoji: entry.emoji, labelPl: entry.labelPl, dimension: 'topGroup' });
  }
  for (const id of parsed.categories) {
    const entry = TAXONOMY_DISPLAY[id];
    if (entry) chips.push({ id, emoji: entry.emoji, labelPl: entry.labelPl, dimension: 'category' });
  }
  for (const id of parsed.tags) {
    if (id === 'open_now') continue; // open_now to nie chip
    const entry = TAXONOMY_DISPLAY[id];
    if (entry) chips.push({ id, emoji: entry.emoji, labelPl: entry.labelPl, dimension: 'tag' });
  }
  for (const id of parsed.vibes) {
    const entry = TAXONOMY_DISPLAY[id];
    if (entry) chips.push({ id, emoji: entry.emoji, labelPl: entry.labelPl, dimension: 'vibe' });
  }
  for (const id of parsed.dietarys) {
    const entry = TAXONOMY_DISPLAY[id];
    if (entry) chips.push({ id, emoji: entry.emoji, labelPl: entry.labelPl, dimension: 'dietary' });
  }
  for (const id of parsed.preferences) {
    const entry = TAXONOMY_DISPLAY[id];
    if (entry) chips.push({ id, emoji: entry.emoji, labelPl: entry.labelPl, dimension: 'preference' });
  }
  if (parsed.priceBand) {
    const display = {
      budget: { emoji: '💰', labelPl: 'Budżetowo' },
      mid: { emoji: '◐', labelPl: 'Średnia półka' },
      premium: { emoji: '✦', labelPl: 'Premium' },
    }[parsed.priceBand];
    chips.push({ id: parsed.priceBand, ...display, dimension: 'priceBand' });
  }
  if (parsed.proximity === 'near') {
    chips.push({ id: 'near', emoji: '⌖', labelPl: 'Blisko', dimension: 'proximity' });
  }
  if (parsed.sort) {
    const display = {
      distance: { emoji: '↗', labelPl: 'Najbliżej' },
      price: { emoji: '↧', labelPl: 'Najtaniej' },
      rating: { emoji: '★', labelPl: 'Najlepiej oceniane' },
    }[parsed.sort];
    chips.push({ id: `sort_${parsed.sort}`, ...display, dimension: 'sort' });
  }

  return chips;
}


// ═══════════════════════════════════════════════════════════════
// HELPERS — adapter
// ═══════════════════════════════════════════════════════════════

const TOP_GROUP_IDS = new Set<TopGroupID>(Object.keys(TOP_GROUP_KEYWORDS) as TopGroupID[]);
const CATEGORY_IDS = new Set<CategoryID>(Object.keys(CATEGORY_KEYWORDS) as CategoryID[]);
const CORE_TAG_IDS = new Set<CoreTag>(Object.keys(CORE_TAG_KEYWORDS) as CoreTag[]);
const VIBE_IDS = new Set<VibeID>(Object.keys(VIBE_KEYWORDS) as VibeID[]);
const DIETARY_IDS = new Set<DietaryID>(Object.keys(DIETARY_KEYWORDS) as DietaryID[]);

function toStringArray(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean);
  }

  if (typeof input !== 'string') return [];
  const trimmed = input.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .filter(Boolean);
      }
    } catch {
      // fall through to delimiter split
    }
  }

  if (/[,;|]/.test(trimmed)) {
    return trimmed
      .split(/[,;|]/)
      .map((value) => value.trim())
      .filter(Boolean);
  }

  return [trimmed];
}

function coerceEnumArray<T extends string>(input: unknown, allowed: Set<T>): T[] {
  const out: T[] = [];
  for (const raw of toStringArray(input)) {
    const normalized = raw.toLowerCase().trim() as T;
    if (allowed.has(normalized) && !out.includes(normalized)) {
      out.push(normalized);
    }
  }
  return out;
}

function resolveDescription(r: LegacyRestaurant): string {
  const description = r?.description;
  if (typeof description === 'string' && description.trim()) {
    return description;
  }
  return '';
}

function buildSearchCorpus(r: LegacyRestaurant): string {
  const parts: string[] = [];

  if (r?.name) parts.push(r.name);
  if (r?.cuisine_type) parts.push(r.cuisine_type);

  const description = resolveDescription(r);
  if (description) parts.push(description);

  if (Array.isArray(r?.tags)) {
    parts.push(...r.tags);
  }

  if (r?.menu) {
    try {
      const menuText = typeof r.menu === 'string' ? r.menu : JSON.stringify(r.menu);
      parts.push(menuText);
    } catch {
      // ignore non-serializable menu payloads
    }
  }

  return parts.join(' ').toLowerCase();
}

function corpusHasKeyword(corpus: string, keyword: string): boolean {
  return corpus.includes(keyword);
}


// ═══════════════════════════════════════════════════════════════
// HELPERS — query matching
// ═══════════════════════════════════════════════════════════════

const STOPWORDS = new Set([
  'jest', 'mam', 'mają', 'coś', 'proszę', 'poproszę',
  'chcę', 'chciałbym', 'chciałabym', 'dajcie', 'podaj',
  'teraz', 'dzisiaj', 'jutro', 'gdzie', 'jakie', 'czy',
  'macie', 'możecie', 'może', 'proszę', 'bardzo', 'dobrze',
  'dziś', 'trochę', 'jakieś', 'jakiś', 'będzie',
]);

function tokenizeQuery(rawText: string): string[] {
  return rawText
    .toLowerCase()
    .replace(/[.,?!;:()\[\]"']/g, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 4 && !STOPWORDS.has(token));
}

function buildRestaurantCorpus(r: LegacyRestaurant): string {
  const parts: string[] = [];
  if (r.name)         parts.push(r.name);
  if (r.cuisine_type) parts.push(r.cuisine_type);
  if (r.description)  parts.push(r.description);
  if (Array.isArray(r.tags)) parts.push(...r.tags);
  if (r.menu) {
    try {
      parts.push(typeof r.menu === 'string' ? r.menu : JSON.stringify(r.menu));
    } catch { /* ignore */ }
  }
  return parts.join(' ').toLowerCase();
}


// ═══════════════════════════════════════════════════════════════
// SCORING CONSTANTS
// ═══════════════════════════════════════════════════════════════

const SCORE = {
  TOP_GROUP:   3,
  CATEGORY:    2,
  TAG:         1,
  KEYWORD:     2,
  OPEN_NOW:    3,
  VIBE:        2,
  DIETARY:     2,
} as const;

const ALWAYS_STRICT_TAGS: CoreTag[] = ['vege', 'delivery'];


// ═══════════════════════════════════════════════════════════════
// ADAPTER: LegacyRestaurant → TaxonomyMatch
// ═══════════════════════════════════════════════════════════════

function inferVibesFromCorpus(corpus: string): VibeID[] {
  const vibes: VibeID[] = [];
  for (const [vibe, keywords] of Object.entries(VIBE_KEYWORDS) as [VibeID, string[]][]) {
    if (keywords.some(kw => corpus.includes(kw))) vibes.push(vibe);
  }
  return vibes;
}

function inferDietarysFromCorpus(corpus: string): DietaryID[] {
  const dietarys: DietaryID[] = [];
  for (const [diet, keywords] of Object.entries(DIETARY_KEYWORDS) as [DietaryID, string[]][]) {
    if (keywords.some(kw => corpus.includes(kw))) dietarys.push(diet);
  }
  return dietarys;
}

function inferTaxonomyFromCorpus(corpus: string): TaxonomyMatch {
  const inferredTopGroups = new Set<TopGroupID>();
  const inferredCategories = new Set<CategoryID>();
  const inferredTags = new Set<CoreTag>();
  const inferredVibes = new Set<VibeID>();
  const inferredDietarys = new Set<DietaryID>();

  for (const [group, keywords] of Object.entries(TOP_GROUP_KEYWORDS) as [TopGroupID, string[]][]) {
    if (keywords.some(kw => corpusHasKeyword(corpus, kw))) {
      inferredTopGroups.add(group);
    }
  }

  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS) as [CategoryID, string[]][]) {
    if (keywords.some(kw => corpusHasKeyword(corpus, kw))) {
      inferredCategories.add(cat);
    }
  }

  for (const [tag, keywords] of Object.entries(CORE_TAG_KEYWORDS) as [CoreTag, string[]][]) {
    if (keywords.some(kw => corpusHasKeyword(corpus, kw))) {
      inferredTags.add(tag);
    }
  }

  for (const [vibe, keywords] of Object.entries(VIBE_KEYWORDS) as [VibeID, string[]][]) {
    if (keywords.some(kw => corpusHasKeyword(corpus, kw))) {
      inferredVibes.add(vibe);
    }
  }

  for (const [diet, keywords] of Object.entries(DIETARY_KEYWORDS) as [DietaryID, string[]][]) {
    if (keywords.some(kw => corpusHasKeyword(corpus, kw))) {
      inferredDietarys.add(diet);
    }
  }

  return {
    topGroups: Array.from(inferredTopGroups),
    categories: Array.from(inferredCategories),
    tags: Array.from(inferredTags),
    vibes: Array.from(inferredVibes),
    dietarys: Array.from(inferredDietarys),
  };
}

export function resolvePriceLevel(r: LegacyRestaurant): number {
  if (typeof r?.price_level === 'number' && r.price_level >= 1 && r.price_level <= 4) {
    return r.price_level;
  }

  const corpus = buildSearchCorpus(r);
  if (corpus.includes('fine dining') || corpus.includes('wykwintne')) return 4;
  if (corpus.includes('premium') || corpus.includes('eleganckie')) return 3;
  if (corpus.includes('tanie') || corpus.includes('budzet') || corpus.includes('budżet') || corpus.includes('najtaniej')) return 1;
  return 2;
}

export function resolveSupportsDelivery(r: LegacyRestaurant): boolean {
  if (typeof r?.supports_delivery === 'boolean') return r.supports_delivery;
  if (typeof r?.supportsDelivery === 'boolean') return r.supportsDelivery;
  if (typeof r?.delivery_available === 'boolean') return r.delivery_available;
  if (typeof r?.deliveryAvailable === 'boolean') return r.deliveryAvailable;

  const corpus = buildSearchCorpus(r);
  return corpus.includes('dostawa') || corpus.includes('dowoz') || corpus.includes('dowóz') || corpus.includes('wolt') || corpus.includes('glovo');
}

export function mapRestaurantToFeatures(r: LegacyRestaurant): TaxonomyMatch {
  const dbTopGroups = coerceEnumArray<TopGroupID>(r?.taxonomy_groups, TOP_GROUP_IDS);
  const dbCategories = coerceEnumArray<CategoryID>(r?.taxonomy_cats, CATEGORY_IDS);
  const dbTags = coerceEnumArray<CoreTag>(r?.taxonomy_tags, CORE_TAG_IDS);
  const dbVibes = coerceEnumArray<VibeID>(r?.taxonomy_vibes, VIBE_IDS);
  const dbDietarys = coerceEnumArray<DietaryID>(r?.taxonomy_dietarys, DIETARY_IDS);

  // DB short-circuit: if taxonomy_groups is populated, trust DB metadata.
  if (dbTopGroups.length > 0) {
    const topGroups = new Set<TopGroupID>(dbTopGroups);
    const categories = new Set<CategoryID>(dbCategories);
    const tags = new Set<CoreTag>(dbTags);
    const vibes = new Set<VibeID>(dbVibes);
    const dietarys = new Set<DietaryID>(dbDietarys);

    if (topGroups.has('fast_food')) {
      tags.add('quick');
    }

    if (resolveSupportsDelivery(r)) {
      tags.add('delivery');
    }

    return {
      topGroups: Array.from(topGroups),
      categories: Array.from(categories),
      tags: Array.from(tags),
      vibes: Array.from(vibes),
      dietarys: Array.from(dietarys),
    };
  }

  const corpus = buildSearchCorpus(r);
  const inferred = inferTaxonomyFromCorpus(corpus);
  const topGroups = new Set<TopGroupID>(inferred.topGroups);
  const categories = new Set<CategoryID>(inferred.categories);
  const tags = new Set<CoreTag>(inferred.tags);
  const vibes = new Set<VibeID>(inferred.vibes);
  const dietarys = new Set<DietaryID>(inferred.dietarys);

  if (topGroups.has('fast_food')) {
    tags.add('quick');
  }

  if (resolveSupportsDelivery(r)) {
    tags.add('delivery');
  }

  return {
    topGroups: Array.from(topGroups),
    categories: Array.from(categories),
    tags: Array.from(tags),
    vibes: Array.from(vibes),
    dietarys: Array.from(dietarys),
  };
}

export function enrichRestaurant(r: LegacyRestaurant): EnrichedRestaurant {
  const features = mapRestaurantToFeatures(r);
  return {
    ...r,
    _taxonomy: features,
    _price_level: resolvePriceLevel(r),
    _supports_delivery: resolveSupportsDelivery(r),
    _vibes: features.vibes,
    _dietarys: features.dietarys,
  };
}


// ═══════════════════════════════════════════════════════════════
// FAST-PARSER: Query → ParsedQuery
// ═══════════════════════════════════════════════════════════════

function normalizeDiscoveryText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesDiscoveryKeyword(text: string, keyword: string): boolean {
  const normalizedText = normalizeDiscoveryText(text);
  const normalizedKeyword = normalizeDiscoveryText(keyword);
  if (!normalizedKeyword) return false;
  return ` ${normalizedText} `.includes(` ${normalizedKeyword} `);
}

function matchingKeys<T extends string>(text: string, map: Record<T, string[]>): T[] {
  return (Object.entries(map) as [T, string[]][])
    .filter(([, keywords]) => keywords.some(keyword => includesDiscoveryKeyword(text, keyword)))
    .map(([id]) => id);
}

export function matchQueryToTaxonomy(
  queryText: string,
  source: DiscoverySource = 'text',
): ParsedQuery {
  const text = normalizeDiscoveryText(queryText);

  const topGroups: TopGroupID[] = [];
  const categories: CategoryID[] = [];
  const tags: CoreTag[] = [];
  const vibes: VibeID[] = [];
  const dietarys: DietaryID[] = [];
  const preferences: PreferenceID[] = [];

  for (const [group, keywords] of Object.entries(TOP_GROUP_KEYWORDS) as [TopGroupID, string[]][]) {
    if (keywords.some(kw => includesDiscoveryKeyword(text, kw))) {
      topGroups.push(group);
    }
  }

  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS) as [CategoryID, string[]][]) {
    if (keywords.some(kw => includesDiscoveryKeyword(text, kw))) {
      categories.push(cat);
    }
  }

  for (const [tag, keywords] of Object.entries(CORE_TAG_KEYWORDS) as [CoreTag, string[]][]) {
    if (keywords.some(kw => includesDiscoveryKeyword(text, kw))) {
      tags.push(tag);
    }
  }

  for (const [vibe, keywords] of Object.entries(VIBE_KEYWORDS) as [VibeID, string[]][]) {
    if (keywords.some(kw => includesDiscoveryKeyword(text, kw))) {
      vibes.push(vibe);
    }
  }

  for (const [diet, keywords] of Object.entries(DIETARY_KEYWORDS) as [DietaryID, string[]][]) {
    if (keywords.some(kw => includesDiscoveryKeyword(text, kw))) {
      dietarys.push(diet);
    }
  }

  for (const [preference, keywords] of Object.entries(PREFERENCE_KEYWORDS) as [PreferenceID, string[]][]) {
    if (keywords.some(kw => includesDiscoveryKeyword(text, kw))) {
      preferences.push(preference);
    }
  }

  const open_now = CORE_TAG_KEYWORDS.open_now.some(kw => includesDiscoveryKeyword(text, kw));
  const matchedPriceBands = matchingKeys(text, PRICE_BAND_KEYWORDS);
  const matchedSorts = matchingKeys(text, SORT_KEYWORDS);
  const matchedProximities = matchingKeys(text, PROXIMITY_KEYWORDS);
  const unresolved: string[] = [];
  const hasFitToken = includesDiscoveryKeyword(text, 'fit');
  const clarification: DiscoveryClarification | null = hasFitToken && preferences.length === 0
    ? {
        kind: 'preference',
        token: 'fit',
        question: 'Masz na myśli lekkie, wysokobiałkowe czy niskokaloryczne?',
        choices: [
          { id: 'light', labelPl: 'Lekkie' },
          { id: 'high_protein', labelPl: 'Wysokobiałkowe' },
          { id: 'low_calorie', labelPl: 'Niskokaloryczne' },
        ],
        blocking: true,
      }
    : null;

  if (matchedPriceBands.length > 1) unresolved.push('priceBand');
  if (matchedSorts.length > 1) unresolved.push('sort');
  if (clarification) unresolved.push('preference:fit');
  for (const token of ['mid', 'med', 'medium', 'max', 'maks']) {
    if (new RegExp(`(?:^|\\s)${token}(?:\\s|$|[.,?!])`, 'i').test(text)) {
      unresolved.push(`variant:${token}`);
    }
  }

  const priceBand = matchedPriceBands.length === 1 ? matchedPriceBands[0] : null;
  const sort = matchedSorts.length === 1 ? matchedSorts[0] : null;
  const proximity = matchedProximities.length > 0 ? matchedProximities[0] : null;

  const signalCount =
    topGroups.length
    + categories.length
    + tags.length
    + vibes.length
    + dietarys.length
    + preferences.length
    + (priceBand ? 1 : 0)
    + (sort ? 1 : 0)
    + (proximity ? 1 : 0);
  const confidence: ParsedQuery['confidence'] =
    signalCount === 0 ? 'empty'  :
    signalCount >= 2  ? 'deterministic' :
                        'partial';

  return {
    topGroups,
    categories,
    tags,
    vibes,
    dietarys,
    preferences,
    open_now,
    priceBand,
    sort,
    proximity,
    unresolved,
    clarification,
    source,
    confidence,
    rawText: queryText,
  };
}


// ═══════════════════════════════════════════════════════════════
// SCORING
// ═══════════════════════════════════════════════════════════════

export function scoreRestaurant(
  parsedQuery: ParsedQuery,
  r: LegacyRestaurant,
): ScoreBreakdown {
  const features = mapRestaurantToFeatures(r);
  const corpus = buildRestaurantCorpus(r);

  // topGroup matches
  const matchedGroups = parsedQuery.topGroups.filter(g => features.topGroups.includes(g));
  const topGroupScore = matchedGroups.length * SCORE.TOP_GROUP;

  // category matches
  const matchedCategories = parsedQuery.categories.filter(c => features.categories.includes(c));
  const categoryScore = matchedCategories.length * SCORE.CATEGORY;

  // tag matches (bez open_now — jest osobno)
  const queryTagsWithoutOpenNow = parsedQuery.tags.filter(t => t !== 'open_now');
  const matchedTags = queryTagsWithoutOpenNow.filter(t => features.tags.includes(t));
  const tagScore = matchedTags.length * SCORE.TAG;

  // exact keyword match — tokeny z rawText które trafiają w corpus restauracji
  const queryTokens = tokenizeQuery(parsedQuery.rawText);
  const uniqueMatchedTokens = new Set(queryTokens.filter(token => corpus.includes(token)));
  const keywordScore = Math.min(uniqueMatchedTokens.size, 3) * SCORE.KEYWORD;

  // open_now boost — SOFT: nie eliminuje, tylko boost gdy restaurant open
  let openNowBoost = 0;
  if (parsedQuery.open_now) {
    if (features.tags.includes('open_now')) {
      openNowBoost = SCORE.OPEN_NOW;
    }
  }

  // vibe matches (soft boost, never filters)
  const matchedVibes = parsedQuery.vibes.filter(v => features.vibes.includes(v));
  const vibeScore = matchedVibes.length * SCORE.VIBE;

  // dietary matches
  const matchedDietarys = parsedQuery.dietarys.filter(d => features.dietarys.includes(d));
  const dietaryScore = matchedDietarys.length * SCORE.DIETARY;

  const total = topGroupScore + categoryScore + tagScore + keywordScore + openNowBoost + vibeScore + dietaryScore;

  return {
    topGroupScore,
    categoryScore,
    tagScore,
    keywordScore,
    openNowBoost,
    vibeScore,
    dietaryScore,
    total,
  };
}


// ═══════════════════════════════════════════════════════════════
// FILTERING
// ═══════════════════════════════════════════════════════════════

function shouldIncludeRestaurant(
  parsedQuery: ParsedQuery,
  r: LegacyRestaurant,
): boolean {
  const features = mapRestaurantToFeatures(r);

  const hasStructure = parsedQuery.topGroups.length > 0 || parsedQuery.categories.length > 0;
  const hasStrictTags = parsedQuery.tags.some(t => ALWAYS_STRICT_TAGS.includes(t));
  const enforceAllTags =
    parsedQuery.confidence === 'deterministic' && hasStructure && hasStrictTags;

  // 1. topGroups — OR: przynajmniej jedna
  if (parsedQuery.topGroups.length > 0) {
    if (!parsedQuery.topGroups.some(g => features.topGroups.includes(g))) return false;
  }

  // 2. categories — OR: przynajmniej jedna
  if (parsedQuery.categories.length > 0) {
    if (!parsedQuery.categories.some(c => features.categories.includes(c))) return false;
  }

  // 3. Tags enforcement
  const tagsToEnforce = enforceAllTags
    ? parsedQuery.tags
    : ALWAYS_STRICT_TAGS.filter(t => parsedQuery.tags.includes(t));

  for (const tag of tagsToEnforce) {
    if (tag === 'open_now') continue;
    if (!features.tags.includes(tag)) return false;
  }

  // 4. Dietary — ALWAYS strict AND (wymagania zdrowotne/religijne)
  for (const diet of parsedQuery.dietarys) {
    if (!features.dietarys.includes(diet)) return false;
  }

  // Vibe NIGDY nie filtruje — jest boost-only

  return true;
}

export function filterRestaurantsByDiscovery(
  parsedQuery: ParsedQuery,
  restaurants: LegacyRestaurant[],
): LegacyRestaurant[] {
  if (parsedQuery.confidence === 'empty') {
    return restaurants;
  }

  const filtered = restaurants.filter(r => shouldIncludeRestaurant(parsedQuery, r));

  filtered.sort((a, b) => {
    const scoreA = scoreRestaurant(parsedQuery, a).total;
    const scoreB = scoreRestaurant(parsedQuery, b).total;
    return scoreB - scoreA;
  });

  return filtered;
}


// ═══════════════════════════════════════════════════════════════
// RANKING
// ═══════════════════════════════════════════════════════════════

export function rankRestaurantsByDiscovery(
  parsedQuery: ParsedQuery,
  restaurants: LegacyRestaurant[],
): ScoredRestaurant[] {
  if (parsedQuery.confidence === 'empty') {
    return restaurants.map(r => ({
      restaurant: r,
      score: 0,
      scoreBreakdown: {
        topGroupScore: 0, categoryScore: 0, tagScore: 0,
        keywordScore: 0, openNowBoost: 0, vibeScore: 0, dietaryScore: 0, total: 0,
      },
    }));
  }

  const results: ScoredRestaurant[] = [];

  for (const r of restaurants) {
    if (!shouldIncludeRestaurant(parsedQuery, r)) continue;
    const breakdown = scoreRestaurant(parsedQuery, r);
    results.push({ restaurant: r, score: breakdown.total, scoreBreakdown: breakdown });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}


// ═══════════════════════════════════════════════════════════════
// MAIN ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════

export function runDiscovery(
  parsedQuery: ParsedQuery,
  restaurants: LegacyRestaurant[],
): DiscoveryResult {

  if (parsedQuery.clarification?.blocking) {
    return {
      items: [],
      fallback: null,
      fallbackReason: parsedQuery.clarification.question,
      totalBeforeFilter: restaurants.length,
      totalAfterFilter: 0,
    };
  }

  // LLM Fallback Signal — jeśli parser nic nie znalazł
  if (parsedQuery.confidence === 'empty') {
    return {
      items: [],
      fallback: 'llm',
      fallbackReason: `Parser nie znalazł żadnych sygnałów taksonomicznych w: "${parsedQuery.rawText}". Przekaż do LLM refiner.`,
      totalBeforeFilter: restaurants.length,
      totalAfterFilter: 0,
    };
  }

  const ranked = rankRestaurantsByDiscovery(parsedQuery, restaurants);

  return {
    items: ranked,
    fallback: null,
    totalBeforeFilter: restaurants.length,
    totalAfterFilter: ranked.length,
  };
}


// ═══════════════════════════════════════════════════════════════
// DEBUG HELPER
// ═══════════════════════════════════════════════════════════════

export function explainFilter(
  parsedQuery: ParsedQuery,
  r: LegacyRestaurant,
): { passed: boolean; score: number; reasons: string[] } {
  const features = mapRestaurantToFeatures(r);
  const breakdown = scoreRestaurant(parsedQuery, r);
  const reasons: string[] = [];
  const passed = shouldIncludeRestaurant(parsedQuery, r);

  const hasStructure = parsedQuery.topGroups.length > 0 || parsedQuery.categories.length > 0;
  const hasStrictTags = parsedQuery.tags.some(t => ALWAYS_STRICT_TAGS.includes(t));
  const enforceAllTags = parsedQuery.confidence === 'deterministic' && hasStructure && hasStrictTags;

  reasons.push(`Features: topGroups=[${features.topGroups}] categories=[${features.categories}] tags=[${features.tags}] vibes=[${features.vibes}] dietarys=[${features.dietarys}]`);
  reasons.push(`Score: ${breakdown.total} (group:${breakdown.topGroupScore} cat:${breakdown.categoryScore} tag:${breakdown.tagScore} kw:${breakdown.keywordScore} open:${breakdown.openNowBoost} vibe:${breakdown.vibeScore} dietary:${breakdown.dietaryScore})`);
  reasons.push(`AND mode: ${enforceAllTags ? 'ALL tags enforced (deterministic)' : 'only strict tags (vege/delivery)'}`);

  if (parsedQuery.topGroups.length > 0) {
    const match = parsedQuery.topGroups.some(g => features.topGroups.includes(g));
    reasons.push(`topGroups [${parsedQuery.topGroups}]: ${match ? '✓' : '✗'}`);
  }

  if (parsedQuery.categories.length > 0) {
    const match = parsedQuery.categories.some(c => features.categories.includes(c));
    reasons.push(`categories [${parsedQuery.categories}]: ${match ? '✓' : '✗'}`);
  }

  const relevantTags = enforceAllTags
    ? parsedQuery.tags
    : ALWAYS_STRICT_TAGS.filter(t => parsedQuery.tags.includes(t));

  for (const tag of relevantTags) {
    if (tag === 'open_now') continue;
    const match = features.tags.includes(tag);
    reasons.push(`tag [${tag}] (${enforceAllTags ? 'AND-enforced' : 'strict'}): ${match ? '✓' : '✗'}`);
  }

  if (parsedQuery.vibes.length > 0) {
    const match = parsedQuery.vibes.some(v => features.vibes.includes(v));
    reasons.push(`vibes [${parsedQuery.vibes}]: ${match ? '✓ boost' : '✗ (brak boost)'}`);
  }

  if (parsedQuery.dietarys.length > 0) {
    for (const diet of parsedQuery.dietarys) {
      const match = features.dietarys.includes(diet);
      reasons.push(`dietary [${diet}] (strict AND): ${match ? '✓' : '✗ ELIMINUJE'}`);
    }
  }

  return { passed, score: breakdown.total, reasons };
}


// ═══════════════════════════════════════════════════════════════
// LLM FALLBACK HOOK (szkielet — FAZA 3)
// ═══════════════════════════════════════════════════════════════

/**
 * triggerLLMFallback
 *
 * Placeholder for FAZA 3 LLM refiner.
 * Gdy parser confidence jest 'empty', wysyła zapytanie do LLM
 * z listą restauracji jako kontekstem.
 *
 * Obecnie: no-op, loguje request.
 */
export async function triggerLLMFallback(
  request: LLMFallbackRequest,
): Promise<DiscoveryResult> {
  const { parsedQuery, restaurants } = request;
  console.log('[LLMFallback] FAZA 3 — not yet implemented. Request:', {
    query: parsedQuery.rawText,
    restaurantCount: restaurants.length,
    vibes: parsedQuery.vibes,
    dietarys: parsedQuery.dietarys,
  });
  return {
    items: [],
    fallback: 'llm',
    fallbackReason: `LLM fallback not yet implemented (FAZA 3): "${parsedQuery.rawText}"`,
    totalBeforeFilter: restaurants.length,
    totalAfterFilter: 0,
  };
}
