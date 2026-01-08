
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
                        { id: 1, name: 'Zupa Pomidorowa', price_pln: 15, restaurant_id: 'R1', restaurants: { id: 'R1', name: 'Bar Mleczny' } }, // Collision
                        { id: 2, name: 'Zupa Pomidorowa', price_pln: 25, restaurant_id: 'R2', restaurants: { id: 'R2', name: 'Włoska Knajpa' } }, // Collision
                        { id: 3, name: 'Burger Drwala', price_pln: 30, restaurant_id: 'R3', restaurants: { id: 'R3', name: 'Kebab King' } }, // Unique
                        { id: 4, name: 'Frytki', price_pln: 5, restaurant_id: 'R1', restaurants: { id: 'R1', name: 'Bar Mleczny' } },        // Common
                        { id: 5, name: 'Frytki', price_pln: 8, restaurant_id: 'R2', restaurants: { id: 'R2', name: 'Włoska Knajpa' } },      // Common
                        { id: 6, name: 'Frytki', price_pln: 6, restaurant_id: 'R3', restaurants: { id: 'R3', name: 'Kebab King' } }         // Common
                    ],
                    error: null
                }))
            }))
        }
    };
});

describe('Amber NLU Edge Cases (Disambiguation)', () => {
    let handler;

    beforeEach(() => {
        handler = new OrderHandler();
    });

    /**
     * A) DISAMBIGUATION_REQUIRED gdy brak kontekstu i item kolizyjny
     */
    it('Case A: Should require disambiguation for multi-restaurant items without context', async () => {
        const text = "Poproszę frytki"; // Exists in R1, R2, R3

        // Direct Service Check
        const result = await resolveMenuItemConflict(text);
        expect(result.status).toBe(DISAMBIGUATION_RESULT.DISAMBIGUATION_REQUIRED);
        expect(result.candidates.length).toBe(3); // R1, R2, R3

        // Handler Integration Check
        const ctx = { text, session: { lastRestaurant: null } };
        const response = await handler.execute(ctx);

        expect(response.reply).toContain("jest dostępne w:");
        expect(response.contextUpdates.expectedContext).toBe('choose_restaurant');
        expect(response.contextUpdates.pendingDisambiguation).toHaveLength(3);
    });

    /**
     * B) ADD_ITEM gdy kontekst restauracji rozwiązuje konflikt
     * Scenariusz: User jest już w "Włoska Knajpa" (R2) i zamawia "Frytki" (dostępne też w R1, R3).
     */
    it('Case B: Should resolve conflict automatically using session context', async () => {
        const text = "Frytki";
        const session = {
            lastRestaurant: { id: 'R2', name: 'Włoska Knajpa' }
        };

        const result = await resolveMenuItemConflict(text, { restaurant_id: session.lastRestaurant.id });
        expect(result.status).toBe(DISAMBIGUATION_RESULT.ADD_ITEM);
        expect(result.restaurant.id).toBe('R2'); // Should stick to current restaurant

        // Handler Check
        const ctx = { text, session };
        const response = await handler.execute(ctx);

        expect(response.reply).toContain('Włoska Knajpa'); // Should confirm R2
        expect(response.contextUpdates.pendingOrder.restaurant_id).toBe('R2');
    });

    /**
     * C) Multi-item utterance: "X i Y" z mieszanymi (unikalne + kolizyjne)
     * "Burger Drwala" (R3 only) + "Frytki" (R1, R2, R3).
     * 
     * Oczekiwane zachowanie: System widzi konflikt dla "Frytki" i unikalność dla "Drwala".
     * Bezpieczne zachowanie: DISAMBIGUATION_REQUIRED (bo Frytki są niejednoznaczne, a nie mamy logiki grupowania 'best fit').
     * LUB (jeśli poprawimy logikę): ADD_ITEM R3 (bo Drwala wymusza R3, a Frytki też tam są).
     * 
     * Na ten moment testujemy obecne bezpieczne zachowanie: Wykrywa konflikt.
     */
    it('Case C: Should detect mixed ambiguity in multi-item request', async () => {
        const text = "Burger Drwala i Frytki";

        const result = await resolveMenuItemConflict(text);

        // Obecna implementacja nie grupuje "Best Match", więc zobaczy kandydatów z R1, R2, R3 (dla Frytek) i R3 (dla Drwala).
        // Ponieważ są różne restauracje -> DISAMBIGUATION_REQUIRED
        expect(result.status).toBe(DISAMBIGUATION_RESULT.DISAMBIGUATION_REQUIRED);

        // Ensure candidates include R3 (where both exist)
        const hasR3 = result.candidates.some(c => c.restaurant.id === 'R3');
        expect(hasR3).toBe(true);
    });

    /**
     * D) Repair flow: user doprecyzowuje restaurację po pytaniu bota
     * Symulacja:
     * 1. Bot zapytał "Z której restauracji?" (po Case A)
     * 2. NLU wykryło "Z Włoskiej" i ustawiło session.lastRestaurant = R2
     * 3. NLU ponownie wywołuje OrderHandler ("Frytki") z nowym kontekstem
     */
    it('Case D: Should successfully add item after context repair', async () => {
        // Step 1: User clarified restaurant, Session is updated
        const text = "Frytki"; // User repeats or NLU passes the item intent again
        const session = {
            lastRestaurant: { id: 'R2', name: 'Włoska Knajpa' },
            expectedContext: 'choose_restaurant' // Previous state
        };

        // Step 2: Retry execution with context
        const response = await handler.execute({ text, session });

        // Should now succeed (like Case B)
        expect(response.contextUpdates.pendingOrder).toBeDefined();
        expect(response.contextUpdates.pendingOrder.restaurant_id).toBe('R2');
        expect(response.reply).toMatch(/Dodałam .* z Włoska Knajpa/);
    });

});
