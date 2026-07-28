import { describe, expect, it, vi } from 'vitest';
import { ConfirmAddToCartHandler } from '../domains/food/confirmAddToCartHandler.js';

function makePendingSession(overrides = {}) {
    return {
        pendingOrder: {
            restaurant: 'Test Bistro',
            restaurant_id: 'rest-1',
            items: [
                {
                    id: 'menu-1',
                    name: 'Pierogi',
                    price: 13,
                    quantity: 2,
                },
                {
                    id: 'menu-2',
                    name: 'Kompot',
                    price: 7,
                    quantity: 1,
                },
            ],
            total: '33.00',
        },
        expectedContext: 'confirm_add_to_cart',
        cart: { items: [], total: 0 },
        ...overrides,
    };
}

function menuSnapshot(overrides = {}) {
    return [
        {
            id: 'menu-1',
            restaurant_id: 'rest-1',
            name: 'Pierogi',
            price_pln: 13,
            available: true,
            category: 'Dania główne',
            item_tags: ['local'],
            ...overrides.first,
        },
        {
            id: 'menu-2',
            restaurant_id: 'rest-1',
            name: 'Kompot',
            price_pln: 7,
            available: true,
            category: 'Napoje',
            item_tags: ['drink'],
            ...overrides.second,
        },
    ];
}

function services(menu) {
    return {
        getMenuItems: vi.fn(async () => menu),
    };
}

describe('ConfirmAddToCartHandler menu revalidation', () => {
    it('commits the complete grounded draft once after a fresh menu check', async () => {
        const session = makePendingSession();
        const injectedServices = services(menuSnapshot());
        const handler = new ConfirmAddToCartHandler();

        const first = await handler.execute({
            session,
            entities: {},
            sessionId: 'sess-confirm-valid',
            services: injectedServices,
        });
        const second = await handler.execute({
            session,
            entities: {},
            sessionId: 'sess-confirm-valid',
            services: injectedServices,
        });

        expect(injectedServices.getMenuItems).toHaveBeenCalledWith('rest-1', {
            includeUnavailable: true,
            fresh: true,
        });
        expect(first.meta?.source).toBe('confirm_add_to_cart_handler');
        expect(session.cart.items).toEqual([
            expect.objectContaining({ id: 'menu-1', qty: 2, price_pln: 13 }),
            expect.objectContaining({ id: 'menu-2', qty: 1, price_pln: 7 }),
        ]);
        expect(session.cart.total).toBe(33);
        expect(session.pendingOrder).toBeUndefined();
        expect(second.meta?.source).not.toBe('confirm_add_to_cart_handler');
        expect(session.cart.items).toHaveLength(2);
    });

    it('rejects the whole draft when one item became unavailable', async () => {
        const session = makePendingSession();

        const result = await new ConfirmAddToCartHandler().execute({
            session,
            entities: {},
            sessionId: 'sess-confirm-unavailable',
            services: services(menuSnapshot({ second: { available: false } })),
        });

        expect(result.meta).toMatchObject({
            source: 'confirm_add_to_cart_revalidation_rejected',
            reason: 'item_unavailable',
            itemId: 'menu-2',
        });
        expect(session.cart.items).toEqual([]);
        expect(session.pendingOrder).toBeUndefined();
    });

    it('rejects the whole draft when a current price differs', async () => {
        const session = makePendingSession();

        const result = await new ConfirmAddToCartHandler().execute({
            session,
            entities: {},
            sessionId: 'sess-confirm-price',
            services: services(menuSnapshot({ first: { price_pln: 14 } })),
        });

        expect(result.meta).toMatchObject({
            source: 'confirm_add_to_cart_revalidation_rejected',
            reason: 'price_changed',
            itemId: 'menu-1',
        });
        expect(session.cart.items).toEqual([]);
        expect(session.pendingOrder).toBeUndefined();
    });

    it('rejects a menu row belonging to another restaurant', async () => {
        const session = makePendingSession();

        const result = await new ConfirmAddToCartHandler().execute({
            session,
            entities: {},
            sessionId: 'sess-confirm-restaurant',
            services: services(menuSnapshot({ first: { restaurant_id: 'rest-2' } })),
        });

        expect(result.meta).toMatchObject({
            source: 'confirm_add_to_cart_revalidation_rejected',
            reason: 'restaurant_mismatch',
            itemId: 'menu-1',
        });
        expect(session.cart.items).toEqual([]);
        expect(session.pendingOrder).toBeUndefined();
    });

    it('keeps the draft for retry when the fresh menu cannot be loaded', async () => {
        const session = makePendingSession();

        const result = await new ConfirmAddToCartHandler().execute({
            session,
            entities: {},
            sessionId: 'sess-confirm-menu-unavailable',
            services: services([]),
        });

        expect(result.meta?.source).toBe('confirm_add_to_cart_revalidation_unavailable');
        expect(session.cart.items).toEqual([]);
        expect(session.pendingOrder).toBeDefined();
        expect(session.expectedContext).toBe('confirm_add_to_cart');
    });
});
