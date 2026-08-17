import { describe, it, expect, beforeEach, vi } from 'vitest';

import { BrainPipeline } from '../core/pipeline.js';
import { NLURouter } from '../nlu/router.js';
import { InMemoryRestaurantRepository } from '../core/repository.js';
import { getSession, updateSession, closeConversation, getOrCreateActiveSession } from '../session/sessionStore.js';

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

vi.mock('../../debug.js', () => ({
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
const REZYDENCJA_ID = '4d27fbe3-20d0-4eb4-b003-1935be53af25';
const STARA_ID = '1fc1e782-bac6-47b2-978a-f6f2b38000cd';
const DWOR_ID = 'af8448ef-974b-46c8-a4ae-b04b8dc7c9f8';

const CALLZONE_MENU = [
  { id: 'call-v1', name: 'Vege Burger', base_name: 'Vege Burger', price_pln: 28, description: 'Burger vege', category: 'burger', available: true },
  { id: 'call-b1', name: 'Bacon Burger', base_name: 'Bacon Burger', price_pln: 32, description: 'Burger z bekonem', category: 'burger', available: true },
  { id: 'call-p1', name: 'Pizza Margherita', base_name: 'Pizza Margherita', price_pln: 29, description: 'Klasyczna pizza', category: 'pizza', available: true }
];

const REZYDENCJA_MENU = [
  { id: 'rez-1', name: 'Tagliatelle z krewetkami', base_name: 'Tagliatelle z krewetkami', price_pln: 28, description: 'Makaron', category: 'makaron', available: true }
];

const STARA_MENU = [
  { id: 'sk-n1', name: 'Nalesnik z nutella, bananami, bita smietana', base_name: 'Nalesnik z nutella bananami bita smietana', price_pln: 16, description: 'Nutella i banan', category: 'nalesnik', available: true },
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

    if (restaurantId === REZYDENCJA_ID) {
      return { menu: REZYDENCJA_MENU, shortlist: REZYDENCJA_MENU.slice(0, 3), fallbackUsed: false };
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
    if (restaurantId === REZYDENCJA_ID) return REZYDENCJA_MENU;
    if (restaurantId === STARA_ID) return STARA_MENU;
    if (restaurantId === DWOR_ID) return DWOR_MENU;
    return [];
  }),
}));

const RESTAURANTS = [
  { id: CALLZONE_ID, name: 'Callzone', city: 'Piekary Slaskie', cuisine_type: 'Pizzeria', lat: 50.3801, lng: 18.9502 },
  { id: REZYDENCJA_ID, name: 'Rezydencja Luxury Hotel', city: 'Piekary Slaskie', cuisine_type: 'Miedzynarodowa', lat: 50.381, lng: 18.9521 },
  { id: STARA_ID, name: 'Restauracja Stara Kamienica', city: 'Piekary Slaskie', cuisine_type: 'Polska', lat: 50.3791, lng: 18.9491 },
  { id: DWOR_ID, name: 'Dwor Hubertus', city: 'Piekary Slaskie', cuisine_type: 'Slaska / Europejska', lat: 50.3788, lng: 18.9478 },
  { id: '569a7d29-57be-4224-bdf3-09c483415cea', name: 'Klaps Burgers', city: 'Piekary Slaskie', cuisine_type: 'Amerykanska', lat: 50.3794, lng: 18.9487 }
];

function createPipeline() {
  return new BrainPipeline({
    nlu: new NLURouter(),
    repository: new InMemoryRestaurantRepository({ restaurants: RESTAURANTS })
  });
}

async function selectCallzone(pipeline, sessionId) {
  const result = await pipeline.process(sessionId, 'calzone');
  const session = getSession(sessionId);

  expect(result.intent).toBe('select_restaurant');
  expect(result.reply).toContain('Callzone');
  expect(session.currentRestaurant?.name).toBe('Callzone');
  expect(Array.isArray(session.last_menu)).toBe(true);
  expect(session.last_menu.length).toBeGreaterThan(0);

  return { result, session };
}

async function confirmPendingOrder(pipeline, sessionId) {
  const result = await pipeline.process(sessionId, 'potwierdzam');
  expect(result.meta?.source).toBe('confirm_add_to_cart_handler');
  return { result, session: getSession(sessionId) };
}

describe('Golden ordering flows', () => {
  beforeEach(() => {
    global.BRAIN_DEBUG = false;
    process.env.USE_LLM_INTENT = 'false';
  });

  it('flow 1: restaurant selection -> menu -> dish alias -> add to cart', async () => {
    const pipeline = createPipeline();
    const sessionId = `sess_golden_alias_${Date.now()}`;

    await selectCallzone(pipeline, sessionId);
    const result = await pipeline.process(sessionId, 'wege burger');
    const session = getSession(sessionId);

    expect(result.intent).toBe('create_order');
    expect(result.reply).toContain('Vege Burger');
    expect(result.meta?.addedToCart).toBe(false);
    await confirmPendingOrder(pipeline, sessionId);
    expect(session.cart?.items?.length).toBe(1);
    expect(session.cart.items[0].name).toBe('Vege Burger');
    expect(session.currentRestaurant?.name).toBe('Callzone');
  });

  it('flow 2: restaurant selection -> full dish name -> add to cart', async () => {
    const pipeline = createPipeline();
    const sessionId = `sess_golden_full_${Date.now()}`;

    await selectCallzone(pipeline, sessionId);
    const result = await pipeline.process(sessionId, 'Bacon Burger');
    const session = getSession(sessionId);

    expect(result.intent).toBe('create_order');
    expect(result.reply).toContain('Bacon Burger');
    expect(result.meta?.addedToCart).toBe(false);
    await confirmPendingOrder(pipeline, sessionId);
    expect(session.cart?.items?.length).toBe(1);
    expect(session.cart.items[0].name).toBe('Bacon Burger');
  });

  it('flow 3: restaurant selection -> qty=2 -> add to cart', async () => {
    const pipeline = createPipeline();
    const sessionId = `sess_golden_qty_${Date.now()}`;

    await selectCallzone(pipeline, sessionId);
    const result = await pipeline.process(sessionId, '2 wege burgery');
    const session = getSession(sessionId);

    expect(result.intent).toBe('create_order');
    expect(result.reply).toContain('2 sztuki Vege Burger');
    expect(result.meta?.addedToCart).toBe(false);
    await confirmPendingOrder(pipeline, sessionId);
    expect(session.cart?.items?.length).toBe(1);
    expect(session.cart.items[0].name).toBe('Vege Burger');
    expect(session.cart.items[0].qty || session.cart.items[0].quantity).toBe(2);
  });

  it('flow 4: after add-to-cart, escape to restaurant list is not blocked', async () => {
    const pipeline = createPipeline();
    const sessionId = `sess_golden_escape_${Date.now()}`;

    await selectCallzone(pipeline, sessionId);
    await pipeline.process(sessionId, 'wege burger');
    await confirmPendingOrder(pipeline, sessionId);

    updateSession(sessionId, {
      last_location: 'Piekary Slaskie'
    });

    const result = await pipeline.process(sessionId, 'pokaz restauracje');
    const session = getSession(sessionId);

    expect(result.intent).toBe('find_nearby');
    expect(session.cart?.items?.length).toBe(1);
    expect(session.cart.items[0].name).toBe('Vege Burger');
  });

  it('flow 5: after checkout close, a new session starts without ghost cart', async () => {
    const sessionId = `sess_golden_checkout_${Date.now()}`;

    updateSession(sessionId, {
      currentRestaurant: { id: CALLZONE_ID, name: 'Callzone' },
      lastRestaurant: { id: CALLZONE_ID, name: 'Callzone' },
      cart: {
        items: [{ id: 'call-v1', name: 'Vege Burger', price_pln: 28, qty: 1 }],
        total: 28,
        restaurantId: CALLZONE_ID
      },
      conversationPhase: 'ordering'
    });

    const closeResult = closeConversation(sessionId, 'ORDER_CONFIRMED');
    const next = getOrCreateActiveSession(sessionId);

    expect(closeResult.newSessionId).toBeTruthy();
    expect(next.isNew).toBe(true);
    expect(next.sessionId).not.toBe(sessionId);
    expect(next.session.cart?.items || []).toHaveLength(0);
    expect(next.session.currentRestaurant?.name).toBe('Callzone');
    expect(next.session.closedReason).toBeNull();
  });

  it('flow 6: dish alias inside restaurant context does not fall back to restaurant choice', async () => {
    const pipeline = createPipeline();
    const sessionId = `sess_golden_context_${Date.now()}`;

    await selectCallzone(pipeline, sessionId);
    const result = await pipeline.process(sessionId, 'wege burger');
    const session = getSession(sessionId);

    expect(result.intent).toBe('create_order');
    expect(result.reply).toContain('Vege Burger');
    expect(result.reply).not.toContain('Z ktorej restauracji');
    expect(session.currentRestaurant?.name).toBe('Callzone');
    await confirmPendingOrder(pipeline, sessionId);
    expect(session.cart?.items?.length).toBe(1);
  });

  it('flow 7: menu request prefers currentRestaurant over stale lastRestaurant', async () => {
    const pipeline = createPipeline();
    const sessionId = `sess_golden_menu_ctx_${Date.now()}`;

    updateSession(sessionId, {
      currentRestaurant: { id: CALLZONE_ID, name: 'Callzone' },
      lastRestaurant: { id: REZYDENCJA_ID, name: 'Rezydencja Luxury Hotel' },
      conversationPhase: 'restaurant_selected'
    });

    const result = await pipeline.process(sessionId, 'pokaz menu');
    const session = getSession(sessionId);

    expect(result.intent).toBe('menu_request');
    expect(Array.isArray(result.menuItems)).toBe(true);
    expect(result.menuItems[0]?.name).toBe('Vege Burger');
    expect(session.currentRestaurant?.name).toBe('Callzone');
    expect(session.lastRestaurant?.name).toBe('Callzone');
    expect(session.last_menu_restaurant_id).toBe(CALLZONE_ID);
  });

  it('flow 8: explicit "pokaz restauracje calzone" selects restaurant (not discovery)', async () => {
    const pipeline = createPipeline();
    const sessionId = `sess_golden_rest_target_${Date.now()}`;

    const result = await pipeline.process(sessionId, 'pokaz restauracje Calzone');
    const session = getSession(sessionId);

    // Pipeline may auto-advance to menu_request after explicit restaurant selection.
    expect(['select_restaurant', 'menu_request']).toContain(result.intent);
    expect(result.reply).toContain('Callzone');
    expect(session.currentRestaurant?.id).toBe(CALLZONE_ID);
  });

  it('flow 9: explicit restaurant + dish stays scoped to Stara Kamienica', async () => {
    const pipeline = createPipeline();
    const sessionId = `sess_golden_scope_single_${Date.now()}`;

    const result = await pipeline.process(sessionId, 'chcialbym nalesniki z nutella z restauracji Stara Kamienica');
    const session = getSession(sessionId);

    expect(result.intent).toBe('create_order');
    expect(result.meta?.addedToCart).toBe(false);
    expect(session.currentRestaurant?.id).toBe(STARA_ID);
    await confirmPendingOrder(pipeline, sessionId);
    const cartItems = getSession(sessionId)?.cart?.items || [];
    const names = cartItems.map((item) => item.name || item.base_name || '');
    expect(cartItems.length).toBeGreaterThan(0);
    expect(names.join(' ').toLowerCase()).toContain('nales');
  });

  it('flow 10: multi-item explicit restaurant keeps quantity and scope', async () => {
    const pipeline = createPipeline();
    const sessionId = `sess_golden_scope_multi_${Date.now()}`;

    const result = await pipeline.process(
      sessionId,
      'dodaj dwa nalesniki z nutella, gulasz po wegiersku, zupe dnia i dwie cole z restauracji Stara Kamienica'
    );
    const session = getSession(sessionId);

    expect(result.intent).toBe('create_order');
    expect(result.meta?.addedToCart).toBe(false);
    expect(session.currentRestaurant?.id).toBe(STARA_ID);
    await confirmPendingOrder(pipeline, sessionId);
    const cartItems = getSession(sessionId)?.cart?.items || [];
    const normalizedNames = cartItems.map((item) => String(item.name || '').toLowerCase());
    const totalQty = cartItems.reduce((sum, item) => sum + Number(item.qty || item.quantity || 1), 0);
    expect(cartItems.length).toBeGreaterThanOrEqual(3);
    expect(totalQty).toBeGreaterThanOrEqual(5);
    expect(normalizedNames.some((name) => name.includes('nales') || name.includes('nutell'))).toBe(true);
    expect(normalizedNames.some((name) => name.includes('gulasz'))).toBe(true);
  });

  it('flow 11: explicit restaurant lock blocks cross-restaurant substitution', async () => {
    const pipeline = createPipeline();
    const sessionId = `sess_golden_scope_cross_${Date.now()}`;

    const result = await pipeline.process(sessionId, 'dodaj nalesniki z nutella z restauracji Dwor Hubertus');
    const session = getSession(sessionId);
    const cartItems = session?.cart?.items || [];

    expect(result.meta?.addedToCart || false).toBe(false);
    expect(['clarify_order', 'create_order']).toContain(result.intent);
    expect(session.currentRestaurant?.id).toBe(DWOR_ID);
    expect(cartItems.length).toBe(0);
  });

  it('flow 12: low-confidence generic request clarifies instead of forcing substitution', async () => {
    const pipeline = createPipeline();
    const sessionId = `sess_golden_scope_amb_${Date.now()}`;

    await pipeline.process(sessionId, 'Restauracja Stara Kamienica');
    const result = await pipeline.process(sessionId, 'dodaj cos dobrego');
    const session = getSession(sessionId);

    expect(result.meta?.addedToCart || false).toBe(false);
    expect(['clarify_order', 'menu_request', 'UNKNOWN_INTENT', 'create_order']).toContain(result.intent);
    expect((session?.cart?.items || []).length).toBe(0);
  });
});

