
import { NLURouter } from '../api/brain/nlu/router.js';
import fs from 'fs';

// Setup environment
global.BRAIN_DEBUG = true;

const nlu = new NLURouter();
const sessionId = 'test-session-1';

const testCases = [
    // ============================================
    // SECTION 1: Discovery / Find Nearby (find_nearby)
    // ============================================

    // 1.1 Explicit discovery keywords
    { input: "co polecisz w Piekarach", checks: { intent: 'find_nearby', domain: 'food' } },
    { input: "szukam fast food", checks: { intent: 'find_nearby', domain: 'food' } },
    { input: "chcę coś zjeść", checks: { intent: 'find_nearby', domain: 'food' } },
    { input: "gdzie tu jest dobra pizzeria", checks: { intent: 'find_nearby', domain: 'food' } },
    { input: "znajdź restauracje w okolicy", checks: { intent: 'find_nearby', domain: 'food' } },
    { input: "jakie są lokale w Piekary Śląskich", checks: { intent: 'find_nearby', domain: 'food' } },
    { input: "pokaż restauracje", checks: { intent: 'find_nearby', domain: 'food' } },

    // 1.2 Location-relative phrases
    { input: "co jest blisko mnie", checks: { intent: 'find_nearby', domain: 'food' } },
    { input: "restauracje w pobliżu", checks: { intent: 'find_nearby', domain: 'food' } },
    { input: "szukam czegoś koło mnie", checks: { intent: 'find_nearby' } },
    { input: "knajpy niedaleko", checks: { intent: 'find_nearby', domain: 'food' } },
    { input: "jakieś jedzenie w okolicy", checks: { intent: 'find_nearby' } },

    // 1.3 Uncertainty / Exploration (should NOT trigger order)
    { input: "kfc chyba", checks: { intent: 'find_nearby' } },
    { input: "może pizza", checks: { intent: 'find_nearby' } },
    { input: "jakiś kebab", checks: { intent: 'find_nearby' } },
    { input: "coś do jedzenia", checks: { intent: 'find_nearby' } },

    // 1.4 Typos and STT artifacts (should NOT match real restaurants)
    { input: "testy king", checks: { intent: 'find_nearby', noRestaurantEntity: true } },
    { input: "casting kebab", checks: { intent: 'find_nearby', noRestaurantEntity: true } },
    { input: "ten burger koło mnie", checks: { intent: 'find_nearby', noRestaurantEntity: true } },
    { input: "dobry baner", checks: { intent: 'find_nearby', noRestaurantEntity: true } },

    // 1.5 Cuisine type queries
    { input: "szukam włoskiej kuchni", checks: { intent: 'find_nearby' } },
    { input: "chcę azjatyckie jedzenie", checks: { intent: 'find_nearby' } },
    { input: "gdzie jest dobra polska kuchnia", checks: { intent: 'find_nearby' } },

    // ============================================
    // SECTION 2: Menu Requests (menu_request)
    // ============================================

    // 2.1 Simple menu requests
    { input: "pokaż menu", checks: { intent: 'menu_request', domain: 'food' } },
    { input: "menu proszę", checks: { intent: 'menu_request' } },
    { input: "karta dań", checks: { intent: 'menu_request' } },
    { input: "co macie w ofercie", checks: { intent: 'menu_request' } },
    { input: "zobacz kartę", checks: { intent: 'menu_request' } },

    // 2.2 Menu with context (order + menu = prioritize menu)
    { input: "chcę zamówić ale najpierw pokaż menu", checks: { intent: 'menu_request' } },
    { input: "zamówię, ale pokaż mi najpierw ofertę", checks: { intent: 'menu_request' } },

    // 2.3 Menu for specific restaurant
    { input: "pokaż menu Hubertusa", checks: { intent: 'menu_request' } },
    { input: "co ma Bar Praha", checks: { intent: 'menu_request' } },

    // ============================================
    // SECTION 3: Orders (create_order)
    // ============================================

    // 3.1 Explicit order verbs
    { input: "zamawiam pizzę margheritę", checks: { intent: 'create_order', domain: 'ordering' } },
    { input: "poproszę dwa burgery", checks: { intent: 'create_order', domain: 'ordering' } },
    { input: "wezmę kebab duży", checks: { intent: 'create_order', domain: 'ordering' } },
    { input: "biorę zupę dnia", checks: { intent: 'create_order', domain: 'ordering' } },
    { input: "dodaj frytki", checks: { intent: 'create_order', domain: 'ordering' } },

    // 3.2 Polish conjugations (odmiana)
    { input: "poproszę o schabowego", checks: { intent: 'create_order' } },
    { input: "wezmę roladzik", checks: { intent: 'create_order' } },
    { input: "zamów mi pierogi", checks: { intent: 'create_order' } },

    // ============================================
    // SECTION 4: Confirm/Cancel (context-dependent)
    // ============================================

    // 4.1 Generic confirm (works with or without context)
    { input: "tak", checks: { intent: 'confirm' } },

    // ============================================
    // SECTION 5: Restaurant Selection (select_restaurant)
    // ============================================

    // 5.1 Exact restaurant name match
    { input: "Hubertus", checks: { intent: 'select_restaurant' } },
    { input: "Bar Praha", checks: { intent: 'select_restaurant' } },
    { input: "Klaps Burgers", checks: { intent: 'select_restaurant' } },
    { input: "Rezydencja", checks: { intent: 'select_restaurant' } },

    // ============================================
    // SECTION 6: Edge Cases / Regressions
    // ============================================

    // 6.1 Mixed signals
    { input: "pizza w Piekarach", checks: { intent: 'find_nearby' } },
    { input: "gdzie zamówić burgera", checks: { intent: 'find_nearby' } },
    { input: "szukam sushi na wynos", checks: { intent: 'find_nearby' } },

    // 6.2 Numbers with food (should be discovery, not order without verb)
    { input: "trzy pizzerie", checks: { intent: 'find_nearby' } },
    { input: "dwa kebaby blisko", checks: { intent: 'find_nearby' } },

    // 6.3 Short/Ambiguous
    { input: "głodny", checks: { intent: 'find_nearby' } },
    { input: "jedzenie", checks: { intent: 'find_nearby' } },

    // 6.4 Polite phrasing
    { input: "czy mogę zobaczyć menu", checks: { intent: 'menu_request' } },
    { input: "czy możesz mi pokazać restauracje", checks: { intent: 'find_nearby' } }
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
