
import { describe, it, expect, beforeAll } from 'vitest';
import { pipeline } from '../brainV2.js';
import dotenv from 'dotenv';
import { RESTAURANT_CATALOG } from '../data/restaurantCatalog.js';

dotenv.config();

// Helper to keep session state between steps
let sessionState = {
    id: `test_sess_${Date.now()}`,
    data: {}
};

// Mock updater to simulate session persistence in memory
// In real app, Pipeline calls updateSession which writes to global store.
// Since pipeline uses 'getSession', we need to make sure the global store is updated 
// OR we mock the session store.
// For integration tests, it's better to let the pipeline work, but since we are running in a test process
// we might need to rely on the fact that pipeline.js imports `sessionStore.js`.
// Let's assume sessionStore uses an in-memory Map by default (common in this project).

describe('Brain V2 Migration - Cascade Tests', () => {

    it('Scenario A: Discovery Flow (Find Restaurants)', async () => {
        const input = "Gdzie zjem coś dobrego w Piekarach Śląskich?";
        const result = await pipeline.process(sessionState.id, input);

        console.log('A Result:', result.reply);

        expect(result.intent).toBe('find_nearby');
        expect(result.restaurants).toBeDefined();
        expect(Array.isArray(result.restaurants)).toBe(true);
        expect(result.restaurants.length).toBeGreaterThan(0);

        // Context Check
        // Note: pipeline.js updates session implicitly
        // We can check the response payload which often mirrors context updates in V2
        // or check sessionStore if accessible. 
    });

    it('Scenario B: Menu Request (Direct w/ Name)', async () => {
        // "Pokaż menu w Hubertusie" -> Should use Catalog ID and skip search
        const hubertus = RESTAURANT_CATALOG.find(r => r.name.includes('Hubertus'));
        expect(hubertus).toBeDefined();

        const input = "Pokaż menu w Hubertusie";
        const result = await pipeline.process(sessionState.id, input);

        console.log('B Result:', result.reply);

        expect(result.intent).toBe('menu_request'); // or show_menu
        expect(result.menu).toBeDefined();
        expect(result.menu.length).toBeGreaterThan(0);

        // Crucial V2 Optimization Check
        // Did we verify it used ID? Hard to verify internals, but speed/latency would show.
    });

    it('Scenario C: Order Creation (Items Parsing)', async () => {
        // "Zamawiam dwa kebaby" -> Should default to context-locked restaurant (Hubertus? or fall back)
        // Note: Hubertus might not have kebabs. Let's try something from their menu or generic.
        // Or switch context: "Zamawiam Kebab u Pajdy" (Example)

        // Let's stick to the flow. Assuming we are in Hubertus context from Step B.
        // User says: "Poproszę roladę z kluskami" (Likely item in Hubertus)
        // Or generic: "Zamawiam colę"

        const input = "Zamawiam dwie rolady wołowe";
        const result = await pipeline.process(sessionState.id, input);

        console.log('C Result:', result.reply);

        expect(result.intent).toBe('create_order');
        expect(result.reply).toContain("Dodałam");
        expect(result.reply).toContain("rolady");

        // BUG FIX VERIFICATION:
        // Ensure NO restaurant list is sent back
        expect(result.restaurants).toBeDefined();
        expect(result.restaurants).toHaveLength(0); // MUST BE EMPTY
    });

    it('Scenario D: Confirmation (Frontend Contract)', async () => {
        const input = "Potwierdzam";
        const result = await pipeline.process(sessionState.id, input);

        console.log('D Result:', result.reply);

        expect(result.intent).toBe('confirm_order');
        expect(result.meta).toBeDefined();
        expect(result.meta.addedToCart).toBe(true);
        expect(result.meta.cart).toBeDefined();
        expect(result.meta.transaction_status).toBe('success');
    });

});
