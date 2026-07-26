import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../menuService.js', () => ({
    loadMenuPreview: vi.fn(async () => ({
        menu: [
            { id: 'm1', name: 'Pierogi Ruskie', price_pln: 22, category: 'Dania glowne', available: true },
            { id: 'm2', name: 'Barszcz Czerwony', price_pln: 14, category: 'Zupy', available: true },
            { id: 'm3', name: 'Kompot', price_pln: 7, category: 'Napoje', available: true },
            { id: 'm4', name: 'Sernik', price_pln: 16, category: 'Desery', available: true },
        ],
        shortlist: [
            { id: 'm1', name: 'Pierogi Ruskie', price_pln: 22, category: 'Dania glowne', available: true },
            { id: 'm2', name: 'Barszcz Czerwony', price_pln: 14, category: 'Zupy', available: true },
        ],
        fallbackUsed: false,
    })),
}));

vi.mock('../locationService.js', () => ({
    findRestaurantByName: vi.fn(async () => null),
    getLocationFallback: vi.fn(async () => null),
}));

vi.mock('../data/restaurantCatalog.js', () => ({
    RESTAURANT_CATALOG: [],
}));

import { MenuHandler } from '../domains/food/menuHandler.js';
import { loadMenuPreview } from '../menuService.js';

describe('MenuHandler full menu scope', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns full menu in menuItems when menu_request is resolved', async () => {
        const handler = new MenuHandler();
        const sessionId = `menu_scope_${Date.now()}`;

        const ctx = {
            text: 'pokaz menu',
            sessionId,
            entities: {},
            session: {
                currentRestaurant: { id: 'rest_1', name: 'Test Bistro' },
                lastRestaurant: { id: 'rest_1', name: 'Test Bistro' },
                lastIntent: 'select_restaurant',
            },
        };

        const result = await handler.execute(ctx);

        expect(loadMenuPreview).toHaveBeenCalledWith('rest_1', {});
        expect(result.intent).toBe('menu_request');
        expect(Array.isArray(result.menuItems)).toBe(true);
        expect(Array.isArray(result.menu)).toBe(true);
        expect(result.menuItems).toHaveLength(4);
        expect(result.menu).toHaveLength(4);
        expect(result.menuItems.map((item) => item.id)).toEqual(result.menu.map((item) => item.id));
        expect(result.meta?.menuScope).toBe('full_menu');
        expect(result.meta?.menuPresentationMode).toBe('full');
    });

    it('cache hit path still keeps full menu in menuItems', async () => {
        const handler = new MenuHandler();
        const sessionId = `menu_scope_cache_${Date.now()}`;
        const cachedMenu = [
            { id: 'm1', name: 'Pierogi Ruskie', price_pln: 22, category: 'Dania glowne', available: true },
            { id: 'm2', name: 'Barszcz Czerwony', price_pln: 14, category: 'Zupy', available: true },
            { id: 'm3', name: 'Kompot', price_pln: 7, category: 'Napoje', available: true },
        ];

        const ctx = {
            text: 'pokaz menu',
            sessionId,
            entities: {},
            session: {
                currentRestaurant: { id: 'rest_1', name: 'Test Bistro' },
                lastRestaurant: { id: 'rest_1', name: 'Test Bistro' },
                last_menu_restaurant_id: 'rest_1',
                last_menu: cachedMenu,
                lastIntent: 'select_restaurant',
            },
        };

        const result = await handler.execute(ctx);

        expect(loadMenuPreview).not.toHaveBeenCalled();
        expect(result.intent).toBe('menu_request');
        expect(result.menuItems).toHaveLength(3);
        expect(result.menuItems.map((item) => item.id)).toEqual(cachedMenu.map((item) => item.id));
    });

    it('focuses dessert-like menu requests instead of summarizing unrelated first items', async () => {
        const handler = new MenuHandler();
        const sessionId = `menu_scope_dessert_${Date.now()}`;

        const result = await handler.execute({
            text: 'cos na slodko w tej restauracji',
            sessionId,
            entities: {},
            session: {
                currentRestaurant: { id: 'rest_1', name: 'Test Bistro' },
                lastRestaurant: { id: 'rest_1', name: 'Test Bistro' },
                lastIntent: 'select_restaurant',
            },
        });

        expect(result.intent).toBe('menu_request');
        expect(result.meta?.focusedMenuItemId).toBe('m4');
        expect(result.meta?.menuFocusQuery).toBe('dessert');
        expect(result.meta?.menuPresentationMode).toBe('discovery');
        expect(result.reply).toContain('Sernik');
        expect(result.reply).not.toContain('Pierogi Ruskie');
    });

    it('does not claim drinks exist when focused drink request has no menu match', async () => {
        const handler = new MenuHandler();
        const sessionId = `menu_scope_no_drink_${Date.now()}`;
        const cachedMenu = [
            { id: 'm1', name: 'Pierogi Ruskie', price_pln: 22, category: 'Dania glowne', available: true },
            { id: 'm2', name: 'Barszcz Czerwony', price_pln: 14, category: 'Zupy', available: true },
        ];

        const result = await handler.execute({
            text: 'czy mozna dodac cos do picia',
            sessionId,
            entities: {},
            session: {
                currentRestaurant: { id: 'rest_1', name: 'Test Bistro' },
                lastRestaurant: { id: 'rest_1', name: 'Test Bistro' },
                last_menu_restaurant_id: 'rest_1',
                last_menu: cachedMenu,
                lastIntent: 'select_restaurant',
            },
        });

        expect(loadMenuPreview).not.toHaveBeenCalled();
        expect(result.meta?.menuFocusQuery).toBe('drink');
        expect(result.meta?.focusedMenuItemId).toBeNull();
        expect(result.meta?.menuPresentationMode).toBe('full');
        expect(result.reply).toContain('Nie widze');
        expect(result.reply).toContain('napojow');
    });
});
