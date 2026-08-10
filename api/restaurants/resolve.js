/**
 * api/restaurants/resolve.js
 * ===========================================================================
 * B1 aliases fallback (verify-first follow-up, 2026-08-10).
 *
 * GET /api/restaurants/resolve?name=<query>
 *
 * Publiczny endpoint katalogowy - bez auth, analogicznie do GET /api/restaurants.
 * Zastepuje bezposredni klientowy `.ilike('aliases', ...)` na `restaurants`
 * (dawniej frontend/src/state/CartContext.jsx:279-289), bo kolumna `aliases`
 * nie jest i nie ma byc w grancie anon/authenticated Stage10
 * (supabase/migrations/20260808000400_stage10_public_catalog_rls.sql).
 *
 * Uzywa istniejacego `resolveRestaurantByName()` (../brain/services/restaurantResolver.js),
 * rozszerzonego o krok 3 (dopasowanie po aliases, wylacznie server-side na
 * service_role). Ten plik NIGDY nie zwraca `aliases` ani `owner_id` -
 * odpowiedz jest jawnie zbudowana z dwoch pol (`id`, `name`), niezaleznie od
 * tego, co resolver mialby kiedys zwrocic dodatkowo.
 * ===========================================================================
 */
import { resolveRestaurantByName } from '../brain/services/restaurantResolver.js';

const MAX_NAME_LENGTH = 100;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const rawName = req.query?.name;
  const name = typeof rawName === 'string' ? rawName.trim() : '';

  if (!name) {
    return res.status(400).json({ ok: false, error: 'name_required' });
  }
  if (name.length > MAX_NAME_LENGTH) {
    return res.status(400).json({ ok: false, error: 'name_too_long' });
  }

  try {
    const match = await resolveRestaurantByName(name);
    if (!match) {
      return res.status(404).json({ ok: false, error: 'not_found' });
    }
    // Jawna rekonstrukcja odpowiedzi - nigdy nie przekazuj dalej surowego
    // obiektu z resolvera bez kontroli ksztaltu.
    return res.status(200).json({ ok: true, data: { id: match.id, name: match.name } });
  } catch (err) {
    console.error('[RESTAURANTS_RESOLVE] error:', err?.message);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
}
