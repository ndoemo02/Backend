import { describe, it, expect, beforeEach, vi } from 'vitest';

import { BrainPipeline } from '../core/pipeline.js';
import { NLURouter } from '../nlu/router.js';
import { InMemoryRestaurantRepository } from '../core/repository.js';
import { getSession, updateSession } from '../session/sessionStore.js';

vi.mock('../../_supabase.js', () => {
  const empty = { data: [], error: null };
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(empty),
    then: vi.fn((onSuccess) => Promise.resolve(empty).then(onSuccess))
  };

  return {
    supabase: {
      from: vi.fn(() => builder)
    }
  };
});

vi.mock('../services/DebugSessionState.js', () => ({
  updateDebugSession: vi.fn()
}));

vi.mock('../../brain/supabaseClient.js', () => ({
  default: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null })
    }))
  }
}));

const CALLZONE_ID = 'bd9f2244-7618-4071-aa96-52616a7b4c70';
const STARA_ID = '1fc1e782-bac6-47b2-978a-f6f2b38000cd';
const DWOR_ID = 'af8448ef-974b-46c8-a4ae-b04b8dc7c9f8';

const CALLZONE_MENU = [
  { id: 'call-v1', name: 'Vege Burger', base_name: 'Vege Burger', price_pln: 28, description: 'Burger vege', category: 'burger', available: true },
  { id: 'call-b1', name: 'Bacon Burger', base_name: 'Bacon Burger', price_pln: 32, description: 'Burger z bekonem', category: 'burger', available: true }
];

const STARA_MENU = [
  { id: 'sk-n1', name: 'Nalesnik z nutella, bananami, bita smietana', base_name: 'Nalesnik z nutella bananami bita smietana', price_pln: 16, description: 'Nutella i banan', category: 'nalesnik', available: true },
  { id: 'sk-n2', name: 'Nalesnik z kurczakiem i warzywami', base_name: 'Nalesnik z kurczakiem i warzywami', price_pln: 24, description: 'Kurczak i warzywa', category: 'nalesnik', available: true },
  { id: 'sk-n3', name: 'Nalesnik ze szpinakiem i serem feta', base_name: 'Nalesnik ze szpinakiem i serem feta', price_pln: 22, description: 'Szpinak i feta', category: 'nalesnik', available: true },
  { id: 'sk-g1', name: 'Gulasz po wegiersku', base_name: 'Gulasz po wegiersku', price_pln: 23, description: 'Gulasz wolowy', category: 'danie glowne', available: true },
  { id: 'sk-z1', name: 'Zupa dnia', base_name: 'Zupa dnia', price_pln: 12, description: 'Codzienna zupa', category: 'zupa', available: true },
  { id: 'sk-c1', name: 'Coca-Cola, Fanta, Sprite, Cappy (200 ml)', base_name: 'Coca Cola Fanta Sprite Cappy', price_pln: 7, description: 'Napoje', category: 'napoj', available: true }
];

const DWOR_MENU = [
  { id: 'dh-r1', name: 'Rosol domowy', base_name: 'Rosol domowy', price_pln: 18, description: 'Rosol', category: 'zupa', available: true },
  { id: 'dh-k1', name: 'Kaczka pieczona', base_name: 'Kaczka pieczona', price_pln: 39, description: 'Kaczka', category: 'danie glowne', available: true }
];

vi.mock('../menuService.js', () => ({
  loadMenuPreview: vi.fn(async (restaurantId) => {
    if (restaurantId === CALLZONE_ID) {
      return { menu: CALLZONE_MENU, shortlist: CALLZONE_MENU.slice(0, 3), fallbackUsed: false };
    }
    if (restaurantId === STARA_ID) {
      return { menu: STARA_MENU, shortlist: STARA_MENU.slice(0, 3), fallbackUsed: false };
    }
    if (restaurantId === DWOR_ID) {
      return { menu: DWOR_MENU, shortlist: DWOR_MENU.slice(0, 3), fallbackUsed: false };
    }
    return { menu: [], shortlist: [], fallbackUsed: false };
  }),
  getMenuItems: vi.fn(async (restaurantId) => {
    if (restaurantId === CALLZONE_ID) return CALLZONE_MENU;
    if (restaurantId === STARA_ID) return STARA_MENU;
    if (restaurantId === DWOR_ID) return DWOR_MENU;
    return [];
  }),
}));

const RESTAURANTS = [
  { id: CALLZONE_ID, name: 'Callzone', city: 'Piekary Slaskie', cuisine_type: 'Pizzeria', lat: 50.3801, lng: 18.9502 },
  { id: STARA_ID, name: 'Restauracja Stara Kamienica', city: 'Piekary Slaskie', cuisine_type: 'Polska', lat: 50.3791, lng: 18.9491 },
  { id: DWOR_ID, name: 'Dwor Hubertus', city: 'Piekary Slaskie', cuisine_type: 'Slaska / Europejska', lat: 50.3788, lng: 18.9478 }
];

function createPipeline() {
  return new BrainPipeline({
    nlu: new NLURouter(),
    repository: new InMemoryRestaurantRepository({ restaurants: RESTAURANTS })
  });
}

async function confirmPendingOrder(pipeline, sessionId) {
  const result = await pipeline.process(sessionId, 'potwierdzam');
  expect(result.meta?.source).toBe('confirm_add_to_cart_handler');
  return getSession(sessionId);
}

describe('TEXT write-path safety regressions', () => {
  beforeEach(() => {
    global.BRAIN_DEBUG = false;
    process.env.USE_LLM_INTENT = 'false';
  });

  it('A: explicit restaurant/menu targeting keeps restaurant context', async () => {
    const pipeline = createPipeline();
    const sessionId = `sess_text_target_${Date.now()}`;

    const menuResult = await pipeline.process(sessionId, 'pokaz menu Stara Kamienica');
    const calzoneResult = await pipeline.process(`${sessionId}_2`, 'pokaz restauracje Calzone');
    const wishResult = await pipeline.process(`${sessionId}_3`, 'chce cos z restauracji Stara Kamienica');
    const session = getSession(sessionId);
    const session2 = getSession(`${sessionId}_2`);
    const session3 = getSession(`${sessionId}_3`);

    expect(['select_restaurant', 'menu_request']).toContain(menuResult.intent);
    expect(session.currentRestaurant?.id).toBe(STARA_ID);
    expect(Array.isArray(session.last_menu)).toBe(true);
    expect(session.last_menu.length).toBeGreaterThan(0);

    expect(['select_restaurant', 'menu_request']).toContain(calzoneResult.intent);
    expect(session2.currentRestaurant?.id).toBe(CALLZONE_ID);

    expect(['select_restaurant', 'menu_request', 'create_order']).toContain(wishResult.intent);
    expect(session3.currentRestaurant?.id).toBe(STARA_ID);
  });

  it('A1: qualified next request stays in the active menu context', async () => {
    const pipeline = createPipeline();
    const sessionId = `sess_menu_next_${Date.now()}`;

    await pipeline.process(sessionId, 'pokaz menu Stara Kamienica');
    const result = await pipeline.process(sessionId, 'Jakie są kolejne dania główne?');
    const session = getSession(sessionId);

    expect(result.intent).toBe('menu_request');
    expect(result.restaurants || []).toHaveLength(0);
    expect(result.menuItems || result.menu || []).not.toHaveLength(0);
    expect(session.currentRestaurant?.id).toBe(STARA_ID);
    expect(session.last_menu).toHaveLength(STARA_MENU.length);
  });

  it('A2: UI restaurant selection uses the exact ID from the last discovery list', async () => {
    const pipeline = createPipeline();
    const sessionId = `sess_ui_select_${Date.now()}`;
    updateSession(sessionId, { last_restaurants_list: RESTAURANTS });
    const nluSpy = vi.spyOn(pipeline.nlu, 'detect');

    const result = await pipeline.process(sessionId, 'Restauracja Stara Kamienica', {
      requestBody: {
        meta: {
          channel: 'web',
          ui_action: { type: 'select_restaurant', restaurant_id: STARA_ID },
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.intent).toBe('select_restaurant');
    expect(nluSpy).not.toHaveBeenCalled();
    expect(getSession(sessionId).currentRestaurant?.id).toBe(STARA_ID);
  });

  it('A3: stale UI restaurant ID is rejected without mutating restaurant context', async () => {
    const pipeline = createPipeline();
    const sessionId = `sess_ui_select_stale_${Date.now()}`;
    updateSession(sessionId, { last_restaurants_list: RESTAURANTS });
    const result = await pipeline.process(sessionId, 'Nieaktualna restauracja', {
      requestBody: {
        meta: {
          channel: 'web',
          ui_action: { type: 'select_restaurant', restaurant_id: 'stale-id' },
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_restaurant_selection');
    expect(getSession(sessionId).currentRestaurant).toBeFalsy();
  });

  it('A4: UI restaurant selection revalidates an active ID after a session-list cache miss', async () => {
    const pipeline = createPipeline();
    const sessionId = `sess_ui_select_cache_miss_${Date.now()}`;

    const result = await pipeline.process(sessionId, 'Restauracja Stara Kamienica', {
      requestBody: {
        meta: {
          channel: 'web',
          ui_action: { type: 'select_restaurant', restaurant_id: STARA_ID },
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.intent).toBe('select_restaurant');
    expect(getSession(sessionId).currentRestaurant?.id).toBe(STARA_ID);
  });

  it('A5: UI restaurant selection resolves an exact active card name when its cached ID is unusable', async () => {
    const pipeline = createPipeline();
    const sessionId = `sess_ui_select_name_fallback_${Date.now()}`;

    const result = await pipeline.process(sessionId, 'Restauracja Stara Kamienica', {
      requestBody: {
        meta: {
          channel: 'web',
          ui_action: {
            type: 'select_restaurant',
            restaurant_id: 'unusable-cached-id',
            restaurant_name: 'Restauracja Stara Kamienica',
          },
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.intent).toBe('select_restaurant');
    expect(getSession(sessionId).currentRestaurant?.id).toBe(STARA_ID);
  });

  it('B: explicit restaurant + dish stays scoped and no cross-restaurant substitution', async () => {
    const pipeline = createPipeline();
    const s1 = `sess_text_scope_single_${Date.now()}`;
    const s2 = `sess_text_scope_cross_${Date.now()}`;

    const ok = await pipeline.process(s1, 'chcialbym nalesniki z nutella z restauracji Stara Kamienica');
    const bad = await pipeline.process(s2, 'dodaj nalesniki z nutella z restauracji Dwor Hubertus');
    const sessionOk = getSession(s1);
    const sessionBad = getSession(s2);
    const okCart = sessionOk?.cart?.items || [];
    const badCart = sessionBad?.cart?.items || [];

    expect(sessionOk.currentRestaurant?.id).toBe(STARA_ID);
    if (okCart.length > 0) {
      const okNames = okCart.map((item) => String(item.name || '').toLowerCase());
      expect(okNames.some((name) => name.includes('nales') || name.includes('nutella'))).toBe(true);
    }

    expect(bad.meta?.addedToCart || false).toBe(false);
    expect(sessionBad.currentRestaurant?.id).toBe(DWOR_ID);
    expect(badCart.length).toBe(0);
  });

  it('B2: restaurant context + "nalesniki z nutella" never aliases to chicken crepe', async () => {
    const pipeline = createPipeline();
    const sessionId = `sess_text_alias_${Date.now()}`;

    await pipeline.process(sessionId, 'pokaz menu Stara Kamienica');
    const result = await pipeline.process(sessionId, 'nalesniki z nutella');
    const session = getSession(sessionId);
    await confirmPendingOrder(pipeline, sessionId);
    const cartItems = session?.cart?.items || [];
    const names = cartItems.map((item) => String(item.name || '').toLowerCase());

    expect(result.meta?.addedToCart).toBe(false);
    expect(session.currentRestaurant?.id).toBe(STARA_ID);
    expect(names.some((name) => name.includes('nutella'))).toBe(true);
    expect(names.some((name) => name.includes('kurczak'))).toBe(false);
  });

  it('C: multi-item keeps quantity, order scope and item list in one restaurant', async () => {
    const pipeline = createPipeline();
    const sessionId = `sess_text_multi_${Date.now()}`;

    const result = await pipeline.process(
      sessionId,
      'dodaj dwa nalesniki z nutella, gulasz po wegiersku, zupe dnia i dwie cole z restauracji Stara Kamienica'
    );
    const session = getSession(sessionId);
    await confirmPendingOrder(pipeline, sessionId);
    const cartItems = session?.cart?.items || [];
    const names = cartItems.map((item) => String(item.name || '').toLowerCase());
    const totalQty = cartItems.reduce((sum, item) => sum + Number(item.qty || item.quantity || 1), 0);

    expect(result.meta?.addedToCart).toBe(false);
    expect(session.currentRestaurant?.id).toBe(STARA_ID);
    expect(cartItems.length).toBeGreaterThanOrEqual(4);
    expect(totalQty).toBeGreaterThanOrEqual(6);
    expect(names.some((n) => n.includes('nales'))).toBe(true);
    expect(names.some((n) => n.includes('gulasz'))).toBe(true);
    expect(names.some((n) => n.includes('zupa'))).toBe(true);
    expect(names.some((n) => n.includes('cola') || n.includes('coca'))).toBe(true);
  });

  it('D/E: ambiguity stays conservative (clarify/no forced add)', async () => {
    const pipeline = createPipeline();
    const sessionId = `sess_text_amb_${Date.now()}`;

    await pipeline.process(sessionId, 'Restauracja Stara Kamienica');
    const result = await pipeline.process(sessionId, 'dodaj cos dobrego');
    const session = getSession(sessionId);

    expect(result.meta?.addedToCart || false).toBe(false);
    expect(['clarify_order', 'menu_request', 'UNKNOWN_INTENT', 'create_order']).toContain(result.intent);
    expect((session?.cart?.items || []).length).toBe(0);
  });
});
