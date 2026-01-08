/**
 * Food Domain: Confirm Add to Cart
 * Mikro-akcja potwierdzająca dodanie do koszyka.
 * 
 * Korekta 2: Czyści TYLKO pendingDish, nie resetuje innych stanów.
 */

export class ConfirmAddToCartHandler {
    async execute(ctx) {
        const { session, entities, resolvedRestaurant } = ctx;

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

        return {
            reply: `Dodano ${dish} z ${restaurantName} do koszyka. Coś jeszcze?`,
            should_reply: true,
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
            // Korekta 2: TYLKO pendingDish - mikro-akcja, nie reset
            // NIE zmieniaj: currentRestaurant, cart, awaiting
            contextUpdates: {
                pendingDish: null,
                expectedContext: 'continue_order' // Ready for next item
            },
            meta: { source: 'confirm_add_to_cart_handler' }
        };
    }
}
