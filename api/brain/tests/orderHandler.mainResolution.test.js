import { describe, it, expect, vi, beforeEach } from 'vitest';

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

describe('OrderHandler main-item resolution', () => {
    let handler;

    beforeEach(() => {
        handler = new OrderHandler();
        resolveMenuItemConflictMock.mockClear();
        canonicalizeDishMock.mockReset();
    });

    it('adds MAIN dish even when canonical dish points to addon phrase', async () => {
        canonicalizeDishMock.mockReturnValue('Gyros z frytkami i tzatziki');

        const session = {
            currentRestaurant: { id: 'R_BOWL', name: 'Test Bowl House' },
            lastRestaurant: { id: 'R_BOWL', name: 'Test Bowl House' },
            last_menu: [
                {
                    id: 'addon-tzatziki',
                    name: 'Sos Tzatziki',
                    base_name: 'Sos Tzatziki',
                    category: 'Dodatki',
                    type: 'ADDON',
                    price_pln: 4,
                },
                {
                    id: 'main-bowl-1',
                    name: 'Bowl Gyros-Halloumi',
                    base_name: 'Bowl Gyros-Halloumi',
                    category: 'Danie glowne',
                    type: 'MAIN',
                    price_pln: 32,
                },
            ],
            cart: { items: [], total: 0 },
        };

        const response = await handler.execute({
            text: 'Bowl Gyros-Halloumi',
            entities: { dish: 'Bowl Gyros-Halloumi' },
            session,
        });

        expect(response.meta?.addedToCart).toBe(false);
        expect(response.contextUpdates?.pendingOrder?.items?.length).toBe(1);
        expect(response.contextUpdates?.pendingOrder?.items?.[0]?.id).toBe('main-bowl-1');
        expect(response.contextUpdates?.pendingOrder?.items?.[0]?.id).not.toBe('addon-tzatziki');
        expect(resolveMenuItemConflictMock).not.toHaveBeenCalled();
    });

    it('returns clarify_order when only addon matches and addon was not explicitly requested', async () => {
        canonicalizeDishMock.mockReturnValue('Tzatziki');

        const session = {
            currentRestaurant: { id: 'R_BOWL', name: 'Test Bowl House' },
            lastRestaurant: { id: 'R_BOWL', name: 'Test Bowl House' },
            last_menu: [
                {
                    id: 'addon-tzatziki',
                    name: 'Sos Tzatziki',
                    base_name: 'Sos Tzatziki',
                    category: 'Dodatki',
                    type: 'ADDON',
                    price_pln: 4,
                },
                {
                    id: 'main-bowl-1',
                    name: 'Bowl Gyros-Halloumi',
                    base_name: 'Bowl Gyros-Halloumi',
                    category: 'Danie glowne',
                    type: 'MAIN',
                    price_pln: 32,
                },
            ],
            cart: { items: [], total: 0 },
        };

        const response = await handler.execute({
            text: 'tzatziki',
            entities: { dish: 'tzatziki' },
            session,
        });

        expect(response.intent).toBe('clarify_order');
        expect(response.reply).toContain('dodatek');
        expect(response.meta?.clarify?.status).toBe('AMBIGUOUS');
        expect(response.meta?.clarify?.requestedCategory).toBe('ADDON');
        expect(response.meta?.clarify?.candidates?.[0]?.id).toBe('addon-tzatziki');
        expect(response.contextUpdates?.expectedContext).toBe('clarify_order');
        expect(session.cart.items.length).toBe(0);
    });

    it('asks explicit X/Y clarification when disambiguation returns low-confidence item options', async () => {
        canonicalizeDishMock.mockImplementation((text) => text);
        resolveMenuItemConflictMock.mockResolvedValueOnce({
            status: 'DISAMBIGUATION_REQUIRED',
            clarifyType: 'item',
            query: 'burger klasyk',
            options: [
                { id: 'main-burger-classic', name: 'Burger Klasyczny', score: 0.72 },
                { id: 'main-burger-bbq', name: 'Burger BBQ', score: 0.69 },
            ],
        });

        const session = {
            currentRestaurant: null,
            lastRestaurant: null,
            last_menu: [],
            cart: { items: [], total: 0 },
        };

        const response = await handler.execute({
            text: 'burger klasyk',
            entities: { dish: 'burger klasyk' },
            session,
        });

        expect(response.intent).toBe('clarify_order');
        expect(response.reply).toContain('Czy chodziło Ci o "Burger Klasyczny" czy "Burger BBQ"?');
        expect(response.meta?.clarify?.clarifyType).toBe('item');
        expect(response.contextUpdates?.expectedContext).toBe('clarify_order');
        expect(session.cart.items.length).toBe(0);
    });

    it('does not block addon ordering when expectedContext is order_addon', async () => {
        canonicalizeDishMock.mockReturnValue('Sos Tzatziki');

        const session = {
            expectedContext: 'order_addon',
            currentRestaurant: { id: 'R_BOWL', name: 'Test Bowl House' },
            lastRestaurant: { id: 'R_BOWL', name: 'Test Bowl House' },
            last_menu: [
                {
                    id: 'addon-tzatziki',
                    name: 'Sos Tzatziki',
                    base_name: 'Sos Tzatziki',
                    category: 'Dodatki',
                    type: 'ADDON',
                    price_pln: 4,
                },
                {
                    id: 'main-bowl-1',
                    name: 'Bowl Gyros-Halloumi',
                    base_name: 'Bowl Gyros-Halloumi',
                    category: 'Danie glowne',
                    type: 'MAIN',
                    price_pln: 32,
                },
            ],
            cart: { items: [], total: 0 },
        };

        const response = await handler.execute({
            text: 'dodaj sos tzatziki',
            entities: { dish: 'sos tzatziki' },
            session,
        });

        expect(response.intent).not.toBe('clarify_order');
        expect(response.meta?.addedToCart).toBe(false);
        expect(response.contextUpdates?.pendingOrder?.items?.[0]?.id).toBe('addon-tzatziki');
    });

    it('adds two items for multi-item candidate utterance with quantity distribution', async () => {
        canonicalizeDishMock.mockImplementation((text) => text);

        const session = {
            currentRestaurant: { id: 'R_MULTI', name: 'Cafe Test' },
            lastRestaurant: { id: 'R_MULTI', name: 'Cafe Test' },
            last_menu: [
                {
                    id: 'drink-pepsi',
                    name: 'Pepsi',
                    base_name: 'Pepsi',
                    category: 'Napoje',
                    type: 'DRINK',
                    price_pln: 8,
                },
                {
                    id: 'drink-kawa-czarna',
                    name: 'Kawa czarna',
                    base_name: 'Kawa czarna',
                    category: 'Napoje',
                    type: 'DRINK',
                    price_pln: 10,
                },
            ],
            cart: { items: [], total: 0 },
        };

        const response = await handler.execute({
            text: 'Pepsi i dwie kawy czarne',
            entities: {
                items: [
                    { dish: 'Pepsi', quantity: 1 },
                    { dish: 'Kawa czarna', quantity: 2 },
                ],
                dish: 'Pepsi',
            },
            session,
        });

        expect(response.meta?.addedToCart).toBe(false);
        expect(response.meta?.orderMode).toBe('multi_candidate');
        expect(response.contextUpdates?.pendingOrder?.items?.length).toBe(2);
        const coffee = response.contextUpdates?.pendingOrder?.items?.find((item) => item.id === 'drink-kawa-czarna');
        const pepsi = response.contextUpdates?.pendingOrder?.items?.find((item) => item.id === 'drink-pepsi');
        expect(coffee?.quantity).toBe(2);
        expect(pepsi?.quantity).toBe(1);
    });

    it('rejects the entire multi-item batch when one item is missing in menu', async () => {
        canonicalizeDishMock.mockImplementation((text) => text);

        const session = {
            currentRestaurant: { id: 'R_VIEN', name: 'Vien-Thien' },
            lastRestaurant: { id: 'R_VIEN', name: 'Vien-Thien' },
            last_menu: [
                {
                    id: 'main-wolowina-5-smakow',
                    name: 'Wołowina 5 smaków',
                    base_name: 'Wołowina 5 smaków',
                    category: 'Danie glowne',
                    type: 'MAIN',
                    price_pln: 36,
                },
                {
                    id: 'soup-won-ton',
                    name: 'Zupa Won Ton',
                    base_name: 'Zupa Won Ton',
                    category: 'Zupa',
                    type: 'MAIN',
                    price_pln: 18,
                },
            ],
            cart: { items: [], total: 0 },
        };

        const response = await handler.execute({
            text: 'Sushi, Wolowina 5 smakow i Zupa Won Ton',
            entities: {
                dish: 'Sushi',
                items: [
                    { dish: 'Sushi', quantity: 1 },
                    { dish: 'Wołowina 5 smaków', quantity: 1 },
                    { dish: 'Zupa Won Ton', quantity: 2 },
                ],
            },
            session,
        });

        expect(response.intent).toBe('clarify_order');
        expect(response.meta?.addedToCart).toBe(false);
        expect(response.meta?.source).toBe('order_handler_multi_atomic_reject');
        expect(response.meta?.clarify?.unresolvedItems).toContain('Sushi');
        expect(response.reply).toContain('Nie znalazlam w menu: Sushi');
        expect(response.contextUpdates?.pendingOrder).toBeNull();
        expect(session.cart.items).toEqual([]);
    });

    it('clamps accidental multi-item qty drift to 1 when user gave no explicit quantity', async () => {
        canonicalizeDishMock.mockImplementation((text) => text);

        const session = {
            currentRestaurant: { id: 'R_STARA', name: 'Restauracja Stara Kamienica' },
            lastRestaurant: { id: 'R_STARA', name: 'Restauracja Stara Kamienica' },
            last_menu: [
                {
                    id: 'main-schab-tradycyjny',
                    name: 'Tradycyjny schabowy',
                    base_name: 'Tradycyjny schabowy',
                    category: 'Danie glowne',
                    type: 'MAIN',
                    price_pln: 16,
                },
                {
                    id: 'main-nalesnik-kurczak',
                    name: 'Nalesnik z kurczakiem i warzywami',
                    base_name: 'Nalesnik z kurczakiem i warzywami',
                    category: 'Danie glowne',
                    type: 'MAIN',
                    price_pln: 24,
                },
            ],
            cart: { items: [], total: 0 },
        };

        const response = await handler.execute({
            text: 'zamawiam schab tradycyjny i nalesnik',
            entities: {
                items: [
                    { dish: 'Tradycyjny schabowy', quantity: 2 },
                    { dish: 'Nalesnik z kurczakiem i warzywami', quantity: 3 },
                ],
                dish: 'Tradycyjny schabowy',
            },
            session,
        });

        expect(response.meta?.addedToCart).toBe(false);
        const schab = response.contextUpdates?.pendingOrder?.items?.find((item) => item.id === 'main-schab-tradycyjny');
        const nalesnik = response.contextUpdates?.pendingOrder?.items?.find((item) => item.id === 'main-nalesnik-kurczak');
        expect(schab?.quantity).toBe(1);
        expect(nalesnik?.quantity).toBe(1);
    });

    it('allows ADDON in multi-item batch when same request contains MAIN item', async () => {
        canonicalizeDishMock.mockImplementation((text) => text);

        const session = {
            currentRestaurant: { id: 'R_STARA', name: 'Restauracja Stara Kamienica' },
            lastRestaurant: { id: 'R_STARA', name: 'Restauracja Stara Kamienica' },
            last_menu: [
                {
                    id: 'main-schab-beskidzki',
                    name: 'Schab po beskidzku',
                    base_name: 'Schab po beskidzku',
                    category: 'Danie glowne',
                    type: 'MAIN',
                    price_pln: 39,
                },
                {
                    id: 'addon-pierogi',
                    name: 'Pierogi (ruskie lub z miesem) 6 szt.',
                    base_name: 'Pierogi',
                    category: 'Dodatki',
                    type: 'ADDON',
                    price_pln: 18,
                },
            ],
            cart: { items: [], total: 0 },
        };

        const response = await handler.execute({
            text: 'Schab po beskidzku i pierogi',
            entities: {
                items: [
                    { dish: 'Schab po beskidzku', quantity: 1 },
                    { dish: 'Pierogi (ruskie lub z miesem) 6 szt.', quantity: 1 },
                ],
                dish: 'Schab po beskidzku',
            },
            session,
        });

        expect(response.intent).not.toBe('clarify_order');
        expect(response.meta?.addedToCart).toBe(false);
        expect(response.contextUpdates?.pendingOrder?.items?.length).toBe(2);
        expect(response.contextUpdates?.pendingOrder?.items?.some((item) => item.id === 'main-schab-beskidzki')).toBe(true);
        expect(response.contextUpdates?.pendingOrder?.items?.some((item) => item.id === 'addon-pierogi')).toBe(true);
    });

    it('allows Pierogi ADDON with Lody MAIN in the same add_items_to_cart batch', async () => {
        canonicalizeDishMock.mockImplementation((text) => text);

        const session = {
            currentRestaurant: { id: 'R_STARA', name: 'Restauracja Stara Kamienica' },
            lastRestaurant: { id: 'R_STARA', name: 'Restauracja Stara Kamienica' },
            last_menu: [
                {
                    id: 'addon-pierogi',
                    name: 'Pierogi (ruskie lub z miesem) 6 szt.',
                    base_name: 'Pierogi',
                    category: 'Dodatki',
                    type: 'ADDON',
                    price_pln: 18,
                },
                {
                    id: 'main-lody',
                    name: 'Lody z goracymi malinami i bita smietana',
                    base_name: 'Lody z goracymi malinami i bita smietana',
                    category: 'Deser',
                    price_pln: 18,
                },
            ],
            cart: { items: [], total: 0 },
        };

        const response = await handler.execute({
            text: 'Pierogi i lody',
            entities: {
                items: [
                    { dish: 'Pierogi (ruskie lub z miesem) 6 szt.', quantity: 1 },
                    { dish: 'Lody z goracymi malinami i bita smietana', quantity: 1 },
                ],
                dish: 'Pierogi (ruskie lub z miesem) 6 szt.',
            },
            session,
        });

        expect(response.intent).not.toBe('clarify_order');
        expect(response.meta?.addedToCart).toBe(false);
        expect(response.contextUpdates?.pendingOrder?.items?.length).toBe(2);
        expect(response.contextUpdates?.pendingOrder?.items?.some((item) => item.id === 'addon-pierogi')).toBe(true);
        expect(response.contextUpdates?.pendingOrder?.items?.some((item) => item.id === 'main-lody')).toBe(true);
    });

    it('allows single-item compound quantity drink order without clarify', async () => {
        canonicalizeDishMock.mockImplementation((text) => text);

        const session = {
            currentRestaurant: { id: 'R_DRINK', name: 'Drink Test' },
            lastRestaurant: { id: 'R_DRINK', name: 'Drink Test' },
            last_menu: [
                {
                    id: 'drink-pepsi',
                    name: 'Pepsi',
                    base_name: 'Pepsi',
                    category: 'Napoje',
                    type: 'DRINK',
                    price_pln: 8,
                },
            ],
            cart: { items: [], total: 0 },
        };

        const response = await handler.execute({
            text: '3 Pepsi',
            entities: {
                dish: 'Pepsi',
                items: [{ dish: 'Pepsi', quantity: 3, meta: { rawLabel: 'Pepsi' } }],
                compoundSource: 'compound_parser',
                skipCategoryClarify: true,
                skipGenericTokenBlock: true,
            },
            session,
        });

        expect(response.intent).not.toBe('clarify_order');
        expect(response.meta?.addedToCart).toBe(false);
        expect(response.contextUpdates?.pendingOrder?.items?.[0]?.id).toBe('drink-pepsi');
        expect(response.contextUpdates?.pendingOrder?.items?.[0]?.quantity).toBe(3);
        expect(response.contextUpdates?.expectedContext).toBe('confirm_add_to_cart');
    });

    it('prefers explicit post-dish repetition cue over stale single-qty entity', async () => {
        canonicalizeDishMock.mockImplementation((text) => text);

        const session = {
            currentRestaurant: { id: 'R_DESSERT', name: 'Monte Carlo' },
            lastRestaurant: { id: 'R_DESSERT', name: 'Monte Carlo' },
            last_menu: [
                {
                    id: 'dessert-tiramisu',
                    name: 'Tiramisu',
                    base_name: 'Tiramisu',
                    category: 'Desery',
                    type: 'MAIN',
                    price_pln: 18,
                },
            ],
            cart: { items: [], total: 0 },
        };

        const response = await handler.execute({
            text: 'tiramisu dwa razy',
            entities: {
                dish: 'Tiramisu',
                quantity: 1,
            },
            session,
        });

        expect(response.intent).not.toBe('clarify_order');
        expect(response.meta?.addedToCart).toBe(false);
        expect(response.contextUpdates?.pendingOrder?.items?.[0]?.id).toBe('dessert-tiramisu');
        expect(response.contextUpdates?.pendingOrder?.items?.[0]?.quantity).toBe(2);
    });

    it('grounds a natural spicy-beef paraphrase against the scoped menu when NLU dish is null', async () => {
        canonicalizeDishMock.mockImplementation((text) => text);

        const session = {
            currentRestaurant: { id: 'R_VIEN', name: 'Vien-Thien' },
            lastRestaurant: { id: 'R_VIEN', name: 'Vien-Thien' },
            last_menu: [
                {
                    id: 'beef-five-flavours',
                    name: 'Wołowina 5 smaków',
                    base_name: 'Wołowina 5 smaków',
                    category: 'Wołowina',
                    type: 'MAIN',
                    price_pln: 20,
                    available: true,
                },
                {
                    id: 'beef-spicy',
                    name: 'Wołowina pikantna',
                    base_name: 'Wołowina pikantna',
                    category: 'Wołowina',
                    type: 'MAIN',
                    price_pln: 20,
                    available: true,
                },
            ],
            cart: { items: [], total: 0 },
        };

        const response = await handler.execute({
            text: 'Chciałbym zamówić wołowinę na ostro z Vien-Thien',
            entities: {
                dish: null,
                quantity: 1,
            },
            session,
        });

        expect(response.intent).not.toBe('clarify_order');
        expect(response.meta?.addedToCart).toBe(false);
        expect(response.contextUpdates?.pendingOrder?.items?.[0]?.id).toBe('beef-spicy');
    });

    it('resolves qty_2 pizza when menu item has size suffix (e.g. "33cm")', async () => {
        canonicalizeDishMock.mockImplementation((text) => {
            if (String(text || '').toLowerCase().includes('pizza margherita')) return 'Margherita';
            return text;
        });

        const session = {
            currentRestaurant: { id: 'R_CALLZONE', name: 'Callzone' },
            lastRestaurant: { id: 'R_CALLZONE', name: 'Callzone' },
            last_menu: [
                {
                    id: 'main-callzone-margherita-33',
                    name: 'Pizza Margherita 33cm',
                    base_name: 'Pizza Margherita 33cm',
                    category: 'Pizza',
                    type: 'MAIN',
                    price_pln: 32,
                },
            ],
            cart: { items: [], total: 0 },
        };

        const response = await handler.execute({
            text: 'dwa Pizza Margherita',
            entities: {
                dish: 'Pizza Margherita',
                items: [{ dish: 'Pizza Margherita 33cm', quantity: 2, meta: { rawLabel: 'Pizza Margherita' } }],
                compoundSource: 'compound_parser',
                skipCategoryClarify: true,
                skipGenericTokenBlock: true,
            },
            session,
        });

        expect(response.intent).not.toBe('clarify_order');
        expect(response.meta?.addedToCart).toBe(false);
        expect(response.contextUpdates?.pendingOrder?.items?.[0]?.id).toBe('main-callzone-margherita-33');
        expect(response.contextUpdates?.pendingOrder?.items?.[0]?.quantity).toBe(2);
    });

    it('asks for variant clarification when shared base name matches multiple menu variants', async () => {
        canonicalizeDishMock.mockImplementation((text) => text);

        const session = {
            currentRestaurant: { id: 'R_HUB', name: 'Dwor Hubertus' },
            lastRestaurant: { id: 'R_HUB', name: 'Dwor Hubertus' },
            last_menu: [
                {
                    id: 'main-wodzionka',
                    name: 'Wodzionka',
                    base_name: 'Wodzionka',
                    category: 'Zupy',
                    type: 'MAIN',
                    price_pln: 16,
                },
                {
                    id: 'main-zur-bread',
                    name: 'Zur slaski w chlebie',
                    base_name: 'Zur slaski w chlebie',
                    category: 'Zupy',
                    type: 'MAIN',
                    price_pln: 22,
                },
                {
                    id: 'main-zur-plate',
                    name: 'Zur slaski na talerzu',
                    base_name: 'Zur slaski na talerzu',
                    category: 'Zupy',
                    type: 'MAIN',
                    price_pln: 20,
                },
            ],
            cart: { items: [], total: 0 },
        };

        const response = await handler.execute({
            text: 'Zur slaski',
            entities: { dish: 'Zur slaski' },
            session,
        });

        expect(response.intent).toBe('clarify_order');
        expect(response.meta?.clarify?.clarifyReason).toBe('shared_base_ambiguity');
        expect(response.reply).toContain('Zur slaski w chlebie');
        expect(response.reply).toContain('Zur slaski na talerzu');
        expect(response.contextUpdates?.pendingOrder?.items?.length || 0).toBe(0);
    });

    it('keeps multi-item add unresolved when one item has shared-base ambiguity', async () => {
        canonicalizeDishMock.mockImplementation((text) => text);

        const session = {
            currentRestaurant: { id: 'R_HUB', name: 'Dwor Hubertus' },
            lastRestaurant: { id: 'R_HUB', name: 'Dwor Hubertus' },
            last_menu: [
                {
                    id: 'main-wodzionka',
                    name: 'Wodzionka',
                    base_name: 'Wodzionka',
                    category: 'Zupy',
                    type: 'MAIN',
                    price_pln: 16,
                },
                {
                    id: 'main-zur-bread',
                    name: 'Zur slaski w chlebie',
                    base_name: 'Zur slaski w chlebie',
                    category: 'Zupy',
                    type: 'MAIN',
                    price_pln: 22,
                },
                {
                    id: 'main-zur-plate',
                    name: 'Zur slaski na talerzu',
                    base_name: 'Zur slaski na talerzu',
                    category: 'Zupy',
                    type: 'MAIN',
                    price_pln: 20,
                },
            ],
            cart: { items: [], total: 0 },
        };

        const response = await handler.execute({
            text: 'Wodzionka i Zur slaski',
            entities: {
                dish: 'Wodzionka',
                items: [
                    { dish: 'Wodzionka', quantity: 1 },
                    { dish: 'Zur slaski', quantity: 1 },
                ],
            },
            session,
        });

        expect(response.intent).toBe('clarify_order');
        expect(response.meta?.clarify?.clarifyReason).toBe('shared_base_ambiguity');
        expect(response.reply).toContain('Zur slaski w chlebie');
        expect(response.reply).toContain('Zur slaski na talerzu');
        expect(response.contextUpdates?.pendingOrder?.items?.length || 0).toBe(0);
    });

    it('applies scoped Żurek fallback in Stara Kamienica without addon context', async () => {
        canonicalizeDishMock.mockImplementation((text) => text);

        const session = {
            currentRestaurant: { id: 'R_STARA', name: 'Restauracja Stara Kamienica' },
            lastRestaurant: { id: 'R_STARA', name: 'Restauracja Stara Kamienica' },
            last_menu: [
                {
                    id: 'main-zurek',
                    name: 'Żurek śląski na maślance',
                    base_name: 'Żurek śląski na maślance',
                    category: 'Zupy',
                    type: 'MAIN',
                    price_pln: 22,
                },
                {
                    id: 'main-rosol',
                    name: 'Rosół domowy',
                    base_name: 'Rosół domowy',
                    category: 'Zupy',
                    type: 'MAIN',
                    price_pln: 19,
                },
            ],
            cart: { items: [], total: 0 },
        };

        const response = await handler.execute({
            text: 'żur',
            entities: { dish: 'żur', quantity: 1 },
            session,
        });

        expect(response.intent).not.toBe('clarify_order');
        expect(response.meta?.addedToCart).toBe(false);
        expect(response.contextUpdates?.pendingOrder?.items?.[0]?.id).toBe('main-zurek');
    });

    it('does not fallback to unrelated MAIN dish when requesting pierogi', async () => {
        canonicalizeDishMock.mockImplementation((text) => {
            if (String(text || '').toLowerCase().includes('pierogi')) {
                return 'Pierogi (ruskie lub z miesem) 6 szt.';
            }
            return text;
        });

        const session = {
            currentRestaurant: { id: 'R_STARA', name: 'Restauracja Stara Kamienica' },
            lastRestaurant: { id: 'R_STARA', name: 'Restauracja Stara Kamienica' },
            last_menu: [
                {
                    id: 'main-nalesnik',
                    name: 'Nalesnik z dzemem truskawkowym lub wisniowym',
                    base_name: 'Nalesnik z dzemem truskawkowym lub wisniowym',
                    category: 'Danie glowne',
                    type: 'MAIN',
                    price_pln: 13,
                },
                {
                    id: 'main-jajecznica',
                    name: 'Jajecznica z jaj',
                    base_name: 'Jajecznica z jaj',
                    category: 'Danie glowne',
                    type: 'MAIN',
                    price_pln: 14,
                },
                {
                    id: 'main-schabowy',
                    name: 'Tradycyjny schabowy',
                    base_name: 'Tradycyjny schabowy',
                    category: 'Danie glowne',
                    type: 'MAIN',
                    price_pln: 28,
                },
            ],
            cart: { items: [], total: 0 },
        };

        const response = await handler.execute({
            text: 'domowe pierogi',
            entities: { dish: 'Pierogi (ruskie lub z miesem) 6 szt.' },
            session,
        });

        expect(response.intent).toBe('clarify_order');
        expect(response.meta?.addedToCart).not.toBe(true);
        expect(response.contextUpdates?.pendingOrder?.items?.length || 0).toBe(0);
    });

    it('does not fallback from ice cream cup request to pancakes via shared whipped cream modifiers', async () => {
        canonicalizeDishMock.mockImplementation((text) => text);

        const session = {
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
            cart: { items: [], total: 0 },
        };

        const response = await handler.execute({
            text: 'Puchar lodowy z owocami i bita smietana',
            entities: { dish: 'Puchar lodowy z owocami i bita smietana', quantity: 1 },
            session,
        });

        expect(response.intent).toBe('clarify_order');
        expect(response.meta?.addedToCart).not.toBe(true);
        expect(response.contextUpdates?.pendingOrder?.items?.length || 0).toBe(0);
        expect(session.cart.items.length).toBe(0);
    });

    it('allows specific rich addon phrase without addon context when single candidate exists (pierogi case)', async () => {
        canonicalizeDishMock.mockImplementation((text) => text);

        const session = {
            currentRestaurant: { id: 'R_STARA', name: 'Restauracja Stara Kamienica' },
            lastRestaurant: { id: 'R_STARA', name: 'Restauracja Stara Kamienica' },
            last_menu: [
                {
                    id: 'addon-pierogi',
                    name: 'Pierogi (ruskie lub z miesem) 6 szt.',
                    base_name: 'Pierogi',
                    category: 'Dodatek',
                    type: 'ADDON',
                    price_pln: 13,
                },
            ],
            cart: { items: [], total: 0 },
        };

        const response = await handler.execute({
            text: 'chce zamowic pierogi (ruskie lub z miesem) 6 szt.',
            entities: { dish: 'Pierogi (ruskie lub z miesem) 6 szt.' },
            session,
        });

        expect(response.intent).not.toBe('clarify_order');
        expect(response.meta?.addedToCart).toBe(false);
        expect(response.contextUpdates?.pendingOrder?.items?.[0]?.id).toBe('addon-pierogi');
        expect(response.contextUpdates?.pendingOrder?.items?.[0]?.quantity).toBe(1);
    });

    it('resolves addon by preserved modifier for "2 x sos pikantny"', async () => {
        canonicalizeDishMock.mockImplementation((text) => text);

        const session = {
            currentRestaurant: { id: 'R_ADDON', name: 'Addon Test' },
            lastRestaurant: { id: 'R_ADDON', name: 'Addon Test' },
            last_menu: [
                {
                    id: 'addon-sos-tzatziki',
                    name: 'Sos Tzatziki',
                    base_name: 'Sos Tzatziki',
                    category: 'Dodatki',
                    type: 'ADDON',
                    price_pln: 3,
                },
                {
                    id: 'addon-sos-pikantny',
                    name: 'Sos Pikantny',
                    base_name: 'Sos Pikantny',
                    category: 'Dodatki',
                    type: 'ADDON',
                    price_pln: 3,
                },
            ],
            cart: { items: [], total: 0 },
        };

        const response = await handler.execute({
            text: '2 x sos pikantny',
            entities: {
                dish: 'Sos',
                items: [{ dish: 'Sos', quantity: 2, meta: { rawLabel: 'sos pikantny', modifier: 'pikantny' } }],
                compoundSource: 'compound_parser',
            },
            session,
        });

        expect(response.intent).not.toBe('clarify_order');
        expect(response.meta?.addedToCart).toBe(false);
        expect(response.contextUpdates?.pendingOrder?.items?.[0]?.id).toBe('addon-sos-pikantny');
        expect(response.contextUpdates?.pendingOrder?.items?.[0]?.quantity).toBe(2);
    });

    it('maps "2 razy ostry sos" modifier to pikantny variant and avoids tzatziki fallback', async () => {
        canonicalizeDishMock.mockImplementation((text) => text);

        const session = {
            currentRestaurant: { id: 'R_ADDON', name: 'Addon Test' },
            lastRestaurant: { id: 'R_ADDON', name: 'Addon Test' },
            last_menu: [
                {
                    id: 'addon-sos-tzatziki',
                    name: 'Sos Tzatziki',
                    base_name: 'Sos Tzatziki',
                    category: 'Dodatki',
                    type: 'ADDON',
                    price_pln: 3,
                },
                {
                    id: 'addon-sos-pikantny',
                    name: 'Sos Pikantny',
                    base_name: 'Sos Pikantny',
                    category: 'Dodatki',
                    type: 'ADDON',
                    price_pln: 3,
                },
            ],
            cart: { items: [], total: 0 },
        };

        const response = await handler.execute({
            text: '2 razy ostry sos',
            entities: {
                dish: 'Sos',
                items: [{ dish: 'Sos', quantity: 2, meta: { rawLabel: 'ostry sos', modifier: 'ostry' } }],
                compoundSource: 'compound_parser',
            },
            session,
        });

        expect(response.intent).not.toBe('clarify_order');
        expect(response.meta?.addedToCart).toBe(false);
        expect(response.contextUpdates?.pendingOrder?.items?.[0]?.id).toBe('addon-sos-pikantny');
        expect(response.contextUpdates?.pendingOrder?.items?.[0]?.id).not.toBe('addon-sos-tzatziki');
        expect(response.contextUpdates?.pendingOrder?.items?.[0]?.quantity).toBe(2);
    });

    it('maps "podwojny sos ostry" modifier to pikantny variant', async () => {
        canonicalizeDishMock.mockImplementation((text) => text);

        const session = {
            currentRestaurant: { id: 'R_ADDON', name: 'Addon Test' },
            lastRestaurant: { id: 'R_ADDON', name: 'Addon Test' },
            last_menu: [
                {
                    id: 'addon-sos-tzatziki',
                    name: 'Sos Tzatziki',
                    base_name: 'Sos Tzatziki',
                    category: 'Dodatki',
                    type: 'ADDON',
                    price_pln: 3,
                },
                {
                    id: 'addon-sos-pikantny',
                    name: 'Sos Pikantny',
                    base_name: 'Sos Pikantny',
                    category: 'Dodatki',
                    type: 'ADDON',
                    price_pln: 3,
                },
            ],
            cart: { items: [], total: 0 },
        };

        const response = await handler.execute({
            text: 'podwojny sos ostry',
            entities: {
                dish: 'Sos',
                items: [{ dish: 'Sos', quantity: 2, meta: { rawLabel: 'sos ostry', modifier: 'ostry' } }],
                compoundSource: 'compound_parser',
            },
            session,
        });

        expect(response.intent).not.toBe('clarify_order');
        expect(response.meta?.addedToCart).toBe(false);
        expect(response.contextUpdates?.pendingOrder?.items?.[0]?.id).toBe('addon-sos-pikantny');
        expect(response.contextUpdates?.pendingOrder?.items?.[0]?.quantity).toBe(2);
    });

    it('returns MAIN clarify when ambiguous main candidates are detected', async () => {
        canonicalizeDishMock.mockReturnValue('xx');

        const session = {
            currentRestaurant: { id: 'R_MAIN', name: 'Main Test' },
            lastRestaurant: { id: 'R_MAIN', name: 'Main Test' },
            last_menu: [
                {
                    id: 'main-1',
                    name: 'Baxx Burger',
                    base_name: 'Baxx Burger',
                    category: 'Danie glowne',
                    type: 'MAIN',
                    price_pln: 29,
                },
                {
                    id: 'main-2',
                    name: 'Pizxxa Klasyczna',
                    base_name: 'Pizxxa Klasyczna',
                    category: 'Danie glowne',
                    type: 'MAIN',
                    price_pln: 32,
                },
            ],
            cart: { items: [], total: 0 },
        };

        const response = await handler.execute({
            text: 'xx',
            entities: { dish: 'xx' },
            session,
        });

        expect(response.intent).toBe('clarify_order');
        expect(response.meta?.clarify?.requestedCategory).toBe('MAIN');
        expect(response.reply.toLowerCase()).toContain('danie glowne');
    });

    it('blocks generic addon token in compound-like request and returns ADDON clarify', async () => {
        canonicalizeDishMock.mockImplementation((text) => text);

        const session = {
            currentRestaurant: { id: 'R_ADDON', name: 'Addon Test' },
            lastRestaurant: { id: 'R_ADDON', name: 'Addon Test' },
            last_menu: [
                {
                    id: 'addon-sos',
                    name: 'Sos',
                    base_name: 'Sos',
                    category: 'Dodatki',
                    type: 'ADDON',
                    price_pln: 2,
                },
                {
                    id: 'addon-sos-pikantny',
                    name: 'Sos Pikantny',
                    base_name: 'Sos Pikantny',
                    category: 'Dodatki',
                    type: 'ADDON',
                    price_pln: 3,
                },
            ],
            cart: { items: [], total: 0 },
        };

        const response = await handler.execute({
            text: 'dwa razy sos',
            entities: {
                dish: 'Sos',
                items: [{ dish: 'Sos', quantity: 2 }],
            },
            session,
        });

        expect(response.intent).toBe('clarify_order');
        expect(response.meta?.clarify?.requestedCategory).toBe('ADDON');
        expect(response.contextUpdates?.expectedContext).toBe('clarify_order');
        expect(session.cart.items.length).toBe(0);
    });

    it('returns ADDON clarify for plain "sos" without modifier', async () => {
        canonicalizeDishMock.mockImplementation((text) => text);

        const session = {
            currentRestaurant: { id: 'R_ADDON', name: 'Addon Test' },
            lastRestaurant: { id: 'R_ADDON', name: 'Addon Test' },
            last_menu: [
                {
                    id: 'addon-sos-tzatziki',
                    name: 'Sos Tzatziki',
                    base_name: 'Sos Tzatziki',
                    category: 'Dodatki',
                    type: 'ADDON',
                    price_pln: 3,
                },
                {
                    id: 'addon-sos-pikantny',
                    name: 'Sos Pikantny',
                    base_name: 'Sos Pikantny',
                    category: 'Dodatki',
                    type: 'ADDON',
                    price_pln: 3,
                },
            ],
            cart: { items: [], total: 0 },
        };

        const response = await handler.execute({
            text: 'sos',
            entities: { dish: 'sos' },
            session,
        });

        expect(response.intent).toBe('clarify_order');
        expect(response.meta?.clarify?.requestedCategory).toBe('ADDON');
        expect(response.contextUpdates?.expectedContext).toBe('clarify_order');
        expect(session.cart.items.length).toBe(0);
    });

    it('resolves single-item compound qty2 pizza using resolved candidate dish from parser', async () => {
        canonicalizeDishMock.mockImplementation((text) => {
            if (String(text || '').toLowerCase().includes('pepperoni')) return 'Pizza Pepperoni 33cm';
            return text;
        });

        const session = {
            currentRestaurant: { id: 'R_CALLZONE', name: 'Callzone' },
            lastRestaurant: { id: 'R_CALLZONE', name: 'Callzone' },
            last_menu: [
                {
                    id: 'main-callzone-pepperoni-33',
                    name: 'Pizza Pepperoni 33cm',
                    base_name: 'Pizza Pepperoni',
                    category: 'Pizza',
                    price_pln: 35,
                },
            ],
            cart: { items: [], total: 0 },
        };

        const response = await handler.execute({
            text: 'dwa Pizza Pepperoni',
            entities: {
                dish: 'Pizza Pepperoni',
                items: [{ dish: 'Pizza Pepperoni', quantity: 2, meta: { rawLabel: 'Pizza Pepperoni' } }],
                compoundSource: 'compound_parser',
                skipCategoryClarify: true,
                skipGenericTokenBlock: true,
            },
            session,
        });

        expect(response.intent).not.toBe('clarify_order');
        expect(response.meta?.addedToCart).toBe(false);
        expect(response.contextUpdates?.pendingOrder?.items?.[0]?.id).toBe('main-callzone-pepperoni-33');
        expect(response.contextUpdates?.pendingOrder?.items?.[0]?.quantity).toBe(2);
    });

    it('resolves single-item compound qty1 using parser-resolved main dish instead of raw phrase drift', async () => {
        canonicalizeDishMock.mockImplementation((text) => text);

        const session = {
            currentRestaurant: { id: 'R_STARA', name: 'Restauracja Stara Kamienica' },
            lastRestaurant: { id: 'R_STARA', name: 'Restauracja Stara Kamienica' },
            last_menu: [
                {
                    id: 'main-rolada',
                    name: 'Rolada wołowa (na zamówienie)',
                    base_name: 'Rolada wołowa',
                    category: 'Danie główne',
                    price_pln: 27,
                },
                {
                    id: 'addon-kapusta',
                    name: 'Kapusta modra',
                    base_name: 'Kapusta modra',
                    category: 'Dodatki',
                    price_pln: 8,
                },
            ],
            cart: { items: [], total: 0 },
        };

        const response = await handler.execute({
            text: 'Rolada śląska z kluskami i modrą kapustą',
            entities: {
                dish: 'modrą kapustą',
                items: [{ dish: 'Rolada wołowa', quantity: 1, meta: { rawLabel: 'Rolada śląska z kluskami i modrą kapustą' } }],
                compoundSource: 'compound_parser',
            },
            session,
        });

        expect(response.intent).not.toBe('clarify_order');
        expect(response.meta?.addedToCart).toBe(false);
        expect(response.contextUpdates?.pendingOrder?.items?.[0]?.id).toBe('main-rolada');
    });
});
