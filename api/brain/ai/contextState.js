// Unified context state machine for FreeFlow Hybrid Agent

export function getDefault() {
    return {
        // ═══════════════════════════════════════════════════════════════════════════
        // SESSION LIFECYCLE (Conversation Isolation)
        // One conversation = one session_id. Closed sessions cannot be reused.
        // ═══════════════════════════════════════════════════════════════════════════
        status: 'active',           // 'active' | 'closed'
        closedReason: null,         // 'CART_ITEM_ADDED' | 'ORDER_CONFIRMED' | null
        closedAt: null,             // ISO timestamp when closed
        
        // FSM / Dialog State
        expectedContext: "neutral",
        lastIntent: null,
        lastRestaurant: null,
        lastRestaurantsList: [], // Legacy field
        lastRestaurants: [],     // New structured field: { id, name, index, city, cuisine }
        lastRestaurantsTimestamp: null,
        lastMenu: [],
        locationOverride: null,
        history: [],
        
        // Pending state (reset on close)
        pendingDish: null,
        awaiting: null,
        pendingOrder: null
    };
}

export function update(session, patch = {}) {
    // Merge patch into session
    Object.assign(session, patch);

    // Ensure history exists
    if (!session.history) {
        session.history = [];
    }

    return session;
}
