/**
 * Food Domain: Confirm Order Handler
 * ═══════════════════════════════════════════════════════════════════════════
 * Odpowiada za finalizację zamówienia i zamknięcie sesji.
 * 
 * WAŻNE: To jest JEDYNE miejsce gdzie zamówienie jest zapisywane do DB.
 * Zapis następuje PO commit do session, PRZED streamem/TTS.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { persistOrderToDB } from '../../services/OrderPersistence.js';

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

        // 2. Capture items descriptions BEFORE commit (which deletes pendingOrder)
        const itemsList = pendingOrder.items.map(i => `${i.quantity || i.qty || 1}x ${i.name}`).join(", ");
        const restaurantId = pendingOrder.restaurant_id;
        const restaurantName = pendingOrder.restaurant;

        // 3. Wykonaj akcję - Commit items to session cart
        const { commitPendingOrder } = await import('../../session/sessionCart.js');
        const commitResult = commitPendingOrder(session);

        if (!commitResult.committed) {
            return {
                reply: "Wystąpił problem przy dodawaniu do koszyka. Spróbuj raz jeszcze.",
            };
        }

        // ═══════════════════════════════════════════════════════════════════
        // 4. PERSIST TO DB - JEDYNY CENTRALNY ZAPIS
        // Wykonuje się PRZED streamem/TTS, synchronicznie
        // ═══════════════════════════════════════════════════════════════════
        let orderId = null;
        try {
            const persistResult = await persistOrderToDB(sessionId, session, {
                restaurant_id: restaurantId,
                restaurant_name: restaurantName
            });

            if (persistResult.success) {
                orderId = persistResult.order_id;
                console.log(`✅ Order persisted to DB: ${orderId}${persistResult.skipped ? ' (idempotent)' : ''}`);
            } else {
                console.error(`⚠️ Order persist failed: ${persistResult.error}`);
                // Kontynuuj mimo błędu - użytkownik dostanie odpowiedź
            }
        } catch (persistError) {
            console.error(`🔥 Order persist exception:`, persistError.message);
            // Nie blokuj odpowiedzi - loguj błąd i kontynuuj
        }

        // 5. Budowanie odpowiedzi
        const intro = `Dodano do koszyka. `;
        const closing = `Coś jeszcze?`;
        const reply = `${intro}${closing}`;

        return {
            reply,
            closing_question: "Coś jeszcze?",
            should_reply: true,
            intent: 'confirm_order',
            // Order ID z DB
            order_id: orderId,
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
                order_id: orderId,
                transaction_status: 'success',
                persisted: !!orderId,
                source: 'confirm_handler'
            },
            contextUpdates: {
                pendingOrder: null,        // Wyczyść tymczasowy bufor
                expectedContext: null,     // Koniec flow potwierdzania
                lastIntent: 'order_complete',
                lastOrderId: orderId       // Zapisz ID zamówienia w sesji
            }
        };
    }
}
