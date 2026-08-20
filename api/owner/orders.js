/**
 * api/owner/orders.js
 * ===========================================================================
 * Zasieg firmowy dla zamowien — zaplecze KDS (widok kuchni).
 *
 * GET   /api/owner/orders?restaurant_id=…&limit=…  -> zamowienia jednego lokalu
 * PATCH /api/owner/orders/:id                      -> zmiana statusu zamowienia
 *
 * DLACZEGO POWSTAL: `BusinessPanelNew.tsx` -> `useKDSPolling.ts` ->
 * `lib/kdsApi.ts` wola te adresy od dawna, ale backend nigdy nie dostal
 * odpowiednika — produkcja nie ma nawet katalogu `api/owner/`. KDS odpowiadal
 * `404` i nie widzial zamowien. Ustalone w sesji 14, patrz CLAUDE.md §10.
 *
 * Auth: `Authorization: Bearer <Supabase JWT>` -> `requireOwner` (../_auth.js).
 * `auth.userId` jest JEDYNYM zrodlem tozsamosci — endpoint nie przyjmuje
 * zadnego identyfikatora firmy, lokalu ani wlasciciela z query/body jako dowodu.
 *
 * ZDOLNOSCI — celowo inne niz w `restaurants.js`
 * ---------------------------------------------------------------------------
 *   GET   -> `orders.read`
 *   PATCH -> `orders.update_status`
 * `staff` i `reception` NIE MAJA `venue.manage`, wiec panelu lokalu nie widza,
 * ale obie te zdolnosci maja — kuchnia musi dzialac (CLAUDE.md §8). Pytamy
 * o ZDOLNOSC, nigdy o nazwe roli: nowa rola to INSERT do `business_roles`.
 *
 * ZASIEG JEST PRZECHODNI
 * ---------------------------------------------------------------------------
 * `orders` nie ma kolumny `business_account_id` — ma tylko `restaurant_id`.
 * Przynaleznosc zamowienia do firmy biegnie przez `restaurants`, wiec zasieg
 * musi byc osobnym krokiem PRZED dotknieciem `orders`. To ten sam uklad, co
 * `menu_items_v2` w `restaurantMenu.js`.
 *
 * DLACZEGO FILTR ZYJE W KODZIE, A NIE W RLS
 * ---------------------------------------------------------------------------
 * Polityki nowej bazy stoja na `private.has_capability()`, ktora czyta
 * `auth.uid()`. Backend laczy sie kluczem service_role — RLS OMIJA,
 * `auth.uid()` jest NULL. Polityki NIE CHRONIA tego pliku ani troche.
 * Filtry ponizej sa jedynym mechanizmem. Nie „upraszczac" tego z powrotem
 * do polegania na RLS.
 * ===========================================================================
 */
import { requireOwner } from '../_auth.js';
import { supabase } from '../_supabase.js';
import { getCapableAccountIds, getScopedRestaurant } from './_helpers.js';

/** Lustro `business_roles.capabilities` (20260818000200_newbase_business.sql). */
const CAPABILITY_ORDERS_READ = 'orders.read';
const CAPABILITY_ORDERS_UPDATE_STATUS = 'orders.update_status';

/**
 * Statusy, ktore wolno ustawic KUCHNI. Podzbior CHECK-a `orders_status_check`
 * z nowej bazy (pending, confirmed, accepted, preparing, completed, delivered,
 * cancelled).
 *
 * `pending` i `confirmed` sa CELOWO poza lista — to statusy systemowe:
 * `pending` nadaje utworzenie zamowienia, `confirmed` nadaje `finalizeOrder.js`
 * po potwierdzeniu platnosci. Gdyby kuchnia mogla cofnac zamowienie do
 * `confirmed`, zamazalaby slad platnosci, ktory jest jedynym jej wyrazem po
 * usunieciu markera `[stripe_test_paid:…]` w P4 (CLAUDE.md §10).
 *
 * `ready` NIE ISTNIEJE w bazie — KDS renderuje `completed` jako „GOTOWE"
 * (kdsApi.ts:257). Lista jest lustrem CHECK-a, nie nazw z UI.
 */
const ALLOWED_STATUSES = Object.freeze([
  'accepted', 'preparing', 'completed', 'delivered', 'cancelled',
]);

/** Kolumny oddawane kuchni. PII kontaktowe sa tu potrzebne do realizacji. */
const ORDER_FIELDS = [
  'id', 'restaurant_id', 'status', 'items', 'total_price',
  'customer_name', 'customer_phone', 'delivery_address', 'notes',
  'created_at', 'confirmed_at', 'updated_at',
].join(',');

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

function extractOrderId(req) {
  const fromParams = req?.params?.id;
  if (typeof fromParams === 'string' && fromParams.trim()) return fromParams.trim();

  const rawUrl = typeof req?.url === 'string' ? req.url : '';
  const path = rawUrl.split('?')[0].replace(/\/+$/, '');
  const last = path.split('/').pop() || '';
  if (!last || last === 'orders') return null;
  return last;
}

function parseLimit(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'PATCH') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const auth = await requireOwner(req, res);
  if (!auth) return; // requireOwner juz wyslal 401

  try {
    if (req.method === 'PATCH') {
      const orderId = extractOrderId(req);
      if (!orderId) {
        return res.status(400).json({ ok: false, error: 'missing_id' });
      }

      // Ksztalt zadania sprawdzany PRZED dotknieciem bazy — zle sformowany
      // request nie generuje ruchu ani nie ujawnia niczego o zasiegu.
      const status = req?.body?.status;
      if (typeof status !== 'string' || !ALLOWED_STATUSES.includes(status)) {
        return res.status(400).json({ ok: false, error: 'invalid_status' });
      }

      const accountIds = await getCapableAccountIds(
        supabase, auth.userId, CAPABILITY_ORDERS_UPDATE_STATUS,
      );
      if (accountIds.length === 0) {
        return res.status(404).json({ ok: false, error: 'not_found' });
      }

      // Zasieg wyprowadzany z CZLONKOSTWA, nigdy z `body.restaurant_id`.
      // Klient podaje ten klucz (kdsApi.ts:313), ale nie jest on dowodem —
      // przyjecie go pozwoliloby wskazac cudzy lokal i zmienic cudze zamowienie.
      const { data: scoped, error: scopeError } = await supabase
        .from('restaurants')
        .select('id')
        .in('business_account_id', accountIds);
      if (scopeError) throw scopeError;

      const restaurantIds = (scoped || []).map((r) => r.id).filter(Boolean);
      if (restaurantIds.length === 0) {
        return res.status(404).json({ ok: false, error: 'not_found' });
      }

      // Id i zasieg w JEDNYM query. Zero zaktualizowanych wierszy znaczy
      // „nie ma takiego zamowienia ALBO nie jest twoje" — wywolujacy nie ma
      // jak odroznic tych przypadkow, bo rozne statusy ujawnialyby istnienie
      // cudzych rekordow.
      const { data, error } = await supabase
        .from('orders')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', orderId)
        .in('restaurant_id', restaurantIds)
        .select(ORDER_FIELDS)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        return res.status(404).json({ ok: false, error: 'not_found' });
      }
      return res.status(200).json({ ok: true, data });
    }

    // ── GET ──
    // Zakres jest OBOWIAZKOWY. Bez niego endpoint zwracalby zamowienia
    // wszystkich lokali firmy naraz, czego KDS nie potrzebuje (kdsApi.ts:236
    // sam rzuca bez `restaurantId`), a co poszerzaloby powierzchnie wycieku PII.
    const restaurantId = req?.query?.restaurant_id;
    if (typeof restaurantId !== 'string' || !restaurantId.trim()) {
      return res.status(400).json({
        ok: false,
        error: 'scope_required',
        detail: 'Podaj restaurant_id.',
      });
    }

    const scopedRestaurant = await getScopedRestaurant(
      supabase, auth.userId, restaurantId.trim(), CAPABILITY_ORDERS_READ,
    );
    if (!scopedRestaurant) {
      return res.status(404).json({ ok: false, error: 'not_found' });
    }

    const { data, error } = await supabase
      .from('orders')
      .select(ORDER_FIELDS)
      .eq('restaurant_id', restaurantId.trim())
      .order('created_at', { ascending: false })
      .limit(parseLimit(req?.query?.limit));
    if (error) throw error;
    return res.status(200).json({ ok: true, data: data || [] });
  } catch (err) {
    console.error('[OWNER_ORDERS] error:', err?.message);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
}
