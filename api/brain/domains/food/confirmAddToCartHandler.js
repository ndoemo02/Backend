/**
 * Food Domain: Confirm Add to Cart
 *
 * CART AUTHORITY: the backend is the only writer of session.cart.
 * A pending order is revalidated as one atomic draft before it is committed.
 */

import { getMenuItems } from '../../menuService.js';
import { validatePendingOrderAgainstMenu } from '../../order/pendingOrderValidation.js';
import { commitPendingOrder } from '../../session/sessionCart.js';

const ORDER_FLOW_ANCHOR_REPLY =
    'Co dalej — chcesz zobaczyć więcej dań czy przejść do zamówienia?';

function rejectStaleDraft(session, validation) {
    delete session.pendingOrder;
    session.expectedContext = 'create_order';

    const priceChanged = validation.reason === 'price_changed';
    return {
        reply: priceChanged
            ? 'Cena jednej z pozycji uległa zmianie. Niczego nie dodałam — wybierz ją ponownie, żebym podała aktualną sumę.'
            : 'Jedna z pozycji nie jest już dostępna w tym menu. Niczego nie dodałam — wybierz zamówienie ponownie.',
        should_reply: true,
        conversationClosed: false,
        contextUpdates: {
            pendingOrder: null,
            expectedContext: 'create_order',
            cart: session.cart,
        },
        meta: {
            source: 'confirm_add_to_cart_revalidation_rejected',
            reason: validation.reason,
            itemId: validation.itemId || null,
            cart: session.cart,
        },
    };
}

export class ConfirmAddToCartHandler {
    async execute(ctx) {
        const { session, entities } = ctx;
        const pendingOrder = session?.pendingOrder;

        if (!pendingOrder || !Array.isArray(pendingOrder.items) || pendingOrder.items.length === 0) {
            const dish = entities?.dish || session?.pendingDish;
            return {
                reply: dish
                    ? 'Nie widzę zamówienia oczekującego na potwierdzenie. Powtórz proszę, co mam przygotować.'
                    : 'Co chcesz dodać do koszyka?',
                contextUpdates: { expectedContext: 'create_order' },
                meta: {
                    source: 'confirm_add_to_cart_missing_pending',
                    cart: session?.cart,
                },
            };
        }

        const restaurantName = pendingOrder.restaurant || 'restauracji';
        const restaurantId = pendingOrder.restaurant_id;
        const focusedMenuItemId =
            pendingOrder.items[0]?.id || pendingOrder.items[0]?.menu_item_id || null;

        const cartRestaurantId =
            session?.cart?.items?.[0]?.restaurant_id || session?.cart?.restaurantId || null;
        if (
            Array.isArray(session?.cart?.items) &&
            session.cart.items.length > 0 &&
            cartRestaurantId &&
            String(cartRestaurantId) !== String(restaurantId)
        ) {
            return rejectStaleDraft(session, {
                reason: 'cart_restaurant_mismatch',
                itemId: focusedMenuItemId,
            });
        }

        const menuLoader = ctx?.services?.getMenuItems || getMenuItems;
        let currentMenu = [];
        try {
            currentMenu = await menuLoader(restaurantId, {
                includeUnavailable: true,
                fresh: true,
            });
        } catch (error) {
            console.warn(
                '[CONFIRM_CART_REVALIDATION] menu load failed',
                error?.message || error
            );
        }

        if (!Array.isArray(currentMenu) || currentMenu.length === 0) {
            session.expectedContext = 'confirm_add_to_cart';
            return {
                reply: 'Nie mogę teraz potwierdzić aktualnego menu. Koszyk pozostał bez zmian — spróbuj potwierdzić za chwilę.',
                should_reply: true,
                conversationClosed: false,
                contextUpdates: {
                    pendingOrder,
                    expectedContext: 'confirm_add_to_cart',
                    cart: session.cart,
                },
                meta: {
                    source: 'confirm_add_to_cart_revalidation_unavailable',
                    reason: 'menu_unavailable',
                    cart: session.cart,
                    focusedMenuItemId,
                },
            };
        }

        const validation = validatePendingOrderAgainstMenu(pendingOrder, currentMenu);
        if (!validation.valid) {
            return rejectStaleDraft(session, validation);
        }

        session.pendingOrder = {
            ...pendingOrder,
            items: validation.items,
            total: validation.total.toFixed(2),
        };

        const commitResult = commitPendingOrder(session);
        if (!commitResult.committed) {
            return {
                reply: 'Wystąpił problem przy dodawaniu do koszyka. Spróbuj raz jeszcze.',
                contextUpdates: { expectedContext: 'confirm_add_to_cart' },
                meta: {
                    source: 'confirm_add_to_cart_commit_failed',
                    cart: session.cart,
                    focusedMenuItemId,
                },
            };
        }

        session.expectedContext = null;
        if (!session.meta) session.meta = {};
        session.meta.lastCartMutation = {
            name: validation.items[0]?.name || 'pozycja',
            quantity: validation.items[0]?.quantity || 1,
            category: validation.items[0]?.category || null,
            items: validation.items.map((item) => ({
                id: item.id,
                name: item.name,
                quantity: item.quantity,
            })),
        };

        const totalPieces = validation.items.reduce(
            (sum, item) => sum + Number(item.quantity || 1),
            0
        );
        const addedSummary =
            validation.items.length === 1
                ? `${validation.items[0].quantity} × ${validation.items[0].name}`
                : `${validation.items.length} pozycje (${totalPieces} szt.)`;

        return {
            reply: `Dodano ${addedSummary} z ${restaurantName} do koszyka. ${ORDER_FLOW_ANCHOR_REPLY}`,
            should_reply: true,
            conversationClosed: false,
            actions: [
                {
                    type: 'SHOW_CART',
                    payload: { mode: 'badge' },
                },
            ],
            contextUpdates: {
                pendingOrder: null,
                pendingDish: null,
                expectedContext: null,
                conversationPhase: 'ordering',
                cart: session.cart,
            },
            meta: {
                source: 'confirm_add_to_cart_handler',
                conversationClosed: false,
                cart: session.cart,
                restaurant: { name: restaurantName, id: restaurantId },
                focusedMenuItemId: validation.items[0]?.id || focusedMenuItemId,
            },
        };
    }
}
