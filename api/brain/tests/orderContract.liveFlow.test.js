/**
 * Order Contract — Live Flow Tests (2026-05-29)
 *
 * Tests transcript/tool-flow/order-contract, NOT audio/STT.
 * Covers structured menu focus, cross-family dish guard, and metadata pipeline.
 *
 * Scenarios A–J from docs/graphify/order-test-scenarios-2026-05-29.md
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Shared mock harness (reused from orderHandler.mainResolution.test.js pattern) ──

const { resolveMenuItemConflictMock, canonicalizeDishMock } = vi.hoisted(() => ({
    resolveMenuItemConflictMock: vi.fn(async () => ({ status: 'ITEM_NOT_FOUND' })),
    canonicalizeDishMock: vi.fn((text) => text),
}));

vi.mock('../services/DisambiguationService.js', () => ({
    DISAMBIGUATION_RESULT: {
        ITEM_NOT_FOUND: 'ITEM_NOT_FOUND',
        ADD_ITEM: 'ADD_ITEM',
        DISAMBIGUATION_REQUIRED: 'DISAMBIGUATION_REQUIRED',
    },
    resolveMenuItemConflict: resolveMenuItemConflictMock,
}));

vi.mock('../nlu/dishCanon.js', () => ({
    canonicalizeDish: canonicalizeDishMock,
}));

import { OrderHandler } from '../domains/food/orderHandler.js';
import { ConfirmAddToCartHandler } from '../domains/food/confirmAddToCartHandler.js';
import { ToolRouter } from '../../voice/live/ToolRouter.js';

// ── ToolRouter fake handlers (reused from liveToolRouter.test.js pattern) ──

function makeFakeHandlers() {
    return {
        food: {
            find_nearby: {
                execute: async () => ({
                    reply: 'Znalazłam restauracje.',
                    restaurants: [{ id: 'r1', name: 'Rest 1', distance: 1.2 }],
                    contextUpdates: { expectedContext: 'select_restaurant' },
                }),
            },
            select_restaurant: {
                execute: async () => ({
                    reply: 'Wybrano restaurację.',
                    contextUpdates: {
                        currentRestaurant: { id: 'r1', name: 'Rest 1' },
                        conversationPhase: 'restaurant_selected',
                    },
                }),
            },
            menu_request: {
                execute: async () => ({
                    reply: 'Pokazuję menu.',
                    menuItems: [{ id: 'm1', name: 'Pierogi', price_pln: 13 }],
                    contextUpdates: { expectedContext: 'create_order' },
                }),
            },
        },
        ordering: {
            create_order: {
                execute: async (ctx) => ({
                    reply: `Dodano ${ctx.entities?.dish || 'pozycję'}.`,
                    meta: { focusedMenuItemId: 'menu-1', addedToCart: true },
                    contextUpdates: {
                        cart: { items: [{ name: ctx.entities?.dish || 'x', qty: 1, id: 'menu-1' }], total: 13 },
                        expectedContext: 'order_continue',
                        pendingOrder: null,
                    },
                    actions: [{ type: 'SHOW_CART', payload: { mode: 'badge' } }],
                }),
            },
            confirm_add_to_cart: { execute: async () => ({ reply: 'Potwierdzono.', contextUpdates: { expectedContext: null } }) },
            open_checkout: { execute: async () => ({ reply: 'Checkout.', contextUpdates: { conversationPhase: 'checkout' } }) },
            confirm_order: { execute: async () => ({ reply: 'Zamówienie potwierdzone.', contextUpdates: { conversationPhase: 'idle' } }) },
            cancel_order: { execute: async () => ({ reply: 'Anulowano.', contextUpdates: { expectedContext: null } }) },
        },
        system: {
            fallback: { execute: async () => ({ reply: 'Fallback.' }) },
        },
    };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeMenuItems(items) {
    return items.map((item, i) => ({
        id: item.id || `menu-${i}`,
        name: item.name,
        base_name: item.base_name || item.name,
        category: item.category || 'Dania główne',
        type: item.type || 'MAIN',
        price_pln: item.price_pln || 20,
        ...item.extra,
    }));
}

function makeSession(overrides = {}) {
    return {
        conversationPhase: 'neutral',
        orderMode: 'neutral',
        cart: { items: [], total: 0 },
        ...overrides,
    };
}

// ────────────────────────────────────────────────────────────────────────────────
// A. Jednoznaczne danie + jednoznaczna restauracja
// ────────────────────────────────────────────────────────────────────────────────
describe('A — unambiguous dish + restaurant', () => {
    let handler;

    beforeEach(() => {
        handler = new OrderHandler();
        resolveMenuItemConflictMock.mockClear();
        canonicalizeDishMock.mockReset();
    });

    it('A1: resolves dish, emits focusedMenuItemId, and prepares confirmation', async () => {
        canonicalizeDishMock.mockReturnValue('pierogi ruskie');

        resolveMenuItemConflictMock.mockResolvedValue({
            status: 'ADD_ITEM',
            item: { id: 'menu-pierogi-1', name: 'Pierogi ruskie', base_name: 'Pierogi ruskie', type: 'MAIN', price_pln: 18 },
            score: 1.4,
            source: 'scoped_restaurant',
        });

        const session = makeSession({
            currentRestaurant: { id: 'sk1', name: 'Stara Kamienica' },
            lastRestaurant: { id: 'sk1', name: 'Stara Kamienica' },
            last_menu: [
                { id: 'menu-pierogi-1', name: 'Pierogi ruskie', base_name: 'Pierogi ruskie', category: 'Dania główne', type: 'MAIN', price_pln: 18 },
            ],
        });

        const response = await handler.execute({
            text: 'pierogi ruskie',
            entities: { dish: 'pierogi ruskie', quantity: 1 },
            session,
        });

        // The order handler prepares a grounded draft; only confirmation may mutate the cart.
        expect(response.contextUpdates?.lastIntent).toBe('create_order');
        expect(response.meta?.focusedMenuItemId).toBe('menu-pierogi-1');
        expect(response.meta?.addedToCart).toBe(false);
        expect(session.cart.items.length).toBe(0);
        expect(session.pendingOrder?.items?.[0]?.id).toBe('menu-pierogi-1');
        expect(session.expectedContext).toBe('confirm_add_to_cart');
    });

    it('A1b: response contract shape is preserved', async () => {
        canonicalizeDishMock.mockReturnValue('pierogi ruskie');

        resolveMenuItemConflictMock.mockResolvedValue({
            status: 'ADD_ITEM',
            item: { id: 'menu-pierogi-1', name: 'Pierogi ruskie', base_name: 'Pierogi ruskie', type: 'MAIN', price_pln: 18 },
            score: 1.4,
            source: 'scoped_restaurant',
        });

        const session = makeSession({
            currentRestaurant: { id: 'sk1', name: 'Stara Kamienica' },
            lastRestaurant: { id: 'sk1', name: 'Stara Kamienica' },
            last_menu: [
                { id: 'menu-pierogi-1', name: 'Pierogi ruskie', base_name: 'Pierogi ruskie', category: 'Dania główne', type: 'MAIN', price_pln: 18 },
            ],
        });

        const response = await handler.execute({
            text: 'pierogi ruskie',
            entities: { dish: 'pierogi ruskie', quantity: 1 },
            session,
        });

        // Contract: response must have these keys
        expect(response).toHaveProperty('reply');
        expect(response.meta).toBeDefined();
        expect(response.meta).toHaveProperty('focusedMenuItemId');
        expect(response.meta).toHaveProperty('addedToCart');
        expect(response.meta).toHaveProperty('source');
        expect(response.contextUpdates).toBeDefined();
        expect(response.contextUpdates).toHaveProperty('cart');
        expect(response.contextUpdates).toHaveProperty('conversationPhase');
    });
});

// ────────────────────────────────────────────────────────────────────────────────
// B. Danie bez restauracji
// ────────────────────────────────────────────────────────────────────────────────
describe('B — dish without restaurant', () => {
    let handler;

    beforeEach(() => {
        handler = new OrderHandler();
        resolveMenuItemConflictMock.mockClear();
        canonicalizeDishMock.mockReset();
    });

    it('B1: dish without locked restaurant → clarify_order, cart_delta 0', async () => {
        canonicalizeDishMock.mockReturnValue('kebab');

        resolveMenuItemConflictMock.mockResolvedValue({
            status: 'ITEM_NOT_FOUND',
            score: 0,
            source: 'global_index',
        });

        const session = makeSession({
            // No currentRestaurant — user hasn't selected one
            last_menu: [],
        });

        const response = await handler.execute({
            text: 'kebab',
            entities: { dish: 'kebab', quantity: 1 },
            session,
        });

        expect(response.intent).toBe('clarify_order');
        expect(response.meta?.addedToCart).not.toBe(true);
        expect(session.cart.items.length).toBe(0);
        // No focusedMenuItemId when dish not found
        expect(response.meta?.focusedMenuItemId).toBeFalsy();
    });

    it('B2: no side-effect on session cart when clarify_order', async () => {
        canonicalizeDishMock.mockReturnValue('kebab');

        resolveMenuItemConflictMock.mockResolvedValue({
            status: 'ITEM_NOT_FOUND',
            score: 0,
        });

        const session = makeSession({ last_menu: [] });
        const cartBefore = JSON.stringify(session.cart);

        await handler.execute({
            text: 'kebab',
            entities: { dish: 'kebab', quantity: 1 },
            session,
        });

        expect(JSON.stringify(session.cart)).toBe(cartBefore);
    });
});

// ────────────────────────────────────────────────────────────────────────────────
// C. Konflikt dań między restauracjami
// ────────────────────────────────────────────────────────────────────────────────
describe('C — cross-restaurant dish conflict', () => {
    let handler;

    beforeEach(() => {
        handler = new OrderHandler();
        resolveMenuItemConflictMock.mockClear();
        canonicalizeDishMock.mockReset();
    });

    it('C1: item not in locked restaurant → ITEM_NOT_FOUND, cart_delta 0', async () => {
        canonicalizeDishMock.mockReturnValue('pizza margherita');

        // Disambiguation returns ITEM_NOT_FOUND because item is not in scoped restaurant
        resolveMenuItemConflictMock.mockResolvedValue({
            status: 'ITEM_NOT_FOUND',
            score: null,
            source: 'scoped_restaurant',
        });

        const session = makeSession({
            currentRestaurant: { id: 'sk1', name: 'Stara Kamienica' },
            lastRestaurant: { id: 'sk1', name: 'Stara Kamienica' },
            last_menu: [
                { id: 'menu-1', name: 'Pierogi ruskie', base_name: 'Pierogi ruskie', type: 'MAIN', price_pln: 18, restaurant_id: 'sk1' },
            ],
        });

        const response = await handler.execute({
            text: 'pizza margherita',
            entities: { dish: 'pizza margherita', quantity: 1 },
            session,
        });

        expect(response.intent).toBe('clarify_order');
        expect(response.meta?.addedToCart).not.toBe(true);
        expect(session.cart.items.length).toBe(0);
        // No focusedMenuItemId — dish wasn't resolved
        expect(response.meta?.focusedMenuItemId).toBeFalsy();
    });
});

// ────────────────────────────────────────────────────────────────────────────────
// D. Lody vs naleśniki — cross-family guard
// ────────────────────────────────────────────────────────────────────────────────
describe('D — ice cream vs pancakes (cross-family guard)', () => {
    let handler;

    beforeEach(() => {
        handler = new OrderHandler();
        resolveMenuItemConflictMock.mockClear();
        canonicalizeDishMock.mockReset();
    });

    it('D1: ice cream request does not match pancake via shared modifiers', async () => {
        canonicalizeDishMock.mockReturnValue('puchar lodowy z owocami i bita smietana');

        // Simulate DisambiguationService returning ITEM_NOT_FOUND
        // (the cross-family guard in hasFallbackDishSignalCompatibility blocks it)
        resolveMenuItemConflictMock.mockResolvedValue({
            status: 'ITEM_NOT_FOUND',
            score: null,
            source: 'scoped_restaurant',
        });

        const session = makeSession({
            currentRestaurant: { id: 'R_HUB', name: 'Dwor Hubertus' },
            lastRestaurant: { id: 'R_HUB', name: 'Dwor Hubertus' },
            last_menu: [
                {
                    id: 'main-nalesniki-ser',
                    name: 'Nalesniki z serem na slodko z bita smietana',
                    base_name: 'Nalesniki z serem na slodko z bita smietana',
                    category: 'Dla dzieci',
                    type: 'MAIN',
                    price_pln: 18,
                },
                {
                    id: 'main-rosol',
                    name: 'Rosol z makaronem',
                    base_name: 'Rosol z makaronem',
                    category: 'Zupy',
                    type: 'MAIN',
                    price_pln: 15,
                },
            ],
        });

        const response = await handler.execute({
            text: 'Puchar lodowy z owocami i bita smietana',
            entities: { dish: 'Puchar lodowy z owocami i bita smietana', quantity: 1 },
            session,
        });

        // Critical: must NOT add naleśniki as false positive
        expect(response.intent).toBe('clarify_order');
        expect(response.meta?.addedToCart).not.toBe(true);
        expect(session.cart.items.length).toBe(0);
        // No focusedMenuItemId for unresolved dish
        expect(response.meta?.focusedMenuItemId).toBeFalsy();

        // Sanity: the pancake item must NOT have been added
        const pancakeInCart = session.cart.items.some(item =>
            item.name?.toLowerCase().includes('nalesniki'));
        expect(pancakeInCart).toBe(false);
    });
});

// ────────────────────────────────────────────────────────────────────────────────
// E. search_menu_items → focusedMenuItemId
// ────────────────────────────────────────────────────────────────────────────────
describe('E — search_menu_items focusedMenuItemId', () => {
    it('E1: search_menu_items emits focusedMenuItemId for first match', async () => {
        const sessions = new Map([
            ['sess_search_focus', {
                menuItems: [
                    { id: 'menu-1', name: 'Pierogi ruskie', price: 18, item_tags: ['pierogi'] },
                    { id: 'menu-2', name: 'Rosol', price: 15, item_tags: ['zupa'] },
                ],
            }],
        ]);
        const getSession = (id) => sessions.get(id) || {};
        const updateSession = (id, patch) => {
            const next = { ...(sessions.get(id) || {}), ...patch };
            sessions.set(id, next);
            return next;
        };

        const router = new ToolRouter({
            handlers: makeFakeHandlers(),
            getSession,
            updateSession,
        });

        const result = await router.executeToolCall({
            sessionId: 'sess_search_focus',
            toolName: 'search_menu_items',
            args: { query: 'pierogi' },
            requestId: 'req-search-focus',
        });

        expect(result.ok).toBe(true);
        expect(result.response.menuItems[0].id).toBe('menu-1');
        expect(result.response.meta?.focusedMenuItemId).toBe('menu-1');
        expect(result.response.meta?.source).toBe('live_tool:search_menu_items');
    });

    it('E2: search_menu_items returns null focusedMenuItemId when no matches', async () => {
        const sessions = new Map([
            ['sess_search_empty', {
                menuItems: [
                    { id: 'menu-1', name: 'Pierogi ruskie', price: 18 },
                ],
            }],
        ]);
        const getSession = (id) => sessions.get(id) || {};
        const updateSession = (id, patch) => {
            const next = { ...(sessions.get(id) || {}), ...patch };
            sessions.set(id, next);
            return next;
        };

        const router = new ToolRouter({
            handlers: makeFakeHandlers(),
            getSession,
            updateSession,
        });

        const result = await router.executeToolCall({
            sessionId: 'sess_search_empty',
            toolName: 'search_menu_items',
            args: { query: 'xyz_nonexistent_123' },
            requestId: 'req-search-empty',
        });

        expect(result.ok).toBe(true);
        expect(result.response.menuItems).toEqual([]);
        // focusedMenuItemId should be null/absent when no matches
        expect(result.response.meta?.focusedMenuItemId || null).toBeNull();
    });
});

// ────────────────────────────────────────────────────────────────────────────────
// F. confirm_add_to_cart → focusedMenuItemId
// ────────────────────────────────────────────────────────────────────────────────
describe('F — confirm_add_to_cart focusedMenuItemId', () => {
    it('F1: emits focusedMenuItemId from pending order item id', async () => {
        const session = {
            pendingOrder: {
                restaurant: 'Test Bistro',
                restaurant_id: 'rest-1',
                items: [
                    {
                        id: 'menu-1',
                        name: 'Pierogi',
                        price_pln: 13,
                        quantity: 1,
                    },
                ],
            },
            cart: { items: [], total: 0 },
        };

        const result = await new ConfirmAddToCartHandler().execute({
            session,
            entities: {},
            sessionId: 'sess-focus-confirm',
            services: {
                getMenuItems: async () => [{
                    id: 'menu-1',
                    restaurant_id: 'rest-1',
                    name: 'Pierogi',
                    price_pln: 13,
                    available: true,
                }],
            },
        });

        expect(result.meta?.focusedMenuItemId).toBe('menu-1');
        expect(result.meta?.source).toBe('confirm_add_to_cart_handler');
        expect(result.meta?.restaurant).toBeDefined();
        expect(result.meta?.restaurant.id).toBe('rest-1');
    });

    it('F2: confirm_add_to_cart returns null focusedMenuItemId when item has no id', async () => {
        const session = {
            pendingOrder: {
                restaurant: 'Test Bistro',
                restaurant_id: 'rest-2',
                items: [
                    {
                        // No id, no menu_item_id — only name
                        name: 'Pierogi',
                        price_pln: 13,
                        quantity: 1,
                    },
                ],
            },
            cart: { items: [], total: 0 },
        };

        const result = await new ConfirmAddToCartHandler().execute({
            session,
            entities: {},
            sessionId: 'sess-focus-noid',
            services: {
                getMenuItems: async () => [{
                    id: 'menu-1',
                    restaurant_id: 'rest-2',
                    name: 'Pierogi',
                    price_pln: 13,
                    available: true,
                }],
            },
        });

        expect(result.meta?.source).toBe('confirm_add_to_cart_revalidation_rejected');
        expect(result.meta?.reason).toBe('item_id_missing');
        expect(session.cart.items).toEqual([]);
    });
});

// ────────────────────────────────────────────────────────────────────────────────
// G. confirm_order blocked without pendingOrder
// ────────────────────────────────────────────────────────────────────────────────
describe('G — confirm_order blocked (IVL guard)', () => {
    it('G1: confirm_order without pendingOrder returns clarify, no side-effect', async () => {
        const sessions = new Map([
            ['sess_confirm_block', {
                conversationPhase: 'ordering',
                orderMode: 'awaiting_confirmation',
                pendingOrder: null,
                expectedContext: null,
                cart: { items: [{ name: 'Pierogi', qty: 1 }], total: 13 },
            }],
        ]);
        const getSession = (id) => sessions.get(id) || {};
        const updateSession = (id, patch) => {
            const next = { ...(sessions.get(id) || {}), ...patch };
            sessions.set(id, next);
            return next;
        };

        const router = new ToolRouter({
            handlers: makeFakeHandlers(),
            getSession,
            updateSession,
        });

        const sessionBefore = JSON.stringify(sessions.get('sess_confirm_block'));

        const result = await router.executeToolCall({
            sessionId: 'sess_confirm_block',
            toolName: 'confirm_order',
            args: {},
            requestId: 'req-confirm-block',
        });

        // IVL blocks with confirm_order_state_missing — returns ok=true with clarify metadata
        expect(result.ok).toBe(true);
        expect(result.response.meta?.intentVerification?.reason).toBe('confirm_order_state_missing');
        expect(result.trace.some(t => t.includes('ivl_blocked:confirm_order_state_missing'))).toBe(true);
        // Session must be unchanged (no side-effect)
        expect(JSON.stringify(sessions.get('sess_confirm_block'))).toBe(sessionBefore);
    });

    it('G2: create_order via ToolRouter without currentRestaurant asks for grounded context', async () => {
        const sessions = new Map([
            ['sess_no_rest', {
                conversationPhase: 'neutral',
                orderMode: 'neutral',
                cart: { items: [], total: 0 },
                menuItems: [
                    { id: 'menu-1', name: 'Pierogi', price: 18 },
                ],
            }],
        ]);
        const getSession = (id) => sessions.get(id) || {};
        const updateSession = (id, patch) => {
            const next = { ...(sessions.get(id) || {}), ...patch };
            sessions.set(id, next);
            return next;
        };

        const router = new ToolRouter({
            handlers: makeFakeHandlers(),
            getSession,
            updateSession,
        });

        const result = await router.executeToolCall({
            sessionId: 'sess_no_rest',
            toolName: 'add_item_to_cart',
            args: { dish_name: 'pierogi' },
            requestId: 'req-no-rest',
        });

        // No restaurant context means no safe cart mutation and no invented location search.
        expect(result.ok).toBe(true);
        expect(result.response.intent).toBe('clarify_order');
        // Cart must be empty (no item added without restaurant context)
        const session = sessions.get('sess_no_rest');
        expect(session.cart.items.length).toBe(0);
    });
});

// ────────────────────────────────────────────────────────────────────────────────
// H. "To drugie" — ordinal selection (conceptual contract)
// ────────────────────────────────────────────────────────────────────────────────
describe('H — ordinal selection after disambiguation', () => {
    let handler;

    beforeEach(() => {
        handler = new OrderHandler();
        resolveMenuItemConflictMock.mockClear();
        canonicalizeDishMock.mockReset();
    });

    it('H1: DISAMBIGUATION_REQUIRED returns clarify, does not add anything', async () => {
        canonicalizeDishMock.mockReturnValue('pierogi');

        resolveMenuItemConflictMock.mockResolvedValue({
            status: 'DISAMBIGUATION_REQUIRED',
            candidates: [
                { id: 'menu-1', name: 'Pierogi ruskie', score: 1.1 },
                { id: 'menu-2', name: 'Pierogi z miesem', score: 1.05 },
            ],
        });

        const session = makeSession({
            currentRestaurant: { id: 'sk1', name: 'Stara Kamienica' },
            lastRestaurant: { id: 'sk1', name: 'Stara Kamienica' },
            last_menu: [
                { id: 'menu-1', name: 'Pierogi ruskie', base_name: 'Pierogi ruskie', type: 'MAIN', price_pln: 18 },
                { id: 'menu-2', name: 'Pierogi z miesem', base_name: 'Pierogi z miesem', type: 'MAIN', price_pln: 20 },
            ],
        });

        const response = await handler.execute({
            text: 'pierogi',
            entities: { dish: 'pierogi', quantity: 1 },
            session,
        });

        // Disambiguation required → must not auto-add
        expect(response.intent).toBe('clarify_order');
        expect(response.meta?.addedToCart).not.toBe(true);
        expect(session.cart.items.length).toBe(0);
    });

    it('H2: second attempt with explicit ordinal context resolves correctly', async () => {
        canonicalizeDishMock.mockReturnValue('pierogi z miesem');

        // Second call: user specified "to drugie" → unambiguous
        resolveMenuItemConflictMock.mockResolvedValue({
            status: 'ADD_ITEM',
            item: { id: 'menu-2', name: 'Pierogi z miesem', base_name: 'Pierogi z miesem', type: 'MAIN', price_pln: 20 },
            score: 1.3,
            source: 'scoped_restaurant',
        });

        const session = makeSession({
            currentRestaurant: { id: 'sk1', name: 'Stara Kamienica' },
            lastRestaurant: { id: 'sk1', name: 'Stara Kamienica' },
            last_menu: [
                { id: 'menu-1', name: 'Pierogi ruskie', base_name: 'Pierogi ruskie', type: 'MAIN', price_pln: 18 },
                { id: 'menu-2', name: 'Pierogi z miesem', base_name: 'Pierogi z miesem', type: 'MAIN', price_pln: 20 },
            ],
        });

        const response = await handler.execute({
            text: 'pierogi z miesem',
            entities: { dish: 'pierogi z miesem', quantity: 1 },
            session,
        });

        expect(response.contextUpdates?.lastIntent).toBe('create_order');
        expect(response.meta?.focusedMenuItemId).toBe('menu-2');
        expect(response.meta?.addedToCart).toBe(false);
        expect(session.cart.items.length).toBe(0);
        expect(session.pendingOrder?.items?.[0]?.id).toBe('menu-2');
    });
});

// ────────────────────────────────────────────────────────────────────────────────
// I. Zmiana zdania po focused item
// ────────────────────────────────────────────────────────────────────────────────
describe('I — change mind after focused item', () => {
    let handler;

    beforeEach(() => {
        handler = new OrderHandler();
        resolveMenuItemConflictMock.mockClear();
        canonicalizeDishMock.mockReset();
    });

    it('I1: second dish overrides first — new focusedMenuItemId, no stale focus', async () => {
        const session = makeSession({
            currentRestaurant: { id: 'sk1', name: 'Stara Kamienica' },
            lastRestaurant: { id: 'sk1', name: 'Stara Kamienica' },
            last_menu: [
                { id: 'menu-1', name: 'Pierogi ruskie', base_name: 'Pierogi ruskie', type: 'MAIN', price_pln: 18 },
                { id: 'menu-2', name: 'Pizza Margherita', base_name: 'Pizza Margherita', type: 'MAIN', price_pln: 25 },
            ],
        });

        // Turn 1: add pierogi
        canonicalizeDishMock.mockReturnValue('pierogi ruskie');
        resolveMenuItemConflictMock.mockResolvedValue({
            status: 'ADD_ITEM',
            item: { id: 'menu-1', name: 'Pierogi ruskie', base_name: 'Pierogi ruskie', type: 'MAIN', price_pln: 18 },
            score: 1.4,
            source: 'scoped_restaurant',
        });

        const response1 = await handler.execute({
            text: 'pierogi ruskie',
            entities: { dish: 'pierogi ruskie', quantity: 1 },
            session,
        });

        expect(response1.meta?.focusedMenuItemId).toBe('menu-1');
        expect(session.cart.items.length).toBe(0);
        expect(session.pendingOrder?.items?.[0]?.id).toBe('menu-1');

        // Turn 2: change mind → pizza
        canonicalizeDishMock.mockReturnValue('pizza margherita');
        resolveMenuItemConflictMock.mockResolvedValue({
            status: 'ADD_ITEM',
            item: { id: 'menu-2', name: 'Pizza Margherita', base_name: 'Pizza Margherita', type: 'MAIN', price_pln: 25 },
            score: 1.4,
            source: 'scoped_restaurant',
        });

        const response2 = await handler.execute({
            text: 'pizza margherita',
            entities: { dish: 'pizza margherita', quantity: 1 },
            session,
        });

        // Second response must have NEW focusedMenuItemId, not the old one
        expect(response2.meta?.focusedMenuItemId).toBe('menu-2');
        expect(response2.meta?.focusedMenuItemId).not.toBe('menu-1');
        expect(session.cart.items.length).toBe(0);
        expect(session.pendingOrder?.items?.[0]?.id).toBe('menu-2');
    });
});

// ────────────────────────────────────────────────────────────────────────────────
// J. focusedMenuItemId contract — presence without side-effect
// ────────────────────────────────────────────────────────────────────────────────
describe('J — focusedMenuItemId contract shape', () => {
    let handler;

    beforeEach(() => {
        handler = new OrderHandler();
        resolveMenuItemConflictMock.mockClear();
        canonicalizeDishMock.mockReset();
    });

    it('J1: focusedMenuItemId is present in add-item response but does not mutate session', async () => {
        canonicalizeDishMock.mockReturnValue('rosol');

        resolveMenuItemConflictMock.mockResolvedValue({
            status: 'ADD_ITEM',
            item: { id: 'menu-rosol', name: 'Rosol domowy', base_name: 'Rosol domowy', type: 'MAIN', price_pln: 15 },
            score: 1.4,
            source: 'scoped_restaurant',
        });

        const session = makeSession({
            currentRestaurant: { id: 'dh1', name: 'Dwor Hubertus' },
            lastRestaurant: { id: 'dh1', name: 'Dwor Hubertus' },
            last_menu: [
                { id: 'menu-rosol', name: 'Rosol domowy', base_name: 'Rosol domowy', type: 'MAIN', price_pln: 15 },
            ],
        });

        const sessionMetaBefore = JSON.parse(JSON.stringify(session.meta || {}));

        const response = await handler.execute({
            text: 'rosol',
            entities: { dish: 'rosol', quantity: 1 },
            session,
        });

        // focusedMenuItemId is informational metadata — must not change session.meta
        expect(response.meta?.focusedMenuItemId).toBe('menu-rosol');
        // The meta in response is response-scoped, not session-scoped
        expect(response.meta).not.toBe(session.meta);
    });

    it('J2: focusedMenuItemId is absent when dish not found', async () => {
        canonicalizeDishMock.mockReturnValue('nieistniejace danie xyz');

        resolveMenuItemConflictMock.mockResolvedValue({
            status: 'ITEM_NOT_FOUND',
            score: null,
            source: 'scoped_restaurant',
        });

        const session = makeSession({
            currentRestaurant: { id: 'sk1', name: 'Stara Kamienica' },
            lastRestaurant: { id: 'sk1', name: 'Stara Kamienica' },
            last_menu: [
                { id: 'menu-1', name: 'Pierogi ruskie', base_name: 'Pierogi ruskie', type: 'MAIN', price_pln: 18 },
            ],
        });

        const response = await handler.execute({
            text: 'nieistniejace danie xyz',
            entities: { dish: 'nieistniejace danie xyz', quantity: 1 },
            session,
        });

        expect(response.intent).toBe('clarify_order');
        expect(response.meta?.focusedMenuItemId).toBeFalsy();
        expect(response.meta?.addedToCart).not.toBe(true);
        expect(session.cart.items.length).toBe(0);
    });
});
