import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('OrderHandler pending confirmation contract', () => {
    let handler;

    beforeEach(() => {
        handler = new OrderHandler();
        resolveMenuItemConflictMock.mockClear();
        canonicalizeDishMock.mockImplementation((text) => text);
    });

    it('prepares a grounded item without mutating the cart', async () => {
        const session = {
            currentRestaurant: { id: 'R_DEMO', name: 'Demo Bistro' },
            lastRestaurant: { id: 'R_DEMO', name: 'Demo Bistro' },
            last_menu: [{
                id: 'dish-1',
                name: 'Pierogi ruskie',
                base_name: 'Pierogi ruskie',
                category: 'Dania glowne',
                type: 'MAIN',
                price_pln: 24,
            }],
            cart: { items: [], total: 0 },
        };

        const response = await handler.execute({
            text: 'dodaj dwa pierogi ruskie',
            entities: { dish: 'Pierogi ruskie', quantity: 2 },
            session,
        });

        expect(session.cart.items).toEqual([]);
        expect(session.pendingOrder).toMatchObject({
            restaurant_id: 'R_DEMO',
            total: '48.00',
            items: [{ id: 'dish-1', quantity: 2 }],
        });
        expect(session.expectedContext).toBe('confirm_add_to_cart');
        expect(response.meta).toMatchObject({
            source: 'order_handler_pending',
            addedToCart: false,
            focusedMenuItemId: 'dish-1',
        });
        expect(response.contextUpdates.pendingOrder).toEqual(session.pendingOrder);
    });

    it('rejects the entire multi-item draft when one requested item is missing', async () => {
        const session = {
            currentRestaurant: { id: 'R_DEMO', name: 'Demo Bistro' },
            lastRestaurant: { id: 'R_DEMO', name: 'Demo Bistro' },
            last_menu: [{
                id: 'dish-1',
                name: 'Pierogi ruskie',
                base_name: 'Pierogi ruskie',
                category: 'Dania glowne',
                type: 'MAIN',
                price_pln: 24,
            }],
            cart: { items: [], total: 0 },
        };

        const response = await handler.execute({
            text: 'dodaj pierogi ruskie i lemoniade',
            entities: {
                dish: 'Pierogi ruskie',
                items: [
                    { dish: 'Pierogi ruskie', quantity: 1 },
                    { dish: 'Lemoniada', quantity: 1 },
                ],
            },
            session,
        });

        expect(response.intent).toBe('clarify_order');
        expect(response.meta?.clarify?.unresolvedItems).toContain('Lemoniada');
        expect(session.cart.items).toEqual([]);
        expect(session.pendingOrder).toBeUndefined();
    });
});
