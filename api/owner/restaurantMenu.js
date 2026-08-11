/**
 * api/owner/restaurantMenu.js
 * ===========================================================================
 * D3 owner-write - menu (docs/HANDOFF_EXEC_SONNET5_2026-08-08.md sekcja D3,
 * kontrakt C5 zatwierdzony 2026-08-10).
 *
 * GET    /api/owner/restaurants/:id/menu               -> pelne menu wlasnej
 *                                                          restauracji (WLACZNIE
 *                                                          z available=false)
 * POST   /api/owner/restaurants/:id/menu                -> nowa pozycja
 * PATCH  /api/owner/restaurants/:restaurantId/menu/:itemId -> edycja pozycji
 * DELETE /api/owner/restaurants/:restaurantId/menu/:itemId -> usuniecie pozycji
 *
 * Auth identycznie jak restaurants.js: Bearer Supabase JWT -> requireOwner ->
 * auth.userId jest jedynym zrodlem tozsamosci.
 *
 * Ownership restauracji jest sprawdzane PRZED kazda operacja na menu_items_v2
 * (getOwnedRestaurant, ../_helpers.js) - menu_items_v2 nie ma wlasnej kolumny
 * owner_id (patrz GRANT SELECT w
 * supabase/migrations/20260808000400_stage10_public_catalog_rls.sql:106-109),
 * wiec wlasnosc pozycji menu jest zawsze tranzytywna przez restaurant_id.
 * Dla PATCH/DELETE pojedynczej pozycji ownership jest wymuszany DWUWARSTWOWO:
 * (1) restauracja :restaurantId nalezy do wywolujacego, (2) sam update/delete
 * ma `.eq('id', itemId).eq('restaurant_id', restaurantId)` w tym samym query -
 * item z innej restauracji nigdy nie zostanie trafiony, nawet gdyby jego `id`
 * bylo znane atakujacemu (IDOR).
 *
 * `restaurant_id` NIGDY nie jest czytane z req.body przy POST - zawsze z URL
 * param, po weryfikacji ownership. Klient nie moze skierowac inserta do cudzej
 * restauracji nawet podajac w body inny restaurant_id (pole nie jest w
 * allowliscie insertu, wiec generator patcha go w ogole nie widzi).
 *
 * GET zastepuje dzisiejszy bezposredni odczyt MenuTab.reload() z przegladarki
 * (RestaurantManager.jsx) - wymagany, bo Stage10 public SELECT na
 * menu_items_v2 pokazuje wylacznie available=true
 * (20260808000400_stage10_public_catalog_rls.sql:111-113); po Stage10 panel
 * wlasciciela przestalby widziec wlasne wylaczone pozycje bez tego endpointu
 * (gap opisany w docs/B5_OWNER_PANEL_WRITE_INVENTORY.md sekcja 4).
 * ===========================================================================
 */
import { requireOwner } from '../_auth.js';
import { supabase } from '../_supabase.js';
import { getOwnedRestaurant, buildAllowlistedPatch } from './_helpers.js';

/** Dokladnie kolumny, ktorych uzywa MenuTab (RestaurantManager.jsx render + reload). */
const MENU_FIELDS = 'id,name,price_pln,description,category,available,image_url,section_order';

/**
 * Allowlist D3 = dokladnie pola budowane w addItem()/saveEdit()
 * (RestaurantManager.jsx:562-570, :597-604). `restaurant_id` swiadomie POZA
 * schematem - insert ustawia je server-side z URL param, nigdy z body.
 */
const MENU_ITEM_SCHEMA = {
  name: { type: 'string', minLength: 1 },
  price_pln: { type: 'number', min: 0 },
  description: { type: 'string', nullable: true },
  category: { type: 'string', nullable: true },
  available: { type: 'boolean' },
  image_url: { type: 'string', nullable: true },
};

function sanitizeMenuPatch(body) {
  return buildAllowlistedPatch(body, MENU_ITEM_SCHEMA);
}

/**
 * Insert wymaga name+price_pln (identycznie jak client-side walidacja w
 * addItem(): `if (!addForm.name.trim()) throw ...`, `if (isNaN(price) ...)`).
 * Reszta pol jest opcjonalna z tymi samymi defaultami co EMPTY_ITEM_FORM
 * (description/category/image_url -> null, available -> true).
 * @returns {{ ok: true, row: object } | { ok: false }}
 */
function sanitizeMenuInsert(body) {
  const patch = sanitizeMenuPatch(body);
  if (typeof patch.name !== 'string' || patch.name.length === 0) return { ok: false };
  if (typeof patch.price_pln !== 'number') return { ok: false };
  return {
    ok: true,
    row: {
      name: patch.name,
      price_pln: patch.price_pln,
      description: 'description' in patch ? patch.description : null,
      category: 'category' in patch ? patch.category : null,
      available: 'available' in patch ? patch.available : true,
      image_url: 'image_url' in patch ? patch.image_url : null,
    },
  };
}

export default async function handler(req, res) {
  const allowed = ['GET', 'POST', 'PATCH', 'DELETE'];
  if (!allowed.includes(req.method)) {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const auth = await requireOwner(req, res);
  if (!auth) return; // requireOwner juz wyslal 401

  const restaurantId = req.params?.restaurantId || req.params?.id;
  if (typeof restaurantId !== 'string' || !restaurantId.trim()) {
    return res.status(400).json({ ok: false, error: 'missing_restaurant_id' });
  }

  const itemId = req.params?.itemId;
  if ((req.method === 'PATCH' || req.method === 'DELETE') && (typeof itemId !== 'string' || !itemId.trim())) {
    return res.status(400).json({ ok: false, error: 'missing_item_id' });
  }

  try {
    const owned = await getOwnedRestaurant(supabase, auth.userId, restaurantId);
    if (!owned) {
      return res.status(404).json({ ok: false, error: 'not_found' });
    }

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('menu_items_v2')
        .select(MENU_FIELDS)
        .eq('restaurant_id', restaurantId)
        .order('section_order', { ascending: true })
        .order('category', { nullsFirst: false })
        .order('name');
      if (error) throw error;
      return res.status(200).json({ ok: true, data: data || [] });
    }

    if (req.method === 'POST') {
      const sanitized = sanitizeMenuInsert(req.body);
      if (!sanitized.ok) {
        return res.status(400).json({ ok: false, error: 'invalid_payload' });
      }
      const { data, error } = await supabase
        .from('menu_items_v2')
        .insert({ ...sanitized.row, restaurant_id: restaurantId })
        .select(MENU_FIELDS)
        .single();
      if (error) throw error;
      return res.status(201).json({ ok: true, data });
    }

    if (req.method === 'PATCH') {
      const patch = sanitizeMenuPatch(req.body);
      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ ok: false, error: 'empty_patch' });
      }
      const { data, error } = await supabase
        .from('menu_items_v2')
        .update(patch)
        .eq('id', itemId)
        .eq('restaurant_id', restaurantId)
        .select(MENU_FIELDS)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        return res.status(404).json({ ok: false, error: 'not_found' });
      }
      return res.status(200).json({ ok: true, data });
    }

    // DELETE
    const { data, error } = await supabase
      .from('menu_items_v2')
      .delete()
      .eq('id', itemId)
      .eq('restaurant_id', restaurantId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ ok: false, error: 'not_found' });
    }
    return res.status(200).json({ ok: true, data: { id: itemId } });
  } catch (err) {
    console.error('[OWNER_RESTAURANT_MENU] error:', err?.message);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
}
