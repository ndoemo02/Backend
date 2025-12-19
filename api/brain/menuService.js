import { supabase } from "../_supabase.js";

const MENU_CACHE_TTL_MS = 60_000;
const cache = globalThis.__menuServiceCache || new Map();
globalThis.__menuServiceCache = cache;

const BANNED_CATEGORIES = ['napoje', 'napoj', 'napój', 'drinki', 'alkohol', 'sosy', 'sos', 'dodatki', 'extra'];
const BANNED_NAMES = ['cappy', 'coca-cola', 'cola', 'fanta', 'sprite', 'pepsi', 'sos', 'dodat', 'napoj', 'napój'];

function cacheKey(restaurantId, includeUnavailable) {
  return `${restaurantId}|${includeUnavailable ? "all" : "available"}`;
}

export async function getMenuItems(restaurantId, { includeUnavailable = false, limit = null, withDb = null } = {}) {
  if (!restaurantId) return [];
  const key = cacheKey(restaurantId, includeUnavailable);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.t < MENU_CACHE_TTL_MS) {
    const data = cached.data || [];
    return limit ? data.slice(0, limit) : data;
  }

  let query = supabase
    .from("menu_items_v2")
    .select("id, name, price_pln, description, category, available")
    .eq("restaurant_id", restaurantId);

  if (!includeUnavailable) {
    query = query.eq("available", true);
  }
  if (limit) {
    query = query.limit(limit);
  }

  const execPromise = query;
  const { data, error } = await (withDb ? withDb(execPromise) : execPromise);

  if (error || !data) {
    console.warn(`⚠️ getMenuItems: failed for restaurant ${restaurantId}`, error?.message);
    cache.delete(key);
    return [];
  }

  cache.set(key, { data, t: Date.now() });
  return limit ? data.slice(0, limit) : data;
}

export function buildMenuPreview(menu = [], { limit = 6, filterBanned = true } = {}) {
  if (!Array.isArray(menu) || !menu.length) return [];
  const filtered = filterBanned
    ? menu.filter((item) => {
        const c = String(item.category || "").toLowerCase();
        const n = String(item.name || "").toLowerCase();
        if (BANNED_CATEGORIES.some((b) => c.includes(b))) return false;
        if (BANNED_NAMES.some((b) => n.includes(b))) return false;
        return true;
      })
    : menu;
  const source = filtered.length ? filtered : menu;
  return source.slice(0, limit);
}

export function invalidateMenuCache(restaurantId) {
  if (!restaurantId) return;
  cache.delete(cacheKey(restaurantId, true));
  cache.delete(cacheKey(restaurantId, false));
}

export async function loadMenuPreview(restaurantId, { withDb = null, limit = 6 } = {}) {
  if (!restaurantId) return { menu: [], shortlist: [], fallbackUsed: false };
  let menu = await getMenuItems(restaurantId, { includeUnavailable: false, withDb });
  let fallbackUsed = false;
  if (!menu.length) {
    menu = await getMenuItems(restaurantId, { includeUnavailable: true, limit: 12, withDb });
    fallbackUsed = true;
  }
  const shortlist = buildMenuPreview(menu, { limit });
  return { menu, shortlist, fallbackUsed };
}

export function sumCartItems(items = []) {
  return items.reduce((acc, item) => {
    const price = Number(item.price_pln ?? item.price ?? 0);
    const qty = Number(item.qty ?? item.quantity ?? 1);
    return acc + price * qty;
  }, 0);
}

