
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveMenuItemConflict, DISAMBIGUATION_RESULT } from '../services/DisambiguationService.js';
import { OrderHandler } from '../domains/food/orderHandler.js';

// Mock Supabase globally
vi.mock('../../_supabase.js', () => {
    return {
        supabase: {
            from: vi.fn(() => ({
                select: vi.fn(() => Promise.resolve({
                    data: [
                        { id: 1, name: 'Zupa Pomidorowa', price_pln: 15, restaurant_id: 'R1', restaurants: { id: 'R1', name: 'Bar Mleczny' } },
                        { id: 2, name: 'Zupa Pomidorowa', price_pln: 25, restaurant_id: 'R2', restaurants: { id: 'R2', name: 'Włoska Knajpa' } },
                        { id: 3, name: 'Coca Cola', price_pln: 5, restaurant_id: 'R1', restaurants: { id: 'R1', name: 'Bar Mleczny' } },
                        { id: 4, name: 'Coca Cola', price_pln: 8, restaurant_id: 'R3', restaurants: { id: 'R3', name: 'Kebab King' } },
                        { id: 5, name: 'Burger Drwala', price_pln: 30, restaurant_id: 'R3', restaurants: { id: 'R3', name: 'Kebab King' } }
                    ],
                    error: null
                }))
            }))
        }
    };
});

describe('DisambiguationService - Deterministic Conflict Resolution', () => {

    it('should return ITEM_NOT_FOUND for unknown dishes', async () => {
        const result = await resolveMenuItemConflict('Kawior');
        expect(result.status).toBe(DISAMBIGUATION_RESULT.ITEM_NOT_FOUND);
    });

    it('should return ADD_ITEM for unique dish', async () => {
        const result = await resolveMenuItemConflict('Burger Drwala');
        expect(result.status).toBe(DISAMBIGUATION_RESULT.ADD_ITEM);
        expect(result.item.name).toBe('Burger Drwala');
        expect(result.restaurant.name).toBe('Kebab King');
    });

    it('should return DISAMBIGUATION_REQUIRED for multi-match without context', async () => {
        // "Zupa Pomidorowa" is in R1 and R2
        const result = await resolveMenuItemConflict('Zupa Pomidorowa');
        expect(result.status).toBe(DISAMBIGUATION_RESULT.DISAMBIGUATION_REQUIRED);
        expect(result.candidates.length).toBe(2); // R1 and R2 groups
    });

    it('should Auto-Resolve using Context (Priority 1)', async () => {
        // User is currently ordering from R2 (Włoska Knajpa)
        // They say "pomidorowa" -> should pick R2 version automatically
        const result = await resolveMenuItemConflict('Zupa Pomidorowa', { restaurant_id: 'R2' });

        expect(result.status).toBe(DISAMBIGUATION_RESULT.ADD_ITEM);
        expect(result.item.restaurant_id).toBe('R2');
        expect(result.item.price_pln).toBe(25); // Premium price
    });
});

describe('OrderHandler Integration', () => {
    let handler;

    beforeEach(() => {
        handler = new OrderHandler();
    });

    it('should ask clarification when Disambiguation is required', async () => {
        const ctx = {
            text: "Poproszę zupę pomidorową",
            session: { lastRestaurant: null } // No context
        };

        const response = await handler.execute(ctx);

        expect(response.reply).toContain("dostępne w: Bar Mleczny, Włoska Knajpa");
        expect(response.contextUpdates.expectedContext).toBe('choose_restaurant');
        expect(response.contextUpdates.pendingDisambiguation).toBeDefined();
    });

    it('should Auto-Switch context if unique item found elsewhere', async () => {
        const ctx = {
            text: "Burger Drwala",
            session: { lastRestaurant: { id: 'R1', name: 'Bar Mleczny' } } // User was at Bar Mleczny
        };

        // Burger Drwala is ONLY at Kebab King (R3)
        const response = await handler.execute(ctx);

        // Should detect R3 item and auto-switch
        expect(response.reply).toContain('Kebab King'); // Mentions new place
        expect(response.contextUpdates.lastRestaurant.id).toBe('R3');
        expect(response.contextUpdates.pendingOrder.total).toBe("30.00");
    });
});
