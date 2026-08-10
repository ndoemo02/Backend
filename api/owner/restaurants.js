/**
 * api/owner/restaurants.js
 * ===========================================================================
 * B1 owner-read (verify-first follow-up, 2026-08-10).
 *
 * GET /api/owner/restaurants      -> restauracje nalezace do zalogowanego usera
 * GET /api/owner/restaurants/:id  -> jedna restauracja, tylko jesli jej wlasna
 *
 * Auth: Authorization: Bearer <Supabase JWT>, weryfikowany przez
 * `authenticateOwner`/`requireOwner` (../_auth.js) -> `supabase.auth.getUser(token)`.
 * `user.id` zwrocony stamtad jest JEDYNYM zrodlem ownership - endpoint nie
 * przyjmuje `owner_id` z query/body.
 *
 * Query wykonywane na service_role (`privateServerClient`), bo po Stage10
 * kolumna `owner_id` nie jest w grancie anon/authenticated
 * (supabase/migrations/20260808000400_stage10_public_catalog_rls.sql) - to
 * jest wlasnie powod, dla ktorego ten endpoint istnieje zamiast bezposredniego
 * zapytania z przegladarki.
 *
 * Detail (:id) laczy `id` i `owner_id` w JEDNYM query (nie dwoma osobnymi
 * krokami "pobierz po id" + "sprawdz ownership w JS") i zwraca 404 zarowno
 * dla nieistniejacego id, jak i dla cudzej restauracji - rozne statusy
 * ujawnialyby przez efekt uboczny, ze cudze id w ogole istnieje w bazie.
 *
 * WRITE (update restauracji, menu_items_v2) swiadomie POZA zakresem - patrz
 * B5/D3 (docs/HANDOFF_EXEC_SONNET5_2026-08-08.md). RestaurantManager.jsx
 * nadal pisze bezposrednio do Supabase; ten plik obsluguje wylacznie READ.
 * ===========================================================================
 */
import { requireOwner } from '../_auth.js';
import { supabase } from '../_supabase.js';

const LIST_FIELDS = 'id,name,city';

/** Pola potrzebne RestaurantManager.jsx (DetailsTab, linie 293-298 + 330-334). */
const DETAIL_FIELDS =
  'id,name,city,address,phone,website,is_active,delivery_available,cuisine_type,maps_rating,image_url,photo_gallery';

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
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const auth = await requireOwner(req, res);
  if (!auth) return; // requireOwner juz wyslal 401

  const restaurantId = extractRestaurantId(req);

  try {
    if (!restaurantId) {
      const { data, error } = await supabase
        .from('restaurants')
        .select(LIST_FIELDS)
        .eq('owner_id', auth.userId)
        .order('name');
      if (error) throw error;
      return res.status(200).json({ ok: true, data: data || [] });
    }

    const { data, error } = await supabase
      .from('restaurants')
      .select(DETAIL_FIELDS)
      .eq('id', restaurantId)
      .eq('owner_id', auth.userId)
      .maybeSingle();
    if (error) throw error;

    if (!data) {
      return res.status(404).json({ ok: false, error: 'not_found' });
    }
    return res.status(200).json({ ok: true, data });
  } catch (err) {
    console.error('[OWNER_RESTAURANTS] error:', err?.message);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
}
