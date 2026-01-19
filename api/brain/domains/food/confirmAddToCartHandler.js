/**
 * Food Domain: Confirm Add to Cart
 * Mikro-akcja potwierdzająca dodanie do koszyka.
 * 
 * CONVERSATION BOUNDARY: This handler CLOSES the conversation.
 * After adding an item to cart, the next input starts a new session.
 */

import { closeConversation } from '../../session/sessionStore.js';

export class ConfirmAddToCartHandler {
    async execute(ctx) {
        const { session, entities, resolvedRestaurant, sessionId } = ctx;

        // Priority: utterance dish > session pendingDish
        const dish = entities?.dish || session?.pendingDish;
        const restaurant = resolvedRestaurant || session?.currentRestaurant;

        // Validation
        if (!dish) {
            return {
                reply: "Co chcesz dodać do koszyka?",
                contextUpdates: { expectedContext: 'create_order' }
            };
        }

        if (!restaurant) {
            return {
                reply: `Chcesz dodać ${dish}, ale z jakiej restauracji? Podaj nazwę.`,
                contextUpdates: {
                    pendingDish: dish,
                    expectedContext: 'select_restaurant'
                }
            };
        }

        const restaurantName = typeof restaurant === 'string'
            ? restaurant
            : restaurant.name || 'restauracji';

        // ═══════════════════════════════════════════════════════════════════
        // CONVERSATION BOUNDARY: Close this conversation after adding item
        // ═══════════════════════════════════════════════════════════════════
        const closureResult = closeConversation(sessionId, 'CART_ITEM_ADDED');
        console.log(`🔒 Conversation closed (item added). Next session: ${closureResult.newSessionId}`);

        return {
            reply: `Dodano ${dish} z ${restaurantName} do koszyka. Coś jeszcze?`,
            should_reply: true,
            // NEW: Session lifecycle info for frontend
            conversationClosed: true,
            newSessionId: closureResult.newSessionId,
            closedReason: 'CART_ITEM_ADDED',
            actions: [
                {
                    type: 'add_to_cart',
                    payload: {
                        dish,
                        restaurant: typeof restaurant === 'object' ? restaurant : { name: restaurant },
                        quantity: entities?.quantity || 1
                    }
                }
            ],
            // NOTE: contextUpdates are now irrelevant as session is closed
            // But we keep them for backward compatibility
            contextUpdates: {
                pendingDish: null,
                expectedContext: null
            },
            meta: { 
                source: 'confirm_add_to_cart_handler',
                conversationClosed: true
            }
        };
    }
}
