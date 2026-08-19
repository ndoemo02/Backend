/**
 * api/owner/_helpers.js
 * ===========================================================================
 * Wspolne helpery dla endpointow wlasciciela (D3, docs/HANDOFF_EXEC_SONNET5_2026-08-08.md
 * sekcja D3 + docs/B5_OWNER_PANEL_WRITE_INVENTORY.md sekcja 5).
 *
 * PRZEPIECIE NA MODEL NOWEJ BAZY (2026-08-19)
 * ---------------------------------------------------------------------------
 * Stara baza: `restaurants.owner_id -> auth.users.id`. Wlasnosc byla cecha OSOBY.
 * Nowa baza:  `restaurants.business_account_id -> business_accounts.id`,
 *             a osoba jest zwiazana z firma przez `business_members`
 *             (user_id, business_account_id, role_key). Kolumny `owner_id` NIE MA.
 *
 * Rola jest cecha CZLONKOSTWA, nie osoby, a zdolnosci sa DANYMI w
 * `business_roles.capabilities` - dolozenie roli to INSERT, nie migracja.
 * Dlatego helpery ponizej pytaja o ZDOLNOSC (np. 'venue.manage'), nigdy
 * o nazwe roli. Nigdzie w tym pliku nie pada `role_key = 'owner'`.
 *
 * DLACZEGO TO MUSI ZYC W KODZIE, A NIE W RLS
 * ---------------------------------------------------------------------------
 * Polityki nowej bazy stoja na `private.has_capability()`, ktora czyta
 * `auth.uid()` - tozsamosc roli pytajacej. Backend laczy sie kluczem
 * service_role (api/_supabase.js), ktory RLS OMIJA i nie ma `auth.uid()`.
 * Polityki NIE CHRONIA endpointow wlascicielskich ani troche. `requireOwner`
 * (../_auth.js) weryfikuje JWT i daje `auth.userId` - to jedyne zrodlo
 * tozsamosci i jedyny punkt zaczepienia filtra.
 *
 * `getCapableAccountIds` - zamienia tozsamosc osoby na ZBIOR firm, w ktorych
 * ta osoba ma zadana zdolnosc. Zbior, nie skalar: jedna osoba moze nalezec do
 * wielu firm (i miec w kazdej inna role).
 *
 * `getScopedRestaurant` - bramka przechodnia dla operacji na tabelach BEZ
 * wlasnej kolumny wlasnosci (`menu_items_v2`). Tam przynaleznosc pozycji menu
 * jest zawsze tranzytywna przez `restaurant_id`, wiec zasieg musi byc osobnym
 * krokiem PRZED dotknieciem tabeli docelowej. `restaurants.js` go nie uzywa -
 * laczy zasieg i operacje w jednym query.
 *
 * `buildAllowlistedPatch` - generyczny sanitizer: iteruje po SCHEMACIE
 * (allowliscie), nie po kluczach `body`. To eliminuje mozliwosc wstrzykniecia
 * dowolnego pola (business_account_id, id, created_at, cokolwiek) z definicji -
 * klucze spoza schematu nigdy nie sa nawet sprawdzane, bo petla nigdy po nich
 * nie idzie.
 * ===========================================================================
 */

/**
 * Zdolnosc zarzadzania lokalem. Lustro polityk `restaurants_business_read`
 * i `restaurants_business_update` (20260818000400_newbase_rls.sql:165-172).
 *
 * Odczyt i edycja lokalu dziela dzis te sama zdolnosc, bo `business_roles` nie
 * zna zdolnosci "tylko odczyt lokalu". Rozdzial wymagalby nowego wiersza
 * w `business_roles.capabilities` i przegladu obu polityk - swiadomie odlozony.
 */
export const CAPABILITY_VENUE_MANAGE = 'venue.manage';

/**
 * Zdolnosc zarzadzania karta. Lustro polityki `menu_business_read`
 * (20260818000400_newbase_rls.sql:181-184). CELOWO inna niz powyzsza: rola moze
 * miec prawo do menu bez prawa do edycji samego lokalu.
 */
export const CAPABILITY_MENU_MANAGE = 'menu.manage';

/** Jedyny status konta biznesowego dajacy dostep - lustro `b.status = 'active'`. */
const ACTIVE_ACCOUNT_STATUS = 'active';

/**
 * PostgREST zwraca osadzona relacje raz jako obiekt, raz jako jednoelementowa
 * tablice, zaleznie od tego, jak rozpozna kardynalnosc. Normalizacja jest tu
 * po to, zeby ta roznica nie decydowala o dostepie.
 */
function embedded(value) {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Zamienia tozsamosc osoby na zbior firm, w ktorych ma ona zadana zdolnosc.
 *
 * Filtrowanie zdolnosci i statusu firmy idzie po stronie JS, a nie w zapytaniu.
 * Powod: warunek `capabilities=cs.{venue.manage}` wymaga cytowania kropki
 * wewnatrz literalu tablicy PostgREST. Cichy blad skladni w tym miejscu
 * oznaczalby otwarty endpoint, wiec warunek zyje tam, gdzie widac go wprost.
 * `business_members` jest indeksowana po `user_id`, a liczba czlonkostw
 * jednej osoby jest z natury mala.
 *
 * @param {object} supabase - klient service_role (api/_supabase.js)
 * @param {string} userId - auth.userId z requireOwner, jedyne zrodlo tozsamosci
 * @param {string} capability - np. CAPABILITY_VENUE_MANAGE
 * @returns {Promise<string[]>} id firm; pusta tablica gdy brak czlonkostwa lub zdolnosci
 */
export async function getCapableAccountIds(supabase, userId, capability) {
  const { data, error } = await supabase
    .from('business_members')
    .select('business_account_id,business_roles!inner(capabilities),business_accounts!inner(status)')
    .eq('user_id', userId);
  if (error) throw error;
  if (!Array.isArray(data)) return [];

  const accountIds = [];
  for (const row of data) {
    // Zawieszona firma traci dostep natychmiast, bez odbierania czlonkostw -
    // lustro warunku `b.status = 'active'` z private.has_capability
    // (20260818000400_newbase_rls.sql:66). Bez tego zawieszenie dzialaloby
    // przez RLS, ale nie przez backend.
    if (embedded(row?.business_accounts)?.status !== ACTIVE_ACCOUNT_STATUS) continue;

    const capabilities = embedded(row?.business_roles)?.capabilities;
    if (!Array.isArray(capabilities) || !capabilities.includes(capability)) continue;

    const accountId = row?.business_account_id;
    if (typeof accountId === 'string' && accountId && !accountIds.includes(accountId)) {
      accountIds.push(accountId);
    }
  }
  return accountIds;
}

/**
 * Potwierdza, ze lokal lezy w zasiegu wywolujacego dla zadanej zdolnosci.
 *
 * Zwraca `null` zarowno gdy lokal nie istnieje, jak i gdy nalezy do cudzej
 * firmy - wywolujacy nie ma jak odroznic tych przypadkow. Przy pustym zasiegu
 * tabela `restaurants` nie jest w ogole pytana: nie ma czego pytac, a brak
 * zapytania jest latwiejszy do udowodnienia niz poprawnosc pustego filtra.
 *
 * @param {object} supabase - klient service_role (api/_supabase.js)
 * @param {string} userId - auth.userId z requireOwner
 * @param {string} restaurantId
 * @param {string} capability - zdolnosc wymagana przez wolajacy endpoint
 * @param {string} [fields='id'] - kolumny do zwrocenia (minimalne domyslnie - to tylko bramka)
 * @returns {Promise<object|null>}
 */
export async function getScopedRestaurant(supabase, userId, restaurantId, capability, fields = 'id') {
  const accountIds = await getCapableAccountIds(supabase, userId, capability);
  if (accountIds.length === 0) return null;

  const { data, error } = await supabase
    .from('restaurants')
    .select(fields)
    .eq('id', restaurantId)
    .in('business_account_id', accountIds)
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
