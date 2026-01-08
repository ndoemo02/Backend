
import { NLURouter } from '../nlu/router.js';

// Setup Mock Environment
global.BRAIN_DEBUG = true;

const nlu = new NLURouter();

const TEST_CASES = [
    {
        name: "Discovery - Generic",
        text: "Gdzie mogę zjeść coś dobrego?",
        expectedIntent: "find_nearby"
    },
    {
        name: "Discovery - Location",
        text: "Szukam pizzerii w Piekarach",
        expectedIntent: "find_nearby"
    },
    {
        name: "Menu Request - Explicit",
        text: "Pokaż mi menu Hubertusa",
        expectedIntent: "menu_request"
    },
    {
        name: "Selection - Contextual",
        text: "Wybieram opcję 1",
        session: { expectedContext: "select_restaurant" },
        expectedIntent: "select_restaurant"
    },
    {
        name: "Ordering - Lexical",
        text: "Poproszę kebab",
        expectedIntent: "create_order"
    },
    {
        name: "Confirm Order - Contextual",
        text: "Tak, zamawiam",
        session: { expectedContext: "confirm_order" },
        expectedIntent: "confirm_order"
    },
    {
        name: "Discovery - Numerals (Rule 5)",
        text: "Dwa kebaby poproszę", // This might be create_order or find_nearby depending on rules
        expectedIntent: "create_order" // Lexical override should win
    },
    {
        name: "Discovery - More Options",
        text: "Inne opcje",
        session: { lastIntent: "find_nearby" },
        expectedIntent: "show_more_options"
    },
    {
        name: "Selection - By Number",
        text: "Poproszę numer 2",
        session: { expectedContext: "select_restaurant" },
        expectedIntent: "select_restaurant"
    },
    {
        name: "Context Escape - Change Restaurant",
        text: "Zmień na inną",
        session: { context: "IN_RESTAURANT", lockedRestaurantId: "123" },
        expectedIntent: "find_nearby"
    }
];

async function runTests() {
    console.log("🚀 Starting NLU Smoke Tests...\n");
    let passed = 0;
    let failed = 0;

    for (const test of TEST_CASES) {
        process.stdout.write(`Testing: ${test.name.padEnd(30)} | Input: "${test.text}" ... `);

        try {
            const ctx = {
                text: test.text,
                session: test.session || {}
            };

            const result = await nlu.detect(ctx);

            if (result.intent === test.expectedIntent) {
                console.log("✅ PASS");
                passed++;
            } else {
                console.log(`❌ FAIL (Got: ${result.intent}, Expected: ${test.expectedIntent})`);
                console.log(`   Source: ${result.source}`);
                failed++;
            }
        } catch (e) {
            console.log("💥 ERROR");
            console.error(e);
            failed++;
        }
    }

    console.log(`\n📊 Results: ${passed} Passed, ${failed} Failed`);
    process.exit(failed > 0 ? 1 : 0);
}

runTests();
