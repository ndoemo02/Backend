// Unified context state machine for FreeFlow Hybrid Agent

export function getDefault() {
    return {
        expectedContext: "neutral",
        lastIntent: null,
        lastRestaurant: null,
        lastRestaurantsList: [], // Legacy field
        lastRestaurants: [],     // New structured field: { id, name, index, city, cuisine }
        lastRestaurantsTimestamp: null,
        lastMenu: [],
        locationOverride: null,
        history: []
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
