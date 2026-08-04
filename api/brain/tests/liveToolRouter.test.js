import { describe, it, expect } from 'vitest';
import { ToolRouter } from '../../voice/live/ToolRouter.js';

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
            show_more_options: { execute: async () => ({ reply: 'Więcej opcji.' }) },
        },
        ordering: {
            create_order: {
                execute: async (ctx) => ({
                    reply: `Dodano ${ctx.entities?.dish || 'pozycję'}.`,
                    contextUpdates: {
                        cart: { items: [{ name: ctx.entities?.dish || 'x', qty: 1 }], total: 13 },
                        expectedContext: 'order_continue',
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

describe('Live ToolRouter', () => {
    it('returns unknown_tool for unsupported tool', async () => {
        const sessions = new Map();
        const getSession = (id) => sessions.get(id) || {};
        const updateSession = (id, patch) => {
            const prev = sessions.get(id) || {};
            const next = { ...prev, ...patch };
            sessions.set(id, next);
            return next;
        };

        const router = new ToolRouter({
            handlers: makeFakeHandlers(),
            getSession,
            updateSession,
        });

        const result = await router.executeToolCall({
            sessionId: 'sess_live_test_unknown',
            toolName: 'not_existing',
            args: {},
        });

        expect(result.ok).toBe(false);
        expect(result.error).toBe('unknown_tool');
    });

    it('missing sessionId returns missing_session_id error', async () => {
        const router = new ToolRouter({
            handlers: makeFakeHandlers(),
            getSession: () => ({}),
            updateSession: (_, p) => p,
        });

        const result = await router.executeToolCall({
            sessionId: '',
            toolName: 'add_item_to_cart',
            args: { dish: 'Pierogi', quantity: 1 },
        });

        expect(result.ok).toBe(false);
        expect(result.error).toBe('missing_session_id');
    });

    it('add_item_to_cart without currentRestaurant falls back to find_nearby (ICM state redirect)', async () => {
        // Session has no currentRestaurant → checkRequiredState for create_order fails
        // fallbackIntent = 'find_nearby' → router redirects to find_nearby handler
        const sessions = new Map([
            ['sess_icm_test', { conversationPhase: 'neutral' }],
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
            sessionId: 'sess_icm_test',
            toolName: 'add_item_to_cart',
            args: { dish: 'Pierogi', quantity: 1 },
            transcript: 'dodaj pierogi',
        });

        // Router falls back to find_nearby — still returns ok=true (it handled it)
        expect(result.ok).toBe(true);
        expect(result.response.intent).toBe('find_nearby');
        expect(result.trace.some(t => t.includes('icm_fallback_intent'))).toBe(true);
    });

    it('confirm_order without pendingOrder returns clarify response (IVL blocks before ICM)', async () => {
        // confirm_order requires pendingOrder + expectedContext=confirm_order.
        // IVL v2 blocks this at fsm_escalation (awaiting_confirmation state required)
        // OR at args-session check (no pendingOrder). Either way: clarify response.
        const sessions = new Map([
            // orderMode=awaiting_confirmation to pass FSM escalation,
            // but no pendingOrder — so IVL Rule 3b hard-rejects.
            ['sess_confirm_block', {
                conversationPhase: 'ordering',
                orderMode: 'awaiting_confirmation',
                pendingOrder: null,
                expectedContext: null,
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
            sessionId: 'sess_confirm_block',
            toolName: 'confirm_order',
            args: {},
        });

        // IVL blocks with confirm_order_state_missing before ICM runs.
        expect(result.ok).toBe(true);
        expect(result.response.meta?.intentVerification?.reason).toBe('confirm_order_state_missing');
        expect(result.trace.some(t => t.includes('ivl:args_mismatch:confirm_order'))).toBe(true);
        expect(result.trace.some(t => t.includes('ivl_blocked:confirm_order_state_missing'))).toBe(true);
    });

    it('get_cart_state returns cart snapshot without dispatching to handler', async () => {
        const sessions = new Map([
            ['sess_cart_state', {
                cart: { items: [{ name: 'Kebab', qty: 1 }], total: 18 },
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
            sessionId: 'sess_cart_state',
            toolName: 'get_cart_state',
            args: {},
        });

        expect(result.ok).toBe(true);
        expect(result.response.intent).toBe('get_cart_state');
        expect(result.response.cart.items).toHaveLength(1);
    });

    it('executes create_order tool and preserves contract', async () => {
        const sessions = new Map([
            ['sess_live_test_order', {
                conversationPhase: 'ordering',
                currentRestaurant: { id: 'r1', name: 'Rest 1' },
                orderMode: 'restaurant_selected',
            }],
        ]);

        const getSession = (id) => sessions.get(id) || {};
        const updateSession = (id, patch) => {
            const prev = sessions.get(id) || {};
            const next = { ...prev, ...patch };
            sessions.set(id, next);
            return next;
        };

        const router = new ToolRouter({
            handlers: makeFakeHandlers(),
            getSession,
            updateSession,
        });

        const result = await router.executeToolCall({
            sessionId: 'sess_live_test_order',
            toolName: 'add_item_to_cart',
            args: { dish: 'Pierogi', quantity: 2 },
            requestId: 'req-1',
            transcript: 'dodaj dwa pierogi',
        });

        expect(result.ok).toBe(true);
        expect(result.response.ok).toBe(true);
        expect(result.response.intent).toBe('create_order');
        expect(result.response.reply).toContain('Dodano');
        expect(result.response.meta.liveTool.toolName).toBe('add_item_to_cart');
        expect(Array.isArray(result.response.actions)).toBe(true);
        expect(Array.isArray(result.trace)).toBe(true);
    });

    it('commits a grounded Live draft to the reversible cart without a second voice confirmation', async () => {
        const sessionId = 'sess_pending_cart_confirmation';
        const restaurantId = '4ad6b301-671b-4343-bf91-9bab7cda37b4';
        const sessions = new Map([[
            sessionId,
            {
                conversationPhase: 'ordering',
                currentRestaurant: { id: restaurantId, name: 'Śląski Szynk' },
                cart: { items: [], total: 0 },
                orderMode: 'restaurant_selected',
            },
        ]]);
        const handlers = makeFakeHandlers();
        handlers.ordering.create_order.execute = async () => ({
            intent: 'create_order',
            reply: 'Przygotowałam 2 Tagliatelle. Potwierdzasz dodanie do koszyka?',
            meta: {
                source: 'order_handler_pending',
                addedToCart: false,
            },
            contextUpdates: {
                pendingOrder: {
                    restaurant_id: restaurantId,
                    items: [{ id: 'tagliatelle', name: 'Tagliatelle', quantity: 2 }],
                    total: '114.00',
                },
                expectedContext: 'confirm_add_to_cart',
            },
        });
        handlers.ordering.confirm_add_to_cart.execute = async ({ session }) => {
            const pendingOrder = session.pendingOrder;
            const cart = {
                items: pendingOrder.items.map((item) => ({
                    ...item,
                    restaurant_id: pendingOrder.restaurant_id,
                })),
                total: Number(pendingOrder.total),
            };
            session.cart = cart;
            session.pendingOrder = null;
            session.expectedContext = null;
            return {
                intent: 'confirm_add_to_cart',
                reply: 'Dodano 2 × Tagliatelle do koszyka.',
                contextUpdates: {
                    cart,
                    pendingOrder: null,
                    expectedContext: null,
                },
                meta: {
                    source: 'confirm_add_to_cart_handler',
                    cart,
                },
            };
        };
        const getSession = (id) => sessions.get(id) || {};
        const updateSession = (id, patch) => {
            const next = { ...(sessions.get(id) || {}), ...patch };
            sessions.set(id, next);
            return next;
        };
        const router = new ToolRouter({ handlers, getSession, updateSession });

        const result = await router.executeToolCall({
            sessionId,
            toolName: 'add_item_to_cart',
            args: { dish: 'Tagliatelle', quantity: 2, restaurant_id: restaurantId },
            transcript: 'Due razzi taglienti scivolati via.',
        });

        expect(result.ok).toBe(true);
        expect(result.response.ok).toBe(true);
        expect(result.response.reply).toContain('Dodano');
        expect(result.response.meta?.liveTool).toMatchObject({
            cartChanged: true,
            autoCommittedCartDraft: true,
            pendingConfirmationPrepared: false,
            successDowngraded: false,
            clarifyNotAdded: false,
        });
        expect(sessions.get(sessionId)?.pendingOrder).toBeNull();
        expect(sessions.get(sessionId)?.cart?.items).toHaveLength(1);
        expect(sessions.get(sessionId)?.cart?.items?.[0]).toMatchObject({
            id: 'tagliatelle',
            quantity: 2,
        });
    });

    it('does not confirm a pending cart draft from unrelated transcript text', async () => {
        const sessionId = 'sess_confirm_transcript_guard';
        const sessions = new Map([[
            sessionId,
            {
                conversationPhase: 'ordering',
                currentRestaurant: { id: 'r1', name: 'Rest 1' },
                cart: { items: [], total: 0 },
                pendingOrder: {
                    restaurant_id: 'r1',
                    items: [{ id: 'tagliatelle', name: 'Tagliatelle', quantity: 2 }],
                    total: '114.00',
                },
                expectedContext: 'confirm_add_to_cart',
                orderMode: 'building',
            },
        ]]);
        let confirmHandlerCalled = false;
        const handlers = makeFakeHandlers();
        handlers.ordering.confirm_add_to_cart.execute = async () => {
            confirmHandlerCalled = true;
            return {
                reply: 'Nie powinno się wykonać.',
                contextUpdates: {
                    cart: { items: [{ id: 'tagliatelle', quantity: 2 }], total: 114 },
                    pendingOrder: null,
                },
            };
        };
        const getSession = (id) => sessions.get(id) || {};
        const updateSession = (id, patch) => {
            const next = { ...(sessions.get(id) || {}), ...patch };
            sessions.set(id, next);
            return next;
        };
        const router = new ToolRouter({ handlers, getSession, updateSession });

        const result = await router.executeToolCall({
            sessionId,
            toolName: 'confirm_add_to_cart',
            args: {},
            transcript: 'Pour faire un point de vue, il ne perd pas de cyclisme.',
        });

        expect(result.ok).toBe(true);
        expect(result.response.intent).toBe('clarify_order');
        expect(result.response.meta?.cartMutationIntentGuard).toMatchObject({
            blocked: true,
            reason: 'cart_mutation_without_explicit_action',
        });
        expect(confirmHandlerCalled).toBe(false);
        expect(sessions.get(sessionId)?.cart?.items).toHaveLength(0);
        expect(sessions.get(sessionId)?.pendingOrder?.items).toHaveLength(1);
    });

    it.each([
        ['Kołocz to je tako drożdżówka?', 'cart_mutation_informational_question'],
        ['Beijo, tá chegando.', 'cart_mutation_without_explicit_action'],
    ])('does not mutate cart when add_item_to_cart lacks purchase evidence: %s', async (transcript, reason) => {
        const sessionId = `sess_cart_intent_guard_${reason}`;
        const sessions = new Map([
            [sessionId, {
                conversationPhase: 'ordering',
                currentRestaurant: { id: 'r1', name: 'Śląski Szynk' },
                lastMenu: [{ id: 'm1', name: 'Kołocz śląski z makiem', price_pln: 17 }],
                cart: { items: [], total: 0 },
                orderMode: 'restaurant_selected',
            }],
        ]);
        let orderHandlerCalled = false;
        const handlers = makeFakeHandlers();
        handlers.ordering.create_order.execute = async () => {
            orderHandlerCalled = true;
            return {
                reply: 'Nie powinno się wykonać.',
                contextUpdates: { cart: { items: [{ name: 'Kołocz', qty: 1 }], total: 17 } },
            };
        };
        const getSession = (id) => sessions.get(id) || {};
        const updateSession = (id, patch) => {
            const next = { ...(sessions.get(id) || {}), ...patch };
            sessions.set(id, next);
            return next;
        };
        const router = new ToolRouter({ handlers, getSession, updateSession });

        const result = await router.executeToolCall({
            sessionId,
            toolName: 'add_item_to_cart',
            args: { dish: 'Kołocz śląski z makiem', quantity: 1 },
            requestId: `req-${reason}`,
            transcript,
        });

        expect(result.ok).toBe(true);
        expect(result.response.intent).toBe('clarify_order');
        expect(result.response.meta?.cartMutationIntentGuard).toMatchObject({
            blocked: true,
            reason,
        });
        expect(orderHandlerCalled).toBe(false);
        expect(sessions.get(sessionId)?.cart?.items).toHaveLength(0);
    });

    it('for clarify_order from add_item tool, marks not-added and uses explicit no-add reply', async () => {
        const sessions = new Map([
            ['sess_live_test_clarify', {
                conversationPhase: 'ordering',
                currentRestaurant: { id: 'r1', name: 'Rest 1' },
                cart: { items: [], total: 0 },
                orderMode: 'restaurant_selected',
            }],
        ]);

        const getSession = (id) => sessions.get(id) || {};
        const updateSession = (id, patch) => {
            const prev = sessions.get(id) || {};
            const next = { ...prev, ...patch };
            sessions.set(id, next);
            return next;
        };

        const handlers = makeFakeHandlers();
        handlers.ordering.create_order = {
            execute: async () => ({
                intent: 'clarify_order',
                reply: 'Podaj pelna nazwe z listy.',
                contextUpdates: { expectedContext: 'clarify_order' },
                meta: { clarify: { expectedContext: 'clarify_order' } },
            }),
        };

        const router = new ToolRouter({
            handlers,
            getSession,
            updateSession,
        });

        const result = await router.executeToolCall({
            sessionId: 'sess_live_test_clarify',
            toolName: 'add_item_to_cart',
            args: { dish: 'Pierogi', quantity: 1 },
            requestId: 'req-clarify-1',
            transcript: 'dodaj pierogi',
        });

        expect(result.ok).toBe(false);
        expect(result.response.intent).toBe('clarify_order');
        expect(String(result.response.reply)).toMatch(/Jeszcze nie dodalam/i);
        expect(result.response.meta?.liveTool?.clarifyNotAdded).toBe(true);
        expect(result.response.meta?.liveTool?.cartChanged).toBe(false);
        expect(result.trace.some((entry) => entry.includes('cart_guard:clarify_not_added'))).toBe(true);
    });

    it('search_menu_items emits focusedMenuItemId for the first concrete match from session menuItems', async () => {
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
        expect(result.response.menu).toHaveLength(2);
        expect(result.response.meta?.menuPresentationMode).toBe('discovery');
        expect(result.response.meta?.focusedMenuItemId).toBe('menu-1');
    });

    it('search_menu_items finds drinks by menu category, not only by item name', async () => {
        const sessions = new Map([
            ['sess_search_drinks', {
                menuItems: [
                    { id: 'menu-food', name: 'Pierogi ruskie', category: 'Pierogi', price: 18 },
                    { id: 'menu-drink', name: 'Coca-Cola 0,5 l', category: 'Napoje', price: 9 },
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
            sessionId: 'sess_search_drinks',
            toolName: 'search_menu_items',
            args: { query: 'coś do picia' },
            requestId: 'req-search-drinks',
        });

        expect(result.ok).toBe(true);
        expect(result.response.menuItems.map((item) => item.id)).toContain('menu-drink');
        expect(result.response.menuItems.map((item) => item.id)).not.toContain('menu-food');
    });

    it('search_menu_items uses the cart restaurant even when currentRestaurant points elsewhere', async () => {
        const sessions = new Map([
            ['sess_cart_scoped_drink', {
                currentRestaurant: { id: 'callzone', name: 'Callzone' },
                cart: {
                    restaurantId: 'vien',
                    items: [{ id: 'beef', name: 'Wołowina na ostro', restaurant_id: 'vien', restaurant_name: 'Vien-Thien' }],
                    total: 39,
                },
                last_menu_restaurant_id: 'vien',
                last_menu: [
                    { id: 'vien-beef', name: 'Wołowina na ostro', category: 'Dania główne', price: 39 },
                    { id: 'vien-water', name: 'Woda mineralna', category: 'Napoje', price: 7 },
                ],
            }],
        ]);
        const getSession = (id) => sessions.get(id) || {};
        const updateSession = (id, patch) => {
            const next = { ...(sessions.get(id) || {}), ...patch };
            sessions.set(id, next);
            return next;
        };
        const router = new ToolRouter({ handlers: makeFakeHandlers(), getSession, updateSession });

        const result = await router.executeToolCall({
            sessionId: 'sess_cart_scoped_drink',
            toolName: 'search_menu_items',
            args: { query: 'coś do picia' },
        });

        expect(result.response.menuItems.map((item) => item.id)).toEqual(['vien-water']);
        expect(result.response.meta?.restaurantId).toBe('vien');
        expect(result.response.meta?.restaurantName).toBe('Vien-Thien');
        expect(result.response.meta?.cartScoped).toBe(true);
    });

    it('reroutes drink discovery to the menu of the restaurant locked by the cart', async () => {
        const sessions = new Map([
            ['sess_cart_drink_discovery', {
                cart: {
                    restaurantId: 'vien',
                    items: [{ id: 'beef', name: 'Wołowina na ostro', restaurant_id: 'vien', restaurant_name: 'Vien-Thien' }],
                    total: 39,
                },
                last_menu_restaurant_id: 'vien',
                last_menu: [
                    { id: 'vien-tea', name: 'Herbata jaśminowa', category: 'Napoje', price: 9 },
                ],
            }],
        ]);
        const getSession = (id) => sessions.get(id) || {};
        const updateSession = (id, patch) => {
            const next = { ...(sessions.get(id) || {}), ...patch };
            sessions.set(id, next);
            return next;
        };
        const router = new ToolRouter({ handlers: makeFakeHandlers(), getSession, updateSession });

        const result = await router.executeToolCall({
            sessionId: 'sess_cart_drink_discovery',
            toolName: 'find_nearby',
            args: { query: 'napój do obiadu' },
        });

        expect(result.response.intent).toBe('search_menu_items');
        expect(result.response.menuItems.map((item) => item.id)).toEqual(['vien-tea']);
        expect(result.response.meta?.cartScoped).toBe(true);
    });

    it('ignores live transcript for find_nearby text when args are empty', async () => {
        const sessions = new Map([
            ['sess_live_transcript', { conversationPhase: 'neutral', orderMode: 'neutral' }],
        ]);

        const getSession = (id) => sessions.get(id) || {};
        const updateSession = (id, patch) => {
            const prev = sessions.get(id) || {};
            const next = { ...prev, ...patch };
            sessions.set(id, next);
            return next;
        };

        let capturedText = null;
        let capturedEntities = null;
        const handlers = makeFakeHandlers();
        handlers.food.find_nearby = {
            execute: async (ctx) => {
                capturedText = ctx.text;
                capturedEntities = ctx.entities;
                return {
                    reply: 'OK',
                    restaurants: [{ id: 'r1', name: 'Rest 1' }],
                    contextUpdates: { expectedContext: 'select_restaurant' },
                };
            },
        };

        const router = new ToolRouter({
            handlers,
            getSession,
            updateSession,
        });

        const result = await router.executeToolCall({
            sessionId: 'sess_live_transcript',
            toolName: 'find_nearby',
            args: {},
            transcript: 'szukam rollo w piekarach',
        });

        expect(result.ok).toBe(true);
        expect(capturedText).toBe('gdzie zamowic');
        expect(capturedEntities?.location).toBeNull();
        expect(result.trace.some((entry) => entry.includes('live_transcript_hint:ignored_for_find_nearby'))).toBe(true);
    });

    it('passes an explicit dish query to find_nearby as grounded handler input', async () => {
        const sessions = new Map([
            ['sess_live_dish_query', { conversationPhase: 'neutral', orderMode: 'neutral' }],
        ]);
        const getSession = (id) => sessions.get(id) || {};
        const updateSession = (id, patch) => {
            const next = { ...(sessions.get(id) || {}), ...patch };
            sessions.set(id, next);
            return next;
        };

        let capturedText = null;
        let capturedEntities = null;
        const handlers = makeFakeHandlers();
        handlers.food.find_nearby = {
            execute: async (ctx) => {
                capturedText = ctx.text;
                capturedEntities = ctx.entities;
                return {
                    reply: 'Znalazłam wołowinę.',
                    restaurants: [{ id: 'vien-thien', name: 'Vien-Thien' }],
                    contextUpdates: { expectedContext: 'select_restaurant' },
                };
            },
        };

        const router = new ToolRouter({ handlers, getSession, updateSession });
        const result = await router.executeToolCall({
            sessionId: 'sess_live_dish_query',
            toolName: 'find_nearby',
            args: { query: 'wołowina na ostro' },
            transcript: 'wymyślona treść nie może zastąpić argumentów narzędzia',
        });

        expect(result.ok).toBe(true);
        expect(capturedText).toContain('wołowina na ostro');
        expect(capturedEntities?.dish).toBe('wołowina na ostro');
    });

    it('promotes find_nearby to select_restaurant when transcript contains explicit restaurant name', async () => {
        const sessions = new Map([
            ['sess_live_promote', { conversationPhase: 'neutral', orderMode: 'neutral' }],
        ]);

        const getSession = (id) => sessions.get(id) || {};
        const updateSession = (id, patch) => {
            const prev = sessions.get(id) || {};
            const next = { ...prev, ...patch };
            sessions.set(id, next);
            return next;
        };

        const router = new ToolRouter({
            handlers: makeFakeHandlers(),
            getSession,
            updateSession,
        });

        const result = await router.executeToolCall({
            sessionId: 'sess_live_promote',
            toolName: 'find_nearby',
            args: {},
            transcript: 'Bar Praha',
        });

        expect(result.ok).toBe(true);
        expect(result.response.intent).toBe('select_restaurant');
        expect(result.trace.some((entry) => entry.includes('live_find_promoted:select_restaurant'))).toBe(true);
    });

    it('promotes find_nearby when location arg is actually a restaurant alias', async () => {
        const sessions = new Map([
            ['sess_live_location_alias', { conversationPhase: 'neutral', orderMode: 'neutral' }],
        ]);

        const getSession = (id) => sessions.get(id) || {};
        const updateSession = (id, patch) => {
            const prev = sessions.get(id) || {};
            const next = { ...prev, ...patch };
            sessions.set(id, next);
            return next;
        };

        const router = new ToolRouter({
            handlers: makeFakeHandlers(),
            getSession,
            updateSession,
        });

        const result = await router.executeToolCall({
            sessionId: 'sess_live_location_alias',
            toolName: 'find_nearby',
            args: { location: 'Bar Praha' },
            transcript: 'pokaz menu bar praha',
        });

        expect(result.ok).toBe(true);
        expect(result.response.intent).toBe('select_restaurant');
        expect(result.trace.some((entry) => entry.includes('live_find_location_rejected:restaurant_alias'))).toBe(true);
    });

    it('promotes find_nearby to select_restaurant even when GPS args are present', async () => {
        const sessions = new Map([
            ['sess_live_promote_gps', { conversationPhase: 'neutral', orderMode: 'neutral' }],
        ]);

        const getSession = (id) => sessions.get(id) || {};
        const updateSession = (id, patch) => {
            const prev = sessions.get(id) || {};
            const next = { ...prev, ...patch };
            sessions.set(id, next);
            return next;
        };

        const router = new ToolRouter({
            handlers: makeFakeHandlers(),
            getSession,
            updateSession,
        });

        const result = await router.executeToolCall({
            sessionId: 'sess_live_promote_gps',
            toolName: 'find_nearby',
            args: { location: 'Piekary Slaskie', lat: 50.39, lng: 18.95 },
            transcript: 'chce zamowic w lawasz kebab w piekarach slaskich',
        });

        expect(result.ok).toBe(true);
        expect(result.response.intent).toBe('select_restaurant');
        expect(result.trace.some((entry) => entry.includes('live_find_promoted:select_restaurant'))).toBe(true);
    });

    it('sanitizes address-like location in live find_nearby and uses session city fallback', async () => {
        const sessions = new Map([
            ['sess_live_location_address', {
                conversationPhase: 'neutral',
                orderMode: 'neutral',
                last_location: 'Piekary Slaskie',
            }],
        ]);

        const getSession = (id) => sessions.get(id) || {};
        const updateSession = (id, patch) => {
            const prev = sessions.get(id) || {};
            const next = { ...prev, ...patch };
            sessions.set(id, next);
            return next;
        };

        let capturedText = null;
        let capturedEntities = null;
        const handlers = makeFakeHandlers();
        handlers.food.find_nearby = {
            execute: async (ctx) => {
                capturedText = ctx.text;
                capturedEntities = ctx.entities;
                return {
                    reply: 'OK',
                    restaurants: [{ id: 'r1', name: 'Rest 1' }],
                    contextUpdates: { expectedContext: 'select_restaurant' },
                };
            },
        };

        const router = new ToolRouter({
            handlers,
            getSession,
            updateSession,
        });

        const result = await router.executeToolCall({
            sessionId: 'sess_live_location_address',
            toolName: 'find_nearby',
            args: { location: 'Pilsudskiego 1', cuisine: 'Polish' },
        });

        expect(result.ok).toBe(true);
        expect(capturedEntities?.location).toBe('Piekary Slaskie');
        expect(capturedText).toContain('Piekary Slaskie');
        expect(capturedText).toContain('Polish');
        expect(result.trace.some((entry) => entry.includes('live_find_location_sanitized:Piekary Slaskie'))).toBe(true);
    });

    it('drops placeholder location "current location" in live find_nearby to allow GPS path', async () => {
        const sessions = new Map([
            ['sess_live_location_placeholder', {
                conversationPhase: 'neutral',
                orderMode: 'neutral',
                last_location: 'Piekary Slaskie',
            }],
        ]);

        const getSession = (id) => sessions.get(id) || {};
        const updateSession = (id, patch) => {
            const prev = sessions.get(id) || {};
            const next = { ...prev, ...patch };
            sessions.set(id, next);
            return next;
        };

        let capturedText = null;
        let capturedEntities = null;
        const handlers = makeFakeHandlers();
        handlers.food.find_nearby = {
            execute: async (ctx) => {
                capturedText = ctx.text;
                capturedEntities = ctx.entities;
                return {
                    reply: 'OK',
                    restaurants: [{ id: 'r1', name: 'Rest 1' }],
                    contextUpdates: { expectedContext: 'select_restaurant' },
                };
            },
        };

        const router = new ToolRouter({
            handlers,
            getSession,
            updateSession,
        });

        const result = await router.executeToolCall({
            sessionId: 'sess_live_location_placeholder',
            toolName: 'find_nearby',
            args: { location: 'current location', cuisine: 'Polish', lat: 50.39, lng: 18.95 },
            transcript: 'Polish food near my location',
        });

        expect(result.ok).toBe(true);
        expect(capturedEntities?.location).toBeNull();
        expect(capturedText).toContain('Polish');
        expect(capturedText).not.toContain('current location');
        expect(
            result.trace.some((entry) =>
                entry.includes('live_find_location_sanitized:null')
                || entry.includes('live_find_location_dropped_for_gps')
            )
        ).toBe(true);
    });

    it('drops location in find_nearby when GPS exists and transcript has nearby cue', async () => {
        const sessions = new Map([
            ['sess_live_gps_nearby', {
                conversationPhase: 'neutral',
                orderMode: 'neutral',
            }],
        ]);

        const getSession = (id) => sessions.get(id) || {};
        const updateSession = (id, patch) => {
            const prev = sessions.get(id) || {};
            const next = { ...prev, ...patch };
            sessions.set(id, next);
            return next;
        };

        let capturedText = null;
        let capturedEntities = null;
        const handlers = makeFakeHandlers();
        handlers.food.find_nearby = {
            execute: async (ctx) => {
                capturedText = ctx.text;
                capturedEntities = ctx.entities;
                return {
                    reply: 'OK',
                    restaurants: [{ id: 'r1', name: 'Rest 1' }],
                    contextUpdates: { expectedContext: 'select_restaurant' },
                };
            },
        };

        const router = new ToolRouter({
            handlers,
            getSession,
            updateSession,
        });

        const result = await router.executeToolCall({
            sessionId: 'sess_live_gps_nearby',
            toolName: 'find_nearby',
            args: { location: 'Piekary Slaskie', cuisine: 'Polish', lat: 50.39, lng: 18.95 },
            transcript: 'co jest blisko mnie',
        });

        expect(result.ok).toBe(true);
        expect(capturedEntities?.location).toBeNull();
        expect(capturedEntities?.cuisine).toBeNull();
        expect(capturedText).toBe('gdzie zamowic');
        expect(result.trace.some((entry) => entry.includes('live_find_location_dropped_for_gps'))).toBe(true);
        expect(result.trace.some((entry) => entry.includes('live_find_cuisine_hallucinated_dropped_for_gps'))).toBe(true);
    });

    it('keeps dessert cuisine when Polish transcript asks for dessert near GPS', async () => {
        const sessions = new Map([
            ['sess_live_gps_dessert', {
                conversationPhase: 'neutral',
                orderMode: 'neutral',
            }],
        ]);

        const getSession = (id) => sessions.get(id) || {};
        const updateSession = (id, patch) => {
            const prev = sessions.get(id) || {};
            const next = { ...prev, ...patch };
            sessions.set(id, next);
            return next;
        };

        let capturedText = null;
        let capturedEntities = null;
        const handlers = makeFakeHandlers();
        handlers.food.find_nearby = {
            execute: async (ctx) => {
                capturedText = ctx.text;
                capturedEntities = ctx.entities;
                return {
                    reply: 'OK',
                    restaurants: [{ id: 'r1', name: 'Rest 1' }],
                    contextUpdates: { expectedContext: 'select_restaurant' },
                };
            },
        };

        const router = new ToolRouter({
            handlers,
            getSession,
            updateSession,
        });

        const result = await router.executeToolCall({
            sessionId: 'sess_live_gps_dessert',
            toolName: 'find_nearby',
            args: { cuisine: 'dessert', lat: 50.39, lng: 18.95 },
            transcript: 'jest moze jakis deser tutaj gdzies w okolicy',
        });

        expect(result.ok).toBe(true);
        expect(capturedEntities?.cuisine).toBe('dessert');
        expect(capturedText).toBe('szukam dessert');
        expect(result.trace.some((entry) => entry.includes('live_find_cuisine_hallucinated_dropped_for_gps'))).toBe(false);
    });

    it('keeps ice cream cuisine when Polish transcript asks for lody near GPS', async () => {
        const sessions = new Map([
            ['sess_live_gps_ice_cream', {
                conversationPhase: 'neutral',
                orderMode: 'neutral',
            }],
        ]);

        const getSession = (id) => sessions.get(id) || {};
        const updateSession = (id, patch) => {
            const prev = sessions.get(id) || {};
            const next = { ...prev, ...patch };
            sessions.set(id, next);
            return next;
        };

        let capturedText = null;
        let capturedEntities = null;
        const handlers = makeFakeHandlers();
        handlers.food.find_nearby = {
            execute: async (ctx) => {
                capturedText = ctx.text;
                capturedEntities = ctx.entities;
                return {
                    reply: 'OK',
                    restaurants: [{ id: 'r1', name: 'Rest 1' }],
                    contextUpdates: { expectedContext: 'select_restaurant' },
                };
            },
        };

        const router = new ToolRouter({
            handlers,
            getSession,
            updateSession,
        });

        const result = await router.executeToolCall({
            sessionId: 'sess_live_gps_ice_cream',
            toolName: 'find_nearby',
            args: { cuisine: 'ice cream', lat: 50.39, lng: 18.95 },
            transcript: 'szukam lodow w piekarach',
        });

        expect(result.ok).toBe(true);
        expect(capturedEntities?.cuisine).toBe('ice cream');
        expect(capturedText).toBe('szukam ice cream');
        expect(result.trace.some((entry) => entry.includes('live_find_cuisine_hallucinated_dropped_for_gps'))).toBe(false);
    });

    it('keeps menu-led ice cream cuisine when live transcript is garbled near GPS', async () => {
        const sessions = new Map([
            ['sess_live_gps_ice_cream_garbled', {
                conversationPhase: 'neutral',
                orderMode: 'neutral',
            }],
        ]);

        const getSession = (id) => sessions.get(id) || {};
        const updateSession = (id, patch) => {
            const prev = sessions.get(id) || {};
            const next = { ...prev, ...patch };
            sessions.set(id, next);
            return next;
        };

        let capturedText = null;
        let capturedEntities = null;
        const handlers = makeFakeHandlers();
        handlers.food.find_nearby = {
            execute: async (ctx) => {
                capturedText = ctx.text;
                capturedEntities = ctx.entities;
                return {
                    reply: 'OK',
                    restaurants: [{ id: 'r1', name: 'Rest 1' }],
                    contextUpdates: { expectedContext: 'select_restaurant' },
                };
            },
        };

        const router = new ToolRouter({
            handlers,
            getSession,
            updateSession,
        });

        const result = await router.executeToolCall({
            sessionId: 'sess_live_gps_ice_cream_garbled',
            toolName: 'find_nearby',
            args: { location: 'Piekary Slaskie', cuisine: 'ice cream', lat: 50.39, lng: 18.95 },
            transcript: 'bitte',
        });

        expect(result.ok).toBe(true);
        expect(capturedEntities?.location).toBeNull();
        expect(capturedEntities?.cuisine).toBe('ice cream');
        expect(capturedText).toBe('szukam ice cream');
        expect(result.trace.some((entry) => entry.includes('live_find_cuisine_menu_led_preserved_for_gps'))).toBe(true);
        expect(result.trace.some((entry) => entry.includes('live_find_cuisine_hallucinated_dropped_for_gps'))).toBe(false);
    });

    it('recovers ice cream cuisine when Piekary is falsely mapped to bakery near GPS', async () => {
        const sessions = new Map([
            ['sess_live_gps_piekary_bakery_recover', {
                conversationPhase: 'neutral',
                orderMode: 'neutral',
            }],
        ]);

        const getSession = (id) => sessions.get(id) || {};
        const updateSession = (id, patch) => {
            const prev = sessions.get(id) || {};
            const next = { ...prev, ...patch };
            sessions.set(id, next);
            return next;
        };

        let capturedText = null;
        let capturedEntities = null;
        const handlers = makeFakeHandlers();
        handlers.food.find_nearby = {
            execute: async (ctx) => {
                capturedText = ctx.text;
                capturedEntities = ctx.entities;
                return {
                    reply: 'OK',
                    restaurants: [{ id: 'r1', name: 'Rest 1' }],
                    contextUpdates: { expectedContext: 'select_restaurant' },
                };
            },
        };

        const router = new ToolRouter({
            handlers,
            getSession,
            updateSession,
        });

        const result = await router.executeToolCall({
            sessionId: 'sess_live_gps_piekary_bakery_recover',
            toolName: 'find_nearby',
            args: { location: 'Piekary Slaskie', cuisine: 'bakery', lat: 50.39, lng: 18.95 },
            transcript: 'szukam lodow w piekarach slaskich',
        });

        expect(result.ok).toBe(true);
        expect(capturedEntities?.cuisine).toBe('ice cream');
        expect(capturedText).toBe('szukam ice cream');
        expect(result.trace.some((entry) => entry.includes('live_find_cuisine_false_positive_recovered:ice cream'))).toBe(true);
    });

    it('drops bakery cuisine when Piekary is falsely mapped to bakery without dessert recovery', async () => {
        const sessions = new Map([
            ['sess_live_gps_piekary_bakery_drop', {
                conversationPhase: 'neutral',
                orderMode: 'neutral',
            }],
        ]);

        const getSession = (id) => sessions.get(id) || {};
        const updateSession = (id, patch) => {
            const prev = sessions.get(id) || {};
            const next = { ...prev, ...patch };
            sessions.set(id, next);
            return next;
        };

        let capturedText = null;
        let capturedEntities = null;
        const handlers = makeFakeHandlers();
        handlers.food.find_nearby = {
            execute: async (ctx) => {
                capturedText = ctx.text;
                capturedEntities = ctx.entities;
                return {
                    reply: 'OK',
                    restaurants: [{ id: 'r1', name: 'Rest 1' }],
                    contextUpdates: { expectedContext: 'select_restaurant' },
                };
            },
        };

        const router = new ToolRouter({
            handlers,
            getSession,
            updateSession,
        });

        const result = await router.executeToolCall({
            sessionId: 'sess_live_gps_piekary_bakery_drop',
            toolName: 'find_nearby',
            args: { location: 'Piekary Slaskie', cuisine: 'bakery', lat: 50.39, lng: 18.95 },
            transcript: 'szukam schabowego w piekarach slaskich',
        });

        expect(result.ok).toBe(true);
        expect(capturedEntities?.cuisine).toBeNull();
        expect(capturedText).toBe('gdzie zamowic');
        expect(result.trace.some((entry) => entry.includes('live_find_cuisine_false_positive_piekary_dropped'))).toBe(true);
    });

    it('keeps menu-led dessert cuisine when live transcript is missing near GPS', async () => {
        const sessions = new Map([
            ['sess_live_gps_dessert_missing_transcript', {
                conversationPhase: 'neutral',
                orderMode: 'neutral',
            }],
        ]);

        const getSession = (id) => sessions.get(id) || {};
        const updateSession = (id, patch) => {
            const prev = sessions.get(id) || {};
            const next = { ...prev, ...patch };
            sessions.set(id, next);
            return next;
        };

        let capturedText = null;
        let capturedEntities = null;
        const handlers = makeFakeHandlers();
        handlers.food.find_nearby = {
            execute: async (ctx) => {
                capturedText = ctx.text;
                capturedEntities = ctx.entities;
                return {
                    reply: 'OK',
                    restaurants: [{ id: 'r1', name: 'Rest 1' }],
                    contextUpdates: { expectedContext: 'select_restaurant' },
                };
            },
        };

        const router = new ToolRouter({
            handlers,
            getSession,
            updateSession,
        });

        const result = await router.executeToolCall({
            sessionId: 'sess_live_gps_dessert_missing_transcript',
            toolName: 'find_nearby',
            args: { location: 'Piekary Slaskie', cuisine: 'dessert', lat: 50.39, lng: 18.95 },
        });

        expect(result.ok).toBe(true);
        expect(capturedEntities?.location).toBe('Piekary Slaskie');
        expect(capturedEntities?.cuisine).toBe('dessert');
        expect(capturedText).toBe('szukam dessert w Piekary Slaskie');
        expect(result.trace.some((entry) => entry.includes('live_find_cuisine_menu_led_preserved_for_gps'))).toBe(true);
        expect(result.trace.some((entry) => entry.includes('live_find_cuisine_hallucinated_dropped_for_gps'))).toBe(false);
    });

    it('keeps drink cuisine when Polish transcript asks for a cola near GPS', async () => {
        const sessions = new Map([
            ['sess_live_gps_drinks', {
                conversationPhase: 'neutral',
                orderMode: 'neutral',
            }],
        ]);

        const getSession = (id) => sessions.get(id) || {};
        const updateSession = (id, patch) => {
            const prev = sessions.get(id) || {};
            const next = { ...prev, ...patch };
            sessions.set(id, next);
            return next;
        };

        let capturedText = null;
        let capturedEntities = null;
        const handlers = makeFakeHandlers();
        handlers.food.find_nearby = {
            execute: async (ctx) => {
                capturedText = ctx.text;
                capturedEntities = ctx.entities;
                return {
                    reply: 'OK',
                    restaurants: [{ id: 'r1', name: 'Rest 1' }],
                    contextUpdates: { expectedContext: 'select_restaurant' },
                };
            },
        };

        const router = new ToolRouter({
            handlers,
            getSession,
            updateSession,
        });

        const result = await router.executeToolCall({
            sessionId: 'sess_live_gps_drinks',
            toolName: 'find_nearby',
            args: { cuisine: 'drinks', lat: 50.39, lng: 18.95 },
            transcript: 'czy mozna zamowic cos do picia albo cole',
        });

        expect(result.ok).toBe(true);
        expect(capturedEntities?.cuisine).toBe('drinks');
        expect(capturedText).toBe('szukam drinks');
        expect(result.trace.some((entry) => entry.includes('live_find_cuisine_hallucinated_dropped_for_gps'))).toBe(false);
    });

    it('drops hallucinated location in find_nearby when GPS exists and transcript does not mention city', async () => {
        const sessions = new Map([
            ['sess_live_gps_hallucinated_location', {
                conversationPhase: 'neutral',
                orderMode: 'neutral',
            }],
        ]);

        const getSession = (id) => sessions.get(id) || {};
        const updateSession = (id, patch) => {
            const prev = sessions.get(id) || {};
            const next = { ...prev, ...patch };
            sessions.set(id, next);
            return next;
        };

        let capturedText = null;
        let capturedEntities = null;
        const handlers = makeFakeHandlers();
        handlers.food.find_nearby = {
            execute: async (ctx) => {
                capturedText = ctx.text;
                capturedEntities = ctx.entities;
                return {
                    reply: 'OK',
                    restaurants: [{ id: 'r1', name: 'Rest 1' }],
                    contextUpdates: { expectedContext: 'select_restaurant' },
                };
            },
        };

        const router = new ToolRouter({
            handlers,
            getSession,
            updateSession,
        });

        const result = await router.executeToolCall({
            sessionId: 'sess_live_gps_hallucinated_location',
            toolName: 'find_nearby',
            args: { location: 'Jozefow', cuisine: 'Kebab', lat: 50.39, lng: 18.95 },
            transcript: 'kebab',
        });

        expect(result.ok).toBe(true);
        expect(capturedEntities?.location).toBeNull();
        expect(capturedText).toBe('szukam Kebab');
        expect(result.trace.some((entry) => entry.includes('live_find_location_hallucinated_dropped_for_gps'))).toBe(true);
    });

    it('recovers add_items restaurant scope from transcript when model passes location-like restaurant_name', async () => {
        const sessions = new Map([
            ['sess_live_order_recover', {
                conversationPhase: 'neutral',
                orderMode: 'neutral',
            }],
        ]);

        const getSession = (id) => sessions.get(id) || {};
        const updateSession = (id, patch) => {
            const prev = sessions.get(id) || {};
            const next = { ...prev, ...patch };
            sessions.set(id, next);
            return next;
        };

        const router = new ToolRouter({
            handlers: makeFakeHandlers(),
            getSession,
            updateSession,
        });

        const result = await router.executeToolCall({
            sessionId: 'sess_live_order_recover',
            toolName: 'add_items_to_cart',
            args: {
                restaurant_name: 'Piekary Slaskie',
                items: [{ dish: 'Karkowka XL', quantity: 1 }],
            },
            transcript: 'chcialbym zlozyc zamowienie w lawasz kebab w piekarach slaskich',
        });

        expect(result.ok).toBe(true);
        expect(result.response.intent).toBe('create_order');
        expect(result.trace.some((entry) => entry.includes('live_order_restaurant_recovered:'))).toBe(true);
    });

    it('reroutes add_item_to_cart to show_menu when dish is actually a restaurant name', async () => {
        const sessions = new Map([
            ['sess_live_order_menu_reroute', {
                conversationPhase: 'neutral',
                orderMode: 'neutral',
            }],
        ]);

        const getSession = (id) => sessions.get(id) || {};
        const updateSession = (id, patch) => {
            const prev = sessions.get(id) || {};
            const next = { ...prev, ...patch };
            sessions.set(id, next);
            return next;
        };

        const router = new ToolRouter({
            handlers: makeFakeHandlers(),
            getSession,
            updateSession,
        });

        const result = await router.executeToolCall({
            sessionId: 'sess_live_order_menu_reroute',
            toolName: 'add_item_to_cart',
            args: { dish: 'Lawasz Kebab' },
            transcript: 'lawasz kebab',
        });

        expect(result.ok).toBe(true);
        expect(result.response.intent).toBe('menu_request');
        expect(result.trace.some((entry) => entry.includes('live_order_dish_is_restaurant:reroute_show_menu'))).toBe(true);
    });

    it('blocks show_menu for restaurant names outside the FreeFlow catalog', async () => {
        const sessions = new Map([
            ['sess_live_unknown_restaurant_menu', {
                conversationPhase: 'neutral',
                orderMode: 'neutral',
            }],
        ]);

        const getSession = (id) => sessions.get(id) || {};
        const updateSession = (id, patch) => {
            const prev = sessions.get(id) || {};
            const next = { ...prev, ...patch };
            sessions.set(id, next);
            return next;
        };

        let menuHandlerCalled = false;
        const handlers = makeFakeHandlers();
        handlers.food.menu_request = {
            execute: async () => {
                menuHandlerCalled = true;
                return { reply: 'Nie powinno sie wykonac.' };
            },
        };

        const router = new ToolRouter({
            handlers,
            getSession,
            updateSession,
        });

        const result = await router.executeToolCall({
            sessionId: 'sess_live_unknown_restaurant_menu',
            toolName: 'show_menu',
            args: { restaurant_name: 'Browar Piekary' },
            transcript: 'to ja ten browar Piekary bym sprobowal',
        });

        expect(result.ok).toBe(true);
        expect(menuHandlerCalled).toBe(false);
        expect(result.response.meta?.catalogGuard?.reason).toBe('restaurant_name_not_in_catalog');
        expect(result.trace.some((entry) => entry.includes('catalog_guard_blocked:restaurant_name_not_in_catalog'))).toBe(true);
        expect(sessions.get('sess_live_unknown_restaurant_menu')?.orderMode).toBe('neutral');
    });

    it('allows Śląski Szynk through the live show_menu catalog guard', async () => {
        const sessions = new Map([
            ['sess_live_slaski_szynk_menu', {
                conversationPhase: 'neutral',
                orderMode: 'neutral',
            }],
        ]);
        const getSession = (id) => sessions.get(id) || {};
        const updateSession = (id, patch) => {
            const next = { ...(sessions.get(id) || {}), ...patch };
            sessions.set(id, next);
            return next;
        };

        let capturedEntities = null;
        const handlers = makeFakeHandlers();
        handlers.food.menu_request = {
            execute: async (ctx) => {
                capturedEntities = ctx.entities;
                return {
                    reply: 'Pokazuję menu Śląskiego Szynku.',
                    menuItems: [{ id: 'szynk-1', name: 'Rolada wołowa' }],
                    contextUpdates: { expectedContext: 'create_order' },
                };
            },
        };

        const router = new ToolRouter({ handlers, getSession, updateSession });
        const result = await router.executeToolCall({
            sessionId: 'sess_live_slaski_szynk_menu',
            toolName: 'show_menu',
            args: { restaurant_name: 'Śląski Szynk' },
            transcript: 'pokaż menu śląski szynk',
        });

        expect(result.ok).toBe(true);
        expect(result.response.intent).toBe('menu_request');
        expect(capturedEntities?.restaurant).toBe('Śląski Szynk');
        expect(capturedEntities?.restaurantId).toBe('4ad6b301-671b-4343-bf91-9bab7cda37b4');
        expect(result.trace.some((entry) => entry.includes('catalog_guard_ok:4ad6b301-671b-4343-bf91-9bab7cda37b4'))).toBe(true);
    });

    it('blocks add_items_to_cart when model mixes a known restaurant id with an unknown restaurant name', async () => {
        const sessions = new Map([
            ['sess_live_mismatched_restaurant_order', {
                conversationPhase: 'neutral',
                orderMode: 'neutral',
                cart: { items: [], total: 0 },
            }],
        ]);

        const getSession = (id) => sessions.get(id) || {};
        const updateSession = (id, patch) => {
            const prev = sessions.get(id) || {};
            const next = { ...prev, ...patch };
            sessions.set(id, next);
            return next;
        };

        let orderHandlerCalled = false;
        const handlers = makeFakeHandlers();
        handlers.ordering.create_order = {
            execute: async () => {
                orderHandlerCalled = true;
                return {
                    reply: 'Dodano.',
                    contextUpdates: { cart: { items: [{ name: 'x', qty: 1 }], total: 1 } },
                };
            },
        };

        const router = new ToolRouter({
            handlers,
            getSession,
            updateSession,
        });

        const result = await router.executeToolCall({
            sessionId: 'sess_live_mismatched_restaurant_order',
            toolName: 'add_items_to_cart',
            args: {
                restaurant_name: 'Remedium',
                restaurant_id: '4d27fbe3-20d0-4eb4-b003-1935be53af25',
                items: [{ dish: 'klasyczny burger', quantity: 1 }],
            },
            transcript: 'to jest moj typ klasyczny burger',
        });

        expect(result.ok).toBe(true);
        expect(orderHandlerCalled).toBe(false);
        expect(result.response.meta?.catalogGuard?.reason).toBe('restaurant_name_not_in_catalog');
        expect(result.trace.some((entry) => entry.includes('catalog_guard_blocked:restaurant_name_not_in_catalog'))).toBe(true);
        expect(sessions.get('sess_live_mismatched_restaurant_order')?.cart.items).toHaveLength(0);
    });
});

