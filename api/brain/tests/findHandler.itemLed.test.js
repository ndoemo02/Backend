import { beforeEach, describe, expect, it, vi } from 'vitest';

const restaurantsInCity = [
    { id: 'r_callzone', name: 'Pizzeria Callzone', city: 'Piekary Slaskie', cuisine_type: 'Pizzeria', lat: 50.39, lng: 18.95 },
    { id: 'r_monte', name: 'Pizzeria Monte Carlo', city: 'Piekary Slaskie', cuisine_type: 'Wloska', lat: 50.38, lng: 18.98 },
    { id: 'r_kebab', name: 'Kebab u Orla', city: 'Piekary Slaskie', cuisine_type: 'Kebab', lat: 50.37, lng: 18.94 },
    { id: 'r_vien', name: 'Vien-Thien', city: 'Piekary Slaskie', cuisine_type: 'Wietnamska', lat: 50.40, lng: 18.96 },
];

const menuRows = [
    { id: 'm1', restaurant_id: 'r_callzone', name: 'Rollo wolowe', base_name: 'Rollo wolowe', available: true },
    { id: 'm2', restaurant_id: 'r_monte', name: 'Pizza Pepperoni', base_name: 'Pizza Pepperoni', available: true },
    { id: 'm4', restaurant_id: 'r_monte', name: 'Lody waniliowe', base_name: 'Lody waniliowe', available: true },
    { id: 'm5', restaurant_id: 'r_kebab', name: 'Kebab w bulce', base_name: 'Kebab w bulce', available: true },
    { id: 'm6', restaurant_id: 'r_kebab', name: 'Mlody Burger', base_name: 'Mlody Burger', available: true },
    { id: 'm7', restaurant_id: 'r_vien', name: 'Wołowina pikantna', base_name: 'Wołowina pikantna', spicy: true, item_tags: ['spicy'], available: true },
    { id: 'm8', restaurant_id: 'r_callzone', name: 'Better Than Drwal - Wołowina', base_name: 'Better Than Drwal - Wołowina', available: true },
    {
        id: 'm3',
        restaurant_id: 'r_callzone',
        name: 'Pozycja dnia',
        base_name: 'Pozycja dnia',
        item_family: 'lawasz',
        item_aliases: ['lawasz kebab', 'kebab lawasz'],
        available: true,
    },
];

const supabaseFromMock = vi.fn();

vi.mock('../../_supabase.js', () => ({
    supabase: {
        from: (...args) => supabaseFromMock(...args),
    },
}));

describe('FindRestaurantHandler item-led discovery', () => {
    beforeEach(() => {
        supabaseFromMock.mockReset();

        supabaseFromMock.mockImplementation((table) => {
            if (table === 'restaurants') {
                const limit = vi.fn().mockResolvedValue({ data: restaurantsInCity, error: null });
                const ilike = vi.fn().mockReturnValue({ limit });
                const eq = vi.fn().mockReturnValue({ ilike });
                const select = vi.fn().mockReturnValue({ eq });
                return { select };
            }

            if (table === 'menu_items_v2') {
                const limit = vi.fn().mockResolvedValue({ data: menuRows, error: null });
                const inFn = vi.fn().mockReturnValue({ limit });
                const select = vi.fn().mockReturnValue({ in: inFn });
                return { select };
            }

            throw new Error(`Unexpected table: ${table}`);
        });
    });

    it('prefers restaurants with exact dish matches for item-led city query', async () => {
        const { FindRestaurantHandler } = await import('../domains/food/findHandler.js');

        const repo = {
            searchRestaurants: vi.fn().mockResolvedValue([]),
            searchNearby: vi.fn().mockResolvedValue([]),
        };

        const handler = new FindRestaurantHandler(repo);

        const result = await handler.execute({
            text: 'gdzie zjem rollo w piekarach',
            entities: { location: 'Piekary Slaskie' },
            session: {},
        });

        const names = (result.restaurants || []).map((restaurant) => restaurant.name);
        expect(names[0]).toBe('Pizzeria Callzone');
        expect(names).not.toContain('Pizzeria Monte Carlo');
        expect(repo.searchRestaurants).not.toHaveBeenCalled();
    });

    it('keeps the dish signal when the user clarifies they want an ordinary spicy beef meal', async () => {
        const { FindRestaurantHandler } = await import('../domains/food/findHandler.js');

        const repo = {
            searchRestaurants: vi.fn().mockResolvedValue([]),
            searchNearby: vi.fn().mockResolvedValue([]),
        };

        const handler = new FindRestaurantHandler(repo);
        const result = await handler.execute({
            text: 'Chcę wołowinę na ostro jako zwykły obiad',
            entities: { tag: 'spicy', tags: ['spicy'] },
            session: {},
        });

        expect(result.restaurants?.[0]?.name).toBe('Vien-Thien');
        expect(result.restaurants?.[0]?.matched_menu_items).toContain('Wołowina pikantna');
        expect(result.restaurants?.map((restaurant) => restaurant.name)).toEqual(['Vien-Thien']);
        expect(repo.searchRestaurants).not.toHaveBeenCalled();
    });

    it('keeps only menu items with verified dietary metadata', async () => {
        const veganRows = [
            {
                id: 'm-vegan',
                restaurant_id: 'r_monte',
                name: 'Deser czekoladowy',
                base_name: 'Deser czekoladowy',
                item_family: 'deser',
                item_aliases: ['deser'],
                dietary_flags: ['vegan'],
                available: true,
            },
            {
                id: 'm-unknown',
                restaurant_id: 'r_callzone',
                name: 'Deser dnia',
                base_name: 'Deser dnia',
                item_family: 'deser',
                item_aliases: ['deser'],
                available: true,
            },
        ];

        supabaseFromMock.mockImplementation((table) => {
            if (table === 'restaurants') {
                const limit = vi.fn().mockResolvedValue({ data: restaurantsInCity, error: null });
                const ilike = vi.fn().mockReturnValue({ limit });
                const eq = vi.fn().mockReturnValue({ ilike });
                const select = vi.fn().mockReturnValue({ eq });
                return { select };
            }
            if (table === 'menu_items_v2') {
                const limit = vi.fn().mockResolvedValue({ data: veganRows, error: null });
                const inFn = vi.fn().mockReturnValue({ limit });
                const select = vi.fn().mockReturnValue({ in: inFn });
                return { select };
            }
            throw new Error(`Unexpected table: ${table}`);
        });

        const { FindRestaurantHandler } = await import('../domains/food/findHandler.js');
        const handler = new FindRestaurantHandler({
            searchRestaurants: vi.fn().mockResolvedValue([]),
            searchNearby: vi.fn().mockResolvedValue([]),
        });

        const result = await handler.execute({
            text: 'pokaż deser wegański',
            entities: { dish: 'deser' },
            session: {},
        });

        expect(result.restaurants?.map(restaurant => restaurant.id)).toEqual(['r_monte']);
        expect(result.restaurants?.[0]?.discovery_filter_feedback).toContainEqual({
            id: 'vegan',
            dimension: 'dietary',
            state: 'verified',
        });
    });

    it('filters GPS discovery by nearby candidate menus for ice cream requests', async () => {
        const { FindRestaurantHandler } = await import('../domains/food/findHandler.js');

        const repo = {
            searchRestaurants: vi.fn().mockResolvedValue([]),
            searchNearby: vi.fn().mockResolvedValue([
                restaurantsInCity.find((restaurant) => restaurant.id === 'r_kebab'),
                restaurantsInCity.find((restaurant) => restaurant.id === 'r_monte'),
                restaurantsInCity.find((restaurant) => restaurant.id === 'r_callzone'),
            ]),
        };

        const handler = new FindRestaurantHandler(repo);

        const result = await handler.execute({
            text: 'szukam lodow w piekarach',
            entities: { cuisine: 'ice cream' },
            coords: { lat: 50.39, lng: 18.95 },
            session: {},
            source: 'live_tool:find_nearby',
        });

        const names = (result.restaurants || []).map((restaurant) => restaurant.name);
        expect(names).toEqual(['Pizzeria Monte Carlo']);
        expect(result.restaurants?.[0]?.matched_menu_items).toContain('Lody waniliowe');
        expect(result.restaurants?.[0]?.matched_menu_items).not.toContain('Mlody Burger');
        expect(repo.searchNearby).toHaveBeenCalled();
        expect(repo.searchRestaurants).not.toHaveBeenCalled();
    });

    it('falls back to service-city menu matches when nearby GPS candidates miss ice cream', async () => {
        const { FindRestaurantHandler } = await import('../domains/food/findHandler.js');

        const repo = {
            searchRestaurants: vi.fn().mockResolvedValue([]),
            searchNearby: vi.fn().mockResolvedValue([
                restaurantsInCity.find((restaurant) => restaurant.id === 'r_kebab'),
                restaurantsInCity.find((restaurant) => restaurant.id === 'r_callzone'),
            ]),
        };

        const handler = new FindRestaurantHandler(repo);

        const result = await handler.execute({
            text: 'szukam lodow w piekarach',
            entities: { cuisine: 'ice cream' },
            coords: { lat: 50.39, lng: 18.95 },
            session: {},
            source: 'live_tool:find_nearby',
        });

        const names = (result.restaurants || []).map((restaurant) => restaurant.name);
        expect(names).toEqual(['Pizzeria Monte Carlo']);
        expect(result.restaurants?.[0]?.matched_menu_items).toContain('Lody waniliowe');
        expect(repo.searchNearby).toHaveBeenCalled();
        expect(repo.searchRestaurants).not.toHaveBeenCalled();
    });

    it('does not fall back to broad GPS restaurants when ice cream has no city menu match', async () => {
        supabaseFromMock.mockImplementation((table) => {
            if (table === 'restaurants') {
                const limit = vi.fn().mockResolvedValue({ data: restaurantsInCity, error: null });
                const ilike = vi.fn().mockReturnValue({ limit });
                const eq = vi.fn().mockReturnValue({ ilike });
                const select = vi.fn().mockReturnValue({ eq });
                return { select };
            }

            if (table === 'menu_items_v2') {
                const limit = vi.fn().mockResolvedValue({
                    data: menuRows.filter((row) => row.restaurant_id !== 'r_monte'),
                    error: null,
                });
                const inFn = vi.fn().mockReturnValue({ limit });
                const select = vi.fn().mockReturnValue({ in: inFn });
                return { select };
            }

            throw new Error(`Unexpected table: ${table}`);
        });

        const { FindRestaurantHandler } = await import('../domains/food/findHandler.js');

        const repo = {
            searchRestaurants: vi.fn().mockResolvedValue([]),
            searchNearby: vi.fn().mockResolvedValue([
                restaurantsInCity.find((restaurant) => restaurant.id === 'r_kebab'),
                restaurantsInCity.find((restaurant) => restaurant.id === 'r_callzone'),
            ]),
        };

        const handler = new FindRestaurantHandler(repo);

        const result = await handler.execute({
            text: 'szukam lodow w piekarach',
            entities: { cuisine: 'ice cream' },
            coords: { lat: 50.39, lng: 18.95 },
            session: {},
            source: 'live_tool:find_nearby',
        });

        expect(result.restaurants).toBeUndefined();
        expect(result.reply).toContain('Nie widz');
        expect(result.reply).toContain('ice cream');
    });

    it('matches item_family/item_aliases when menu name does not contain query token', async () => {
        const { FindRestaurantHandler } = await import('../domains/food/findHandler.js');

        const repo = {
            searchRestaurants: vi.fn().mockResolvedValue([]),
            searchNearby: vi.fn().mockResolvedValue([]),
        };

        const handler = new FindRestaurantHandler(repo);

        const result = await handler.execute({
            text: 'lawasz kebab w piekarach',
            entities: { location: 'Piekary Slaskie', dish: 'lawasz' },
            session: {},
        });

        const names = (result.restaurants || []).map((restaurant) => restaurant.name);
        expect(names[0]).toBe('Pizzeria Callzone');
        expect(repo.searchRestaurants).not.toHaveBeenCalled();
    });

    it('uses cuisine entity as item query when dish entity is missing', async () => {
        const { FindRestaurantHandler } = await import('../domains/food/findHandler.js');

        const repo = {
            searchRestaurants: vi.fn().mockResolvedValue([]),
            searchNearby: vi.fn().mockResolvedValue([]),
        };

        const handler = new FindRestaurantHandler(repo);

        const result = await handler.execute({
            text: 'pokaz restauracje w piekarach',
            entities: { location: 'Piekary Slaskie', cuisine: 'lawasz' },
            session: {},
        });

        const names = (result.restaurants || []).map((restaurant) => restaurant.name);
        expect(names[0]).toBe('Pizzeria Callzone');
        expect(repo.searchRestaurants).not.toHaveBeenCalled();
    });

    it('normalizes cuisine aliases before repository search (Italian -> Wloska)', async () => {
        const { FindRestaurantHandler } = await import('../domains/food/findHandler.js');

        const repo = {
            searchRestaurants: vi.fn().mockResolvedValue([
                { id: 'r_monte', name: 'Pizzeria Monte Carlo', city: 'Piekary Slaskie', cuisine_type: 'Wloska' },
            ]),
            searchNearby: vi.fn().mockResolvedValue([]),
        };

        const handler = new FindRestaurantHandler(repo);

        const result = await handler.execute({
            text: 'pokaz cos w piekarach',
            entities: { location: 'Piekary Slaskie', cuisine: 'Italian' },
            session: {},
        });

        expect(repo.searchRestaurants).toHaveBeenCalledWith(expect.stringMatching(/Piekary/i), 'Wloska');
        expect((result.restaurants || [])[0]?.name).toBe('Pizzeria Monte Carlo');
    });

    it('normalizes cuisine aliases before repository search (Vietnamese -> Azjatycka)', async () => {
        const { FindRestaurantHandler } = await import('../domains/food/findHandler.js');

        const repo = {
            searchRestaurants: vi.fn().mockResolvedValue([
                { id: 'r_viet', name: 'Vien-Thien', city: 'Piekary Slaskie', cuisine_type: 'Azjatycka' },
            ]),
            searchNearby: vi.fn().mockResolvedValue([]),
        };

        const handler = new FindRestaurantHandler(repo);

        await handler.execute({
            text: 'pokaz cos w piekarach',
            entities: { location: 'Piekary Slaskie', cuisine: 'Vietnamese' },
            session: {},
        });

        expect(repo.searchRestaurants).toHaveBeenCalledWith(expect.stringMatching(/Piekary/i), 'Azjatycka');
    });

    it('normalizes cuisine aliases before repository search (Thai -> Azjatycka)', async () => {
        const { FindRestaurantHandler } = await import('../domains/food/findHandler.js');

        const repo = {
            searchRestaurants: vi.fn().mockResolvedValue([
                { id: 'r_viet', name: 'Vien-Thien', city: 'Piekary Slaskie', cuisine_type: 'Azjatycka' },
            ]),
            searchNearby: vi.fn().mockResolvedValue([]),
        };

        const handler = new FindRestaurantHandler(repo);

        await handler.execute({
            text: 'pokaz cos w piekarach',
            entities: { location: 'Piekary Slaskie', cuisine: 'Thai' },
            session: {},
        });

        expect(repo.searchRestaurants).toHaveBeenCalledWith(expect.stringMatching(/Piekary/i), 'Azjatycka');
    });

    it('broadens Azjatycka search to concrete cuisine_type variants (Wietnamska/Tajska/Chinska)', async () => {
        const { FindRestaurantHandler } = await import('../domains/food/findHandler.js');

        const repo = {
            searchRestaurants: vi.fn().mockImplementation(async (_city, cuisine) => {
                if (cuisine === 'Wietnamska') {
                    return [{ id: 'r_vien', name: 'Vien-Thien', city: 'Piekary Slaskie', cuisine_type: 'Wietnamska' }];
                }
                return [];
            }),
            searchNearby: vi.fn().mockResolvedValue([]),
        };

        const handler = new FindRestaurantHandler(repo);

        const result = await handler.execute({
            text: 'szukam wietnamskiego w piekarach',
            entities: { location: 'Piekary Slaskie', cuisine: 'vietnamese' },
            session: {},
        });

        expect((result.restaurants || []).map((r) => r.name)).toContain('Vien-Thien');
        expect(repo.searchRestaurants).toHaveBeenCalledWith(expect.stringMatching(/Piekary/i), 'Azjatycka');
        expect(repo.searchRestaurants).toHaveBeenCalledWith(expect.stringMatching(/Piekary/i), 'Wietnamska');
    });

    it('broadens Fast Food search to concrete cuisine_type variants (Amerykanska/Kebab/Burger)', async () => {
        const { FindRestaurantHandler } = await import('../domains/food/findHandler.js');

        const repo = {
            searchRestaurants: vi.fn().mockImplementation(async (_city, cuisine) => {
                if (cuisine === 'Kebab') {
                    return [{ id: 'r_lawasz', name: 'LAWASZ KEBAB', city: 'Piekary Slaskie', cuisine_type: 'Kebab' }];
                }
                return [];
            }),
            searchNearby: vi.fn().mockResolvedValue([]),
        };

        const handler = new FindRestaurantHandler(repo);

        const result = await handler.execute({
            text: 'fast food w piekarach',
            entities: { location: 'Piekary Slaskie', cuisine: 'fast food' },
            session: {},
        });

        expect((result.restaurants || []).map((r) => r.name)).toContain('LAWASZ KEBAB');
        expect(repo.searchRestaurants).toHaveBeenCalledWith(expect.stringMatching(/Piekary/i), 'Fast Food');
        expect(repo.searchRestaurants).toHaveBeenCalledWith(expect.stringMatching(/Piekary/i), 'Kebab');
    });
});
