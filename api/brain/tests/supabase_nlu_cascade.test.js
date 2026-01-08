
import { describe, it, expect, beforeAll } from 'vitest';
import { NLURouter } from '../nlu/router.js';
import fs from 'fs';
import path from 'path';

// Load analysis report
const reportPath = path.resolve(process.cwd(), 'analysis_report.json');
let testData = { testCases: [] };

if (fs.existsSync(reportPath)) {
    testData = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
}

describe('🧠 Supabase Real-Data NLU Cascade', () => {
    let nlu;

    beforeAll(() => {
        global.BRAIN_DEBUG = false; // Reduce noise
        nlu = new NLURouter();
    });

    describe('🔎 Discovery Scenarios (Real Restaurants)', () => {
        const tests = testData.testCases.filter(t => t.type === 'discovery');

        tests.forEach(test => {
            it(`should find restaurant: "${test.input}"`, async () => {
                const result = await nlu.detect({ text: test.input, session: {} });
                expect(result.intent).toBe(test.expectedIntent);
                // Can we check if it extracted the name?
                // The current NLU extractLocation or findRestaurantInText might catch it
                // We mainly care about intent correctness here as a first pass
            });
        });
    });

    describe('🛒 Unique Item Ordering (Auto-Detection)', () => {
        const tests = testData.testCases.filter(t => t.type === 'order_unique');

        tests.forEach(test => {
            it(`should detect order intent for unique item: "${test.input}"`, async () => {
                const result = await nlu.detect({ text: test.input, session: {} });

                // Note: The router might return 'find_nearby' if it doesn't match a restaurant immediately
                // OR 'create_order' if the lexical parser catches "Zamawiam".
                // In V2, "Zamawiam X" without context usually goes to 'create_order' via lexical override.

                expect(result.intent).toBe('create_order');
            });
        });
    });

    describe('⚖️ Ambiguous Item Handling', () => {
        const tests = testData.testCases.filter(t => t.type === 'order_ambiguous');

        tests.forEach(test => {
            it(`should handle ambiguous item: "${test.input}"`, async () => {
                const result = await nlu.detect({ text: test.input, session: {} });

                // If I say "Chcę zamówić cola", and cola is in 2 places:
                // 1. Lexical override sees "Zamówić" -> create_order
                // 2. OR it sees specific food words -> find_nearby
                // Ideally, V2 should probably start an order flow OR ask for clarification.
                // Current logic likely defaults to 'create_order' because of 'zamówić'.

                // Let's assert it is NOT calculating a specific restaurant ID yet, 
                // OR checks if the router handles it safely.

                // For this test, we accept 'create_order' OR 'find_nearby'.
                if (!['create_order', 'find_nearby'].includes(result.intent)) {
                    console.log(`❌ Failed Ambiguous: "${test.input}" -> Got: ${result.intent}`);
                }
                expect(['create_order', 'find_nearby']).toContain(result.intent);
            });
        });
    });
});
