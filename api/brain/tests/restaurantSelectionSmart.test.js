
import { describe, it, expect, vi } from "vitest";
import { resolveRestaurantSelectionHybrid } from "../restaurant/restaurantSelectionSmart.js";

const MOCK_SESSION = {
    lastRestaurants: [
        { id: 1, name: "Stara Kamienica", index: 1 },
        { id: 2, name: "Rezydencja", index: 2 },
        { id: 3, name: "Klaps Burgers", index: 3 },
        { id: 4, name: "Vien-Thien", index: 4 }
    ]
};

describe("resolveRestaurantSelectionHybrid", () => {
    it("selects by ordinal 'druga'", async () => {
        const result = await resolveRestaurantSelectionHybrid({ userText: "biorę drugą", sessionContext: MOCK_SESSION });
        expect(result.restaurant).toBeDefined();
        expect(result.restaurant.name).toBe("Rezydencja");
        expect(result.method).toBeDefined();
    });

    it("selects by fuzzy name 'rezydencji'", async () => {
        const result = await resolveRestaurantSelectionHybrid({ userText: "coś z rezydencji", sessionContext: MOCK_SESSION });
        expect(result.restaurant).toBeDefined();
        expect(result.restaurant.name).toBe("Rezydencja");
    });

    it("selects by fuzzy nickname 'klapsa'", async () => {
        const result = await resolveRestaurantSelectionHybrid({ userText: "daj coś z klapsa", sessionContext: MOCK_SESSION });
        expect(result.restaurant).toBeDefined();
        expect(result.restaurant.name).toBe("Klaps Burgers");
    });

    it("returns null when no context available", async () => {
        const result = await resolveRestaurantSelectionHybrid({ userText: "biorę drugą", sessionContext: {} });
        expect(result.restaurant).toBeNull();
        expect(result.method).toBe("none");
    });
});
