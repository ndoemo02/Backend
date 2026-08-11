/**
 * api/owner/_helpers.js
 * ===========================================================================
 * Wspolne helpery dla endpointow wlasciciela (D3, docs/HANDOFF_EXEC_SONNET5_2026-08-08.md
 * sekcja D3 + docs/B5_OWNER_PANEL_WRITE_INVENTORY.md sekcja 5).
 *
 * `getOwnedRestaurant` - jedyny sposob potwierdzenia, ze restauracja nalezy do
 * wywolujacego. Uzywany zarowno bezposrednio (nie jest tu potrzebny dla samego
 * restaurants.js, ktore laczy ownership+operacje w jednym query), jak i przez
 * `restaurantMenu.js`, gdzie operacja docelowa dotyczy INNEJ tabeli
 * (menu_items_v2, bez wlasnej kolumny owner_id) - tam ownership restauracji
 * musi byc osobnym krokiem PRZED dotknieciem menu_items_v2.
 *
 * `buildAllowlistedPatch` - generyczny sanitizer: iteruje po SCHEMACIE
 * (allowliscie), nie po kluczach `body`. To eliminuje mozliwosc wstrzykniecia
 * dowolnego pola (owner_id, id, created_at, cokolwiek) z definicji - klucze
 * spoza schematu nigdy nie sa nawet sprawdzane, bo petla nigdy po nich nie idzie.
 * ===========================================================================
 */

/**
 * @param {object} supabase - klient service_role (api/_supabase.js)
 * @param {string} userId - auth.userId z requireOwner, jedyne zrodlo tozsamosci
 * @param {string} restaurantId
 * @param {string} [fields='id'] - kolumny do zwrocenia (minimalne domyslnie - to tylko ownership-check)
 * @returns {Promise<object|null>} rekord restauracji gdy nalezy do userId, inaczej null
 */
export async function getOwnedRestaurant(supabase, userId, restaurantId, fields = 'id') {
  const { data, error } = await supabase
    .from('restaurants')
    .select(fields)
    .eq('id', restaurantId)
    .eq('owner_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Buduje obiekt patch/insert WYLACZNIE z pol obecnych w `body` I obecnych w
 * `schema`. Kazde pole schematu ma ksztalt:
 *   { type: 'string' | 'boolean' | 'number', nullable?: boolean, minLength?: number, min?: number, trim?: boolean }
 *
 * Kontrakt (zgodny z D3 "PATCH semantics"):
 *   - klucz nieobecny w body -> nieobecny w wyniku (nie dotykaj pola)
 *   - klucz obecny, wartosc null, pole nullable -> null w wyniku (jawne wyczyszczenie)
 *   - klucz obecny, wartosc null, pole NIE nullable -> pomijany (traktowany jak nieobecny;
 *     UI nigdy tak nie wysyla, wiec to tylko obrona przed zle sformowanym requestem)
 *   - klucz obecny, zly typ / nie przechodzi walidacji -> pomijany (jak wyzej)
 *   - klucz obecny, poprawny typ -> wartosc (po trim dla stringow gdy trim!==false) w wyniku
 *
 * Nigdy nie rzuca na nieprawidlowe dane - "niepoprawne" jest traktowane identycznie
 * jak "nieobecne" (bezpieczny default: nic sie nie zmienia, zero polprawdziwego zapisu).
 *
 * @param {Record<string, unknown>} body
 * @param {Record<string, {type: string, nullable?: boolean, minLength?: number, min?: number, trim?: boolean}>} schema
 * @returns {Record<string, unknown>}
 */
export function buildAllowlistedPatch(body, schema) {
  const patch = {};
  if (!body || typeof body !== 'object') return patch;

  for (const [key, rule] of Object.entries(schema)) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const raw = body[key];

    if (raw === null) {
      if (rule.nullable) patch[key] = null;
      continue;
    }

    if (rule.type === 'string') {
      if (typeof raw !== 'string') continue;
      const value = rule.trim === false ? raw : raw.trim();
      if (typeof rule.minLength === 'number' && value.length < rule.minLength) continue;
      patch[key] = value;
      continue;
    }

    if (rule.type === 'boolean') {
      if (typeof raw !== 'boolean') continue;
      patch[key] = raw;
      continue;
    }

    if (rule.type === 'number') {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
      if (typeof rule.min === 'number' && raw < rule.min) continue;
      patch[key] = raw;
      continue;
    }
  }

  return patch;
}
