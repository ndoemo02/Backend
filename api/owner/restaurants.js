/**
 * api/owner/restaurants.js
 * ===========================================================================
 * B1 owner-read (2026-08-10) + D3 owner-write (2026-08-10,
 * docs/HANDOFF_EXEC_SONNET5_2026-08-08.md sekcja D3, kontrakt C5 zatwierdzony).
 *
 * GET   /api/owner/restaurants      -> restauracje nalezace do zalogowanego usera
 * GET   /api/owner/restaurants/:id  -> jedna restauracja, tylko jesli jej wlasna
 * PATCH /api/owner/restaurants/:id  -> edycja jawnie dozwolonych pol wlasnej restauracji
 *
 * Auth: Authorization: Bearer <Supabase JWT>, weryfikowany przez
 * `authenticateOwner`/`requireOwner` (../_auth.js) -> `supabase.auth.getUser(token)`.
 * `user.id` zwrocony stamtad jest JEDYNYM zrodlem tozsamosci - endpoint nie
 * przyjmuje zadnego identyfikatora wlasciciela z query/body/params jako dowodu.
 *
 * MODEL WLASNOSCI (przepiete 2026-08-19)
 * ---------------------------------------------------------------------------
 * Lokal nalezy do FIRMY (`restaurants.business_account_id`), nie do osoby.
 * Osoba jest zwiazana z firma przez `business_members`, a jej rola niesie
 * ZDOLNOSCI (`business_roles.capabilities`). Ten endpoint wymaga
 * `venue.manage` - lustro polityk `restaurants_business_read`
 * i `restaurants_business_update` (20260818000400_newbase_rls.sql:165-172).
 * Role `staff` i `reception` tej zdolnosci nie maja i panelu lokalu nie widza.
 *
 * Zasieg jest ZBIOREM firm, nie pojedyncza firma: jedna osoba moze nalezec do
 * wielu kont biznesowych.
 *
 * Query wykonywane na service_role (`privateServerClient`), ktory RLS OMIJA.
 * Polityki nowej bazy czytaja `auth.uid()`, ktorego pod service_role nie ma -
 * NIE CHRONIA tego pliku. Filtr `.in('business_account_id', …)` ponizej jest
 * jedynym mechanizmem ochrony. To jest tez powod, dla ktorego ten endpoint
 * istnieje zamiast bezposredniego zapytania z przegladarki: kolumna
 * `business_account_id` nie jest w grancie anon/authenticated
 * (20260818000400_newbase_rls.sql:115-120).
 *
 * Detail (:id) i PATCH (:id) LACZA `id` i zasieg firmowy w JEDNYM query (nie
 * dwoma osobnymi krokami "pobierz/zmien po id" + "sprawdz zasieg w JS")
 * i zwracaja 404 zarowno dla nieistniejacego id, jak i dla cudzego lokalu -
 * rozne statusy ujawnialyby przez efekt uboczny, ze cudze id w ogole istnieje
 * w bazie. Dla PATCH: 0 zaktualizowanych wierszy (bo brak id LUB lokal poza
 * zasiegiem) jest nieodrozniane od "nie istnieje" - identycznie jak w GET.
 *
 * Pusty zasieg (brak czlonkostwa albo rola bez `venue.manage`) konczy obsluge
 * ZANIM powstanie jakikolwiek filtr - tabela `restaurants` nie jest pytana.
 *
 * WRITE menu_items_v2 - patrz api/owner/restaurantMenu.js. RestaurantManager.jsx
 * (D3) jest przepiety z bezposrednich zapisow Supabase na oba te pliki.
 * ===========================================================================
 */
import { requireOwner } from '../_auth.js';
import { supabase } from '../_supabase.js';
import {
  buildAllowlistedPatch,
  getCapableAccountIds,
  getScopedRestaurant,
  CAPABILITY_VENUE_MANAGE,
} from './_helpers.js';

const LIST_FIELDS = 'id,name,city';

/** Pola potrzebne RestaurantManager.jsx (DetailsTab, linie 293-298 + 330-334). */
const DETAIL_FIELDS =
  'id,name,city,address,phone,website,is_active,delivery_available,cuisine_type,maps_rating,image_url,photo_gallery';

/**
 * Allowlist D3 = dokladnie pola budowane w RestaurantManager.jsx DetailsTab.save()
 * (linie 356-369), nic ponad to ("nie dodawaj pol na przyszlosc" - B5 zasada).
 * description/min_order_pln/is_open sa w kodzie frontu warunkowe (kolumny
 * wymagaja migracji, patrz komentarz w RestaurantManager.jsx:294-297) - sa tu
 * mimo to, bo D3 ma odzwierciedlac to, co frontend FAKTYCZNIE potrafi wyslac;
 * jesli kolumny nie istnieja na live, update z tymi kluczami zawiedzie
 * identycznie jak dzisiejszy bezposredni zapis z przegladarki - brak regresji.
 */
const RESTAURANT_PATCH_SCHEMA = {
  name: { type: 'string', minLength: 1 },
  city: { type: 'string', nullable: true },
  address: { type: 'string', nullable: true },
  phone: { type: 'string', nullable: true },
  website: { type: 'string', nullable: true },
  is_active: { type: 'boolean' },
  delivery_available: { type: 'boolean' },
  image_url: { type: 'string', nullable: true },
  description: { type: 'string', nullable: true },
  min_order_pln: { type: 'number', min: 0, nullable: true },
  is_open: { type: 'boolean' },
};

function sanitizeRestaurantPatch(body) {
  return buildAllowlistedPatch(body, RESTAURANT_PATCH_SCHEMA);
}

function extractRestaurantId(req) {
  const fromParams = req?.params?.id;
  if (typeof fromParams === 'string' && fromParams.trim()) return fromParams.trim();

  const rawUrl = typeof req?.url === 'string' ? req.url : '';
  const path = rawUrl.split('?')[0].replace(/\/+$/, '');
  const last = path.split('/').pop() || '';
  if (!last || last === 'restaurants') return null;
  return last;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'PATCH') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const auth = await requireOwner(req, res);
  if (!auth) return; // requireOwner juz wyslal 401

  const restaurantId = extractRestaurantId(req);

  try {
    if (req.method === 'PATCH') {
      if (!restaurantId) {
        return res.status(400).json({ ok: false, error: 'missing_id' });
      }
      // Ksztalt patcha sprawdzany PRZED dotknieciem bazy - zle sformowany
      // request nie generuje ruchu ani nie ujawnia niczego o zasiegu.
      const patch = sanitizeRestaurantPatch(req.body);
      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ ok: false, error: 'empty_patch' });
      }

      const accountIds = await getCapableAccountIds(supabase, auth.userId, CAPABILITY_VENUE_MANAGE);
      if (accountIds.length === 0) {
        return res.status(404).json({ ok: false, error: 'not_found' });
      }

      const { data, error } = await supabase
        .from('restaurants')
        .update(patch)
        .eq('id', restaurantId)
        .in('business_account_id', accountIds)
        .select(DETAIL_FIELDS)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        return res.status(404).json({ ok: false, error: 'not_found' });
      }
      return res.status(200).json({ ok: true, data });
    }

    if (!restaurantId) {
      const accountIds = await getCapableAccountIds(supabase, auth.userId, CAPABILITY_VENUE_MANAGE);
      // Brak zasiegu to pusta lista, nie blad: uzytkownik bez czlonkostwa
      // biznesowego jest zwyklym klientem, a nie kims, kto zrobil cos zlego.
      if (accountIds.length === 0) {
        return res.status(200).json({ ok: true, data: [] });
      }

      const { data, error } = await supabase
        .from('restaurants')
        .select(LIST_FIELDS)
        .in('business_account_id', accountIds)
        .order('name');
      if (error) throw error;
      return res.status(200).json({ ok: true, data: data || [] });
    }

    const data = await getScopedRestaurant(
      supabase,
      auth.userId,
      restaurantId,
      CAPABILITY_VENUE_MANAGE,
      DETAIL_FIELDS
    );
    if (!data) {
      return res.status(404).json({ ok: false, error: 'not_found' });
    }
    return res.status(200).json({ ok: true, data });
  } catch (err) {
    console.error('[OWNER_RESTAURANTS] error:', err?.message);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
}
