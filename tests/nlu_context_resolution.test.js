
import { NLURouter } from '../api/brain/nlu/router.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Setup Environment
global.BRAIN_DEBUG = false; // Silence logs
process.env.EXPERT_MODE = 'false'; // Ensure deterministic logic

// Configuration
const TEST_DATA_PATH = path.join(__dirname, '../test_data_dump.json');
const FAILURES_LOG_PATH = path.join(__dirname, '../context_resolution_failures.json');

// Tools
const nlu = new NLURouter();

// Main Test Runner
async function runContextResolutionTests() {
    console.log('🧪 Starting NLU Context Resolution (Multi-turn) Tests...');

    // 1. Load Data
    if (!fs.existsSync(TEST_DATA_PATH)) {
        console.error(`❌ Missing data file: ${TEST_DATA_PATH}`);
        process.exit(1);
    }
    const data = JSON.parse(fs.readFileSync(TEST_DATA_PATH, 'utf8'));

    // 2. Identify Conflicts (Dishes appearing in >1 Restaurant)
    console.log('🔍 Identifying ambiguous dishes for testing...');

    // Map: DishName -> List of {RestaurantName, RestaurantID}
    const dishMap = new Map();

    for (const r of data.restaurants) {
        const menuData = data.menuSamples[r.id];
        if (!menuData || !menuData.items) continue;

        for (const item of menuData.items) {
            if (!item.name) continue;
            const normName = item.name.toLowerCase().trim();

            if (!dishMap.has(normName)) {
                dishMap.set(normName, []);
            }
            dishMap.get(normName).push({ name: r.name, id: r.id });
        }
    }

    const conflicts = [];
    for (const [name, restList] of dishMap.entries()) {
        if (restList.length > 1) {
            conflicts.push({ name, candidates: restList });
        }
    }

    console.log(`📋 Found ${conflicts.length} ambiguous dishes suited for multi-turn tests.`);
    if (conflicts.length === 0) {
        console.log('⚠️ No conflicts found. Exiting.');
        process.exit(0);
    }

    const report = {
        totalTests: 0,
        passed: 0,
        failed: 0,
        failures: []
    };

    // 3. Run Multi-turn Tests
    for (const conflict of conflicts) {
        // We only need to test one valid resolution path per conflict to verify the logic works.
        // Pick the first candidate restaurant.
        const targetRestaurant = conflict.candidates[0];

        report.totalTests++;
        const sessionId = `ctx-test-${conflict.name.replace(/\s+/g, '-')}-${Date.now()}`;

        // Simulating persistent session object (like the real pipeline does generally)
        // Note: The router itself is stateless but accepts a session object. 
        // We need to pass the updated session back in Turn 2 if the router modifies it, 
        // OR manually manage the context state that the router expects (e.g. expectedContext).

        // However, standard NLU router might not mutate the session object directly in `detect`.
        // It returns intents/entities. The PIPELINE usually updates the session.
        // Since we are unit testing the ROUTER, we must simulates what the pipeline would do after Turn 1.

        // Scenario:
        // Turn 1: "Zamawiam {dish}" -> Router: find_nearby (because ambiguous)
        // Pipeline Action: See ambiguous intent -> Ask user "Which restaurant?" -> Set expectedContext='select_restaurant'
        // Turn 2: "{RestaurantName}" -> Router: select_restaurant (with context lock) OR create_order (if smart enough)

        // TURN 1
        const input1 = `Zamawiam ${conflict.name}`;
        let session = { id: sessionId }; // Start fresh

        try {
            const result1 = await nlu.detect({ text: input1, session });

            // TURN 1 ASSERTIONS (Safety Check)
            if (['create_order', 'add_item'].includes(result1.intent)) {
                // But wait! If we have recently fixed the router to NOT return create_order for ambiguous items without context,
                // this should now correctly return find_nearby/unknown.
                throw new Error(`TURN 1 FAIL: Unsafe intent '${result1.intent}' for ambiguous '${conflict.name}' (NO Context)`);
            }

            // SIMULATE PIPELINE STATE UPDATE
            // If result was safe (e.g. find_nearby), the system would ask "Where from?"
            // We simulate the user state implicitly by expecting the router to handle the restaurant name in Turn 2.

            // To properly test "Context Resolution", we should pass the previous intention or state
            // that hints we are looking for a restaurant.
            session.lastIntent = result1.intent;
            session.expectedContext = 'select_restaurant'; // Simulate we asked the user to select

            // TURN 2
            const input2 = targetRestaurant.name; // e.g. "Bar Praha"
            const result2 = await nlu.detect({ text: input2, session });

            // TURN 2 ASSERTIONS (Resolution Check)
            // Expectation: 
            // 1. Intent should be 'select_restaurant' (most likely) OR 'create_order' (if very smart)
            // 2. Entity MUST contain the valid restaurant

            if (!['select_restaurant', 'create_order', 'add_item'].includes(result2.intent)) {
                throw new Error(`TURN 2 FAIL: Expected resolution (select/order), got '${result2.intent}' for input '${input2}'`);
            }

            const rID = result2.entities.restaurantId;
            const rName = result2.entities.restaurant;

            const matchID = rID === targetRestaurant.id;
            const matchName = rName && targetRestaurant.name.toLowerCase().includes(rName.toLowerCase());

            if (!matchID && !matchName) {
                throw new Error(`TURN 2 FAIL: Failed to identify restaurant '${targetRestaurant.name}'. Got: ${JSON.stringify(result2.entities)}`);
            }

            // Both turns successful
            // console.log(`   ✅ PASS: ${conflict.name} -> (Safety OK) -> ${targetRestaurant.name} (Resolved)`);
            report.passed++;

        } catch (err) {
            report.failed++;
            console.error(`   ❌ FAIL: [${conflict.name}] -> ${err.message}`);
            report.failures.push({
                dish: conflict.name,
                targetRestaurant: targetRestaurant.name,
                error: err.message
            });
        }
    }

    // 4. Final Report
    console.log(`\n============================================`);
    console.log(`📊 CONTEXT RESOLUTION REPORT`);
    console.log(`Total Scenarios: ${report.totalTests}`);
    console.log(`✅ Passed: ${report.passed}`);
    console.log(`❌ Failed: ${report.failed}`);
    console.log(`============================================\n`);

    if (report.failed > 0) {
        fs.writeFileSync(FAILURES_LOG_PATH, JSON.stringify(report.failures, null, 2));
        console.log(`📝 Detailed failures written to: ${FAILURES_LOG_PATH}`);
        process.exit(1);
    } else {
        console.log(`✨ System correctly resolves context in multi-turn conversation.`);
        process.exit(0);
    }
}

runContextResolutionTests();
