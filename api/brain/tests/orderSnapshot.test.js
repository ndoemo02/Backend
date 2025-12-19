
import { describe, it, expect } from "vitest";
import { normalizeSize, normalizeExtras } from "../order/variantNormalizer.js";
import { validateOrderItem } from "../order/orderValidator.js";

const MENU = [
    { name: "Pepperoni", sizes: ["medium", "large"], category: "Pizza" }
];

describe("order pipeline snapshot", () => {
    it("creates a normalized and validated order item snapshot", () => {
        const text = "poproszę dużą pepperoni z podwójnym serem";

        const orderItem = {
            name: "Pepperoni",
            size: normalizeSize(text),
            extras: normalizeExtras(text)
        };

        const validation = validateOrderItem(orderItem, MENU);

        expect(validation).toMatchSnapshot();
    });
});
