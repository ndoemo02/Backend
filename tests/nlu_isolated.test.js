
import { NLURouter } from '../api/brain/nlu/router.js';
import fs from 'fs';

// Setup environment
global.BRAIN_DEBUG = true;

const nlu = new NLURouter();
const sessionId = 'test-session-1';

const testCases = [
    // Test 1.1 Pure Intents
    {
        input: "co polecisz w Piekarach",
        checks: { intent: 'find_nearby', domain: 'food' }
    },
    {
        input: "szukam fast food",
        checks: { intent: 'find_nearby', domain: 'food' }
    },
    {
        input: "chcę coś zjeść",
        checks: { intent: 'find_nearby', domain: 'food' }
    },
    {
        input: "pokaż menu",
        checks: { intent: 'menu_request', domain: 'food' }
    },
    // Test 1.2 Edge cases
    {
        input: "testy king",
        checks: { intent: 'find_nearby', noRestaurantEntity: true }
    },
    {
        input: "casting kebab",
        checks: { intent: 'find_nearby', noRestaurantEntity: true }
    },
    {
        input: "kfc chyba",
        checks: { intent: 'find_nearby' }
    },
    {
        input: "ten burger koło mnie",
        checks: { intent: 'find_nearby', noRestaurantEntity: true }
    },
    // Test 1.3 Conflict
    {
        input: "chcę zamówić ale najpierw pokaż menu",
        checks: { intent: 'menu_request' }
    }
];

async function runTests() {
    console.log('🧪 Starting ETAP 1 - NLU Isolated Tests\n');
    let passed = 0;
    let failed = 0;
    const failureDetails = [];

    for (const tc of testCases) {
        const ctx = { text: tc.input, session: { id: sessionId } };
        try {
            const result = await nlu.detect(ctx);

            let failReason = null;
            if (tc.checks.intent && result.intent !== tc.checks.intent) {
                failReason = `Expected intent '${tc.checks.intent}', got '${result.intent}'`;
            }
            if (tc.checks.domain && result.domain !== tc.checks.domain) {
                failReason = `Expected domain '${tc.checks.domain}', got '${result.domain}'`;
            }
            if (tc.checks.notIntent && result.intent === tc.checks.notIntent) {
                failReason = `Did not expect intent '${tc.checks.notIntent}'`;
            }
            if (tc.checks.noRestaurantEntity) {
                const r = result.entities?.restaurant;
                if (r && (r.name || r.id)) {
                    failReason = `Expected NO restaurant entity, got '${r.name}'`;
                }
            }

            if (failReason) {
                console.error(`❌ FAIL: "${tc.input}" -> ${failReason}`);
                failureDetails.push({ input: tc.input, error: failReason, result });
                failed++;
            } else {
                console.log(`✅ PASS: "${tc.input}" -> ${result.intent} (${result.domain})`);
                passed++;
            }
        } catch (e) {
            console.error(`💥 ERROR: "${tc.input}" ->`, e);
            failureDetails.push({ input: tc.input, error: e.message });
            failed++;
        }
    }

    console.log(`\nResults: ${passed} Passed, ${failed} Failed.`);
    fs.writeFileSync('nlu_test_results.json', JSON.stringify({ passed, failed, failureDetails }, null, 2));

    if (failed > 0) process.exit(1);
}

runTests();
