/**
 * Food Domain: Confirm Order Handler
 * Odpowiada za finalizację zamówienia i zamknięcie sesji.
 */

export class ConfirmOrderHandler {

    async execute(ctx) {
        const { session } = ctx;
        console.log("🧠 ConfirmOrderHandler executing...");

        // 1. Walidacja: Czy mamy co potwierdzać?
        const pendingOrder = session?.pendingOrder;

        if (!pendingOrder || !pendingOrder.items || pendingOrder.items.length === 0) {
            return {
                reply: "Ale Twój koszyk jest pusty. Co dodać do zamówienia?",
                contextUpdates: { expectedContext: 'menu_or_order' }
            };
        }

        // 2. Finalizacja (Mock: Zapis do bazy / integracja POS)
        // W produkcji tutaj byłoby: await createOrderInDb(pendingOrder);
        const orderId = `ORD-${Date.now().toString(36).toUpperCase()}`;
        console.log(`✅ Order finalized: ${orderId} for ${pendingOrder.total} PLN`);

        // 3. Budowanie odpowiedzi
        const reply = `Przyjęłam zamówienie nr ${orderId}. Do zapłaty ${pendingOrder.total} zł. Dziękujemy i smacznego!`;

        // 4. ZAMKNIĘCIE SESJI (Kill Switch)
        return {
            reply,
            contextUpdates: {
                status: 'COMPLETED',       // Flaga dla guarda
                closedAt: Date.now(),
                locked: true,              // Dodatkowe, jeśli guard używa 'locked'
                pendingOrder: null,        // Wyczyść koszyk
                lastOrder: {               // Historia (opcjonalnie)
                    id: orderId,
                    total: pendingOrder.total,
                    items: pendingOrder.items
                },
                // Czyścimy kontekst operacyjny
                expectedContext: null,
                context: 'neutral'
            },
            meta: {
                order_id: orderId,
                transaction_status: 'success',
                source: 'logic'
            }
        };
    }
}
