function stableItemId(item) {
    return item?.id || item?.menu_item_id || null;
}

function priceInCents(item) {
    const value = Number(item?.price_pln ?? item?.price);
    return Number.isFinite(value) ? Math.round(value * 100) : null;
}

export function validatePendingOrderAgainstMenu(pendingOrder, menu) {
    const restaurantId = pendingOrder?.restaurant_id;
    const pendingItems = Array.isArray(pendingOrder?.items) ? pendingOrder.items : [];
    const currentMenu = Array.isArray(menu) ? menu : [];

    if (!restaurantId || pendingItems.length === 0) {
        return { valid: false, reason: 'pending_order_invalid', itemId: null };
    }

    const menuById = new Map(
        currentMenu
            .map((item) => [stableItemId(item), item])
            .filter(([id]) => Boolean(id))
    );
    const refreshedItems = [];

    for (const pendingItem of pendingItems) {
        const itemId = stableItemId(pendingItem);
        if (!itemId) {
            return { valid: false, reason: 'item_id_missing', itemId: null };
        }

        const currentItem = menuById.get(itemId);
        if (!currentItem) {
            return { valid: false, reason: 'item_missing', itemId };
        }

        if (
            currentItem.restaurant_id &&
            String(currentItem.restaurant_id) !== String(restaurantId)
        ) {
            return { valid: false, reason: 'restaurant_mismatch', itemId };
        }

        if (currentItem.available === false) {
            return { valid: false, reason: 'item_unavailable', itemId };
        }

        const pendingPrice = priceInCents(pendingItem);
        const currentPrice = priceInCents(currentItem);
        if (pendingPrice === null || currentPrice === null || pendingPrice !== currentPrice) {
            return { valid: false, reason: 'price_changed', itemId };
        }

        const quantity = Math.max(
            1,
            Math.floor(Number(pendingItem.quantity ?? pendingItem.qty ?? 1) || 1)
        );
        refreshedItems.push({
            ...pendingItem,
            id: itemId,
            name: currentItem.name || pendingItem.name,
            price: Number(currentItem.price_pln ?? currentItem.price),
            price_pln: Number(currentItem.price_pln ?? currentItem.price),
            quantity,
            category: currentItem.category ?? pendingItem.category ?? null,
            item_tags: Array.isArray(currentItem.item_tags)
                ? currentItem.item_tags
                : (pendingItem.item_tags || []),
            dietary_flags: Array.isArray(currentItem.dietary_flags)
                ? currentItem.dietary_flags
                : (pendingItem.dietary_flags || []),
            restaurant_id: restaurantId,
        });
    }

    const total = refreshedItems.reduce(
        (sum, item) => sum + Number(item.price_pln) * Number(item.quantity),
        0
    );

    return {
        valid: true,
        items: refreshedItems,
        total: Number(total.toFixed(2)),
    };
}
