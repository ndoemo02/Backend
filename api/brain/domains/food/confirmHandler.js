/**
 * Food Domain: Confirm Order Handler
 * Odpowiada za finalizację zamówienia i zamknięcie sesji.
 */

export class ConfirmOrderHandler {

    async execute(ctx) {
        const { session, sessionId } = ctx;
        console.log("🧠 ConfirmOrderHandler executing...");

        // 1. Walidacja: Czy mamy co potwierdzać?
        const pendingOrder = session?.pendingOrder;

        if (!pendingOrder || !pendingOrder.items || pendingOrder.items.length === 0) {
            return {
                reply: "Ale Twój koszyk jest pusty. Co dodać do zamówienia?",
                contextUpdates: { expectedContext: 'menu_or_order' }
            };
        }

        // 2. Wykonaj akcję - Commit items to session cart
        // We need to import commitPendingOrder or implement similar logic.
        // For V2 consistency, we'll implement it here using session utilities.
        const { commitPendingOrder } = await import('../../session/sessionCart.js');
        const commitResult = commitPendingOrder(session);

        if (!commitResult.committed) {
            return {
                reply: "Wystąpił problem przy dodawaniu do koszyka. Spróbuj raz jeszcze.",
            };
        }

        // 3. Budowanie odpowiedzi (Cascading Contract: SHOW_CART)
        const intro = `Dodano do koszyka: ${itemsList}.`;
        const closing = `Razem mamy ${session.cart?.total ?? 0} zł. Coś jeszcze?`;
        const reply = `${intro}\n${closing}`;

        return {
            reply,
            closing_question: "Coś jeszcze?",
            should_reply: true,
            intent: 'confirm_order',
            // Actions for Frontend (Task 2)
            actions: [
                {
                    type: "SHOW_CART",
                    payload: { mode: "summary" }
                }
            ],
            // Data for items visibility
            meta: {
                addedToCart: true,
                cart: session.cart,
                source: 'confirm_handler'
            },
            contextUpdates: {
                pendingOrder: null,        // Wyczyść tymczasowy bufor
                expectedContext: null,     // Koniec flow potwierdzania
                lastIntent: 'order_complete'
            }
        };
    }
}
