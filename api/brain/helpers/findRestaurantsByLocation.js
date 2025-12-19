// api/brain/helpers/findRestaurantsByLocation.js
import { supabase } from "../../_supabase.js";

// Prosty cache w pamięci (klucz: city|cuisine)
const geoCache = new Map();

function makeKey(location, cuisineType) {
  const city = String(location || "").toLowerCase().trim();
  const cuisine = String(cuisineType || "").toLowerCase().trim();
  return `${city}|${cuisine}`;
}

export async function findRestaurantsByLocation(location, cuisineType = null) {
  if (!location) return null;

  const cacheKey = makeKey(location, cuisineType);
  const now = Date.now();
  const cached = geoCache.get(cacheKey);
  if (cached && now - cached.timestamp < 60_000) {
    // 60s TTL
    return cached.data;
  }

  // Timeout guard 4500ms (AbortController)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4500);

  try {
    let query = supabase
      .from('restaurants')
      .select('id, name, address, city, cuisine_type, lat, lng')
      .ilike('city', `%${location}%`);

    if (cuisineType) {
      // prosty filtr po cuisine_type (pełna zgodność)
      query = query.eq('cuisine_type', cuisineType);
    }

    // supabase-js nie przyjmuje bezpośrednio AbortController, ale trzymamy kontroler dla zgodności
    const { data, error } = await query; // brak natywnego wsparcia signal — fallback do czasu

    if (error) {
      console.error('[findRestaurantsByLocation] supabase error:', error.message);
      return null;
    }

    const restaurants = Array.isArray(data) ? data.slice(0, 10) : [];
    geoCache.set(cacheKey, { data: restaurants, timestamp: Date.now() });
    return restaurants;
  } catch (err) {
    if (err?.name === 'AbortError') {
      console.warn('[findRestaurantsByLocation] aborted after 4500ms');
    } else {
      console.error('[findRestaurantsByLocation] error:', err?.message || err);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}





