import { describe, it, expect } from 'vitest';
import { ConfirmOrderHandler } from '../domains/food/confirmHandler.js';
import { getSession } from '../session/sessionStore.js';

describe('ConfirmOrderHandler lifecycle reset', () => {
    it('resets restaurant/menu/orderMode context on confirm_order completion', async () => {
        const handler = new ConfirmOrderHandler();
        const sessionId = `sess_test_confirm_reset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        const session = {
            pendingOrder: {
                restaurant_id: 'rest_1',
                restaurant: 'Restauracja Testowa',
                items: [
                    { id: 'dish_1', name: 'Pierogi', price_pln: 13, quantity: 2 },
                ],
            },
            cart: { items: [], total: 0 },
            restaurantContext: { id: 'rest_1', name: 'Restauracja Testowa' },
            currentRestaurant: { id: 'rest_1', name: 'Restauracja Testowa' },
            lastRestaurant: { id: 'rest_1', name: 'Restauracja Testowa' },
            lastMenuItems: [{ id: 'dish_1', name: 'Pierogi' }],
            lastMenu: [{ id: 'dish_1', name: 'Pierogi' }],
            orderMode: 'building',
            conversationPhase: 'ordering',
        };

        const result = await handler.execute({ session, sessionId });

        expect(result.intent).toBe('confirm_order');
        expect(result.conversationClosed).toBe(true);
        expect(result.closedReason).toBe('ORDER_CONFIRMED');
        expect(result.contextUpdates.conversationPhase).toBe('idle');
        expect(result.contextUpdates.orderMode).toBe('neutral');
        expect(result.contextUpdates.currentRestaurant).toBeNull();
        expect(result.contextUpdates.lastRestaurant).toBeNull();
        expect(result.contextUpdates.lastMenuItems).toEqual([]);
        expect(result.contextUpdates.lastMenu).toEqual([]);
        expect(result.meta.orderCompletion).toMatchObject({
            restaurantId: 'rest_1',
            restaurantName: 'Restauracja Testowa',
            itemCount: 1,
            total: 26,
        });

        expect(session.orderMode).toBe('neutral');
        expect(session.currentRestaurant).toBeNull();
        expect(session.lastRestaurant).toBeNull();
        expect(session.lastMenuItems).toEqual([]);
        expect(session.lastMenu).toEqual([]);

        const closedSession = getSession(sessionId);
        expect(closedSession.status).toBe('closed');
        expect(closedSession.closedReason).toBe('ORDER_CONFIRMED');
    });
});
