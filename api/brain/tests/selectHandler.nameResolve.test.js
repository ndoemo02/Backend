/**
 * selectHandler.nameResolve.test.js
 *
 * When Gemini calls select_restaurant with restaurant_name but no restaurant_id,
 * SelectRestaurantHandler must resolve the name → ID via DB and proceed directly
 * to menu display — instead of returning "Nie mam listy restauracji".
 */

import { describe, it, expect, vi } from 'vitest';

// Mock MenuHandler before importing selectHandler (it is dynamically imported inside)
vi.mock('../domains/food/menuHandler.js', () => ({
    MenuHandler: class {
        async execute(_ctx) {
            return {
                reply: 'Menu załadowane.',
                contextUpdates: { last_menu: [], last_menu_restaurant_id: null },
                meta: { source: 'menu_mock' },
            };
        }
    },
}));

// Mock supabase for restaurantResolver DB lookup
vi.mock('../../_supabase.js', () => ({
    supabase: {
        from: vi.fn((table) => {
            if (table === 'restaurants') {
                return {
                    select: vi.fn(() => ({
                        eq: vi.fn(() => ({
                            ilike: vi.fn((_col, _pattern) => ({
                                limit: vi.fn(() =>
                                    Promise.resolve({
                                        data: [{ id: 'sk1', name: 'Restauracja Stara Kamienica' }],
                                        error: null,
                                    })
                                ),
                            })),
                        })),
                    })),
                };
            }
            return { select: vi.fn(() => Promise.resolve({ data: [], error: null })) };
        }),
    },
}));

import { SelectRestaurantHandler } from '../domains/food/selectHandler.js';

function makeCtx({ restaurantName, restaurantId = null }) {
    return {
        intent: 'select_restaurant',
        text: restaurantName || '',
        sessionId: 'test-session-001',
        entities: {
            restaurant: restaurantName || null,
            restaurantId: restaurantId || null,
        },
        body: { text: restaurantName || '' },
        session: {
            currentRestaurant: null,
            lastRestaurant: null,
            last_restaurants_list: [],
            last_menu: [],
            cart: { items: [], total: 0 },
            entityCache: undefined,
        },
        meta: {},
    };
}

describe('SelectRestaurantHandler — name-only resolution', () => {

    it('resolves restaurant by name when no ID provided — proceeds to menu (not "Nie mam listy")', async () => {
        const handler = new SelectRestaurantHandler();
        const ctx = makeCtx({ restaurantName: 'Stara Kamienica' });
        const result = await handler.execute(ctx);

        expect(result?.reply).not.toContain('Nie mam listy');
        expect(result?.reply).not.toContain('podaj nazwę miasta');
        expect(result?.contextUpdates?.currentRestaurant?.id).toBe('sk1');
        expect(result?.contextUpdates?.expectedContext).toBe('create_order');
        expect(result?.meta?.source).toBe('select_name_resolved_auto_menu');
    });

    it('sets currentRestaurant on session context after resolution', async () => {
        const handler = new SelectRestaurantHandler();
        const ctx = makeCtx({ restaurantName: 'Stara Kamienica' });
        await handler.execute(ctx);

        expect(ctx.session.currentRestaurant?.id).toBe('sk1');
        expect(ctx.session.currentRestaurant?.name).toBe('Restauracja Stara Kamienica');
    });

    it('still returns "Nie mam listy" when restaurant name is unknown', async () => {
        // Override mock to return empty for unknown name
        const { supabase } = await import('../../_supabase.js');
        supabase.from.mockImplementationOnce(() => ({
            select: vi.fn(() => ({
                eq: vi.fn(() => ({
                    ilike: vi.fn(() => ({
                        limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
                    })),
                })),
            })),
        }));

        const handler = new SelectRestaurantHandler();
        const ctx = makeCtx({ restaurantName: 'Nieznana Restauracja XYZ' });
        const result = await handler.execute(ctx);

        expect(result?.reply).toContain('Nie mam listy');
    });

    it('existing restaurantId path unaffected (regression)', async () => {
        const handler = new SelectRestaurantHandler();
        const ctx = makeCtx({ restaurantName: 'Restauracja Stara Kamienica', restaurantId: 'sk1' });
        const result = await handler.execute(ctx);

        // Should use direct entity path, not name-resolve path
        expect(result?.contextUpdates?.currentRestaurant?.id).toBe('sk1');
        // Direct path source
        expect(result?.meta?.source).toBe('entity_direct_selection_auto_menu');
    });

    it('UI action reopens the current restaurant menu instead of returning the already-selected guard', async () => {
        const handler = new SelectRestaurantHandler();
        const ctx = makeCtx({ restaurantName: 'Restauracja Stara Kamienica', restaurantId: 'sk1' });
        ctx.session.currentRestaurant = { id: 'sk1', name: 'Restauracja Stara Kamienica' };
        ctx.body.meta = {
            ui_action: { type: 'select_restaurant', restaurant_id: 'sk1' },
        };

        const result = await handler.execute(ctx);

        expect(result?.meta?.source).toBe('entity_direct_selection_auto_menu');
        expect(result?.contextUpdates?.currentRestaurant?.id).toBe('sk1');
    });
});
