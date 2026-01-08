
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
const FAILURES_LOG_PATH = path.join(__dirname, '../disambiguation_failures.json');

// Tools
const nlu = new NLURouter();
const sessionId = 'disambiguation-test';

// Main Test Runner
async function runDisambiguationTests() {
    console.log('🧪 Starting NLU Conflict Disambiguation Tests...');

    // 1. Load Data
    if (!fs.existsSync(TEST_DATA_PATH)) {
        console.error(`❌ Missing data file: ${TEST_DATA_PATH}`);
        process.exit(1);
    }
    const data = JSON.parse(fs.readFileSync(TEST_DATA_PATH, 'utf8'));

    // 2. Identify Conflicts (Dishes appearing in >1 Restaurant)
    console.log('🔍 Analyzing data for conflicts...');

    const dishMap = new Map(); // Name -> Set<RestaurantID>

    for (const r of data.restaurants) {
        const menuData = data.menuSamples[r.id];
        if (!menuData || !menuData.items) continue;

        for (const item of menuData.items) {
            if (!item.name) continue;
            const normName = item.name.toLowerCase().trim();

            if (!dishMap.has(normName)) {
                dishMap.set(normName, new Set());
            }
            dishMap.get(normName).add(r.id);
        }
    }

    const conflicts = [];
    for (const [name, restSet] of dishMap.entries()) {
        if (restSet.size > 1) {
            conflicts.push({ name, count: restSet.size });
        }
    }

    console.log(`📋 Found ${conflicts.length} conflicting dish names.`);
    if (conflicts.length === 0) {
        console.log('⚠️ No conflicts found to test. Exiting.');
        process.exit(0);
    }

    const report = {
        totalTests: 0,
        passed: 0,
        failed: 0,
        failures: []
    };

    // 3. Run Deterministic Tests
    for (const conflict of conflicts) {
        report.totalTests++;

        // Input: "Zamawiam {dish_name}" WITHOUT restaurant
        // This input triggers the "Lexical Override" for "Zamawiam", 
        // BUT for a conflicting item, we want to ensure it DOES NOT pick a restaurant blindly.
        // The prompt requirements are STRICT: "NIE WOLNO: zwrócić create_order".
        // This implies "Zamawiam frytki" should ideally result in 'find_nearby' (to show options)
        // or asking for clarification, NOT assuming an order can be created yet.

        // Note: Currently, my NLU might return 'create_order' because of the strong verb "Zamawiam".
        // This test will reveal if that logic violates the "Safe Disambiguation" requirement.

        const input = `Zamawiam ${conflict.name}`;

        try {
            const result = await nlu.detect({ text: input, session: { id: sessionId } });

            // STRICT ASSERTIONS per User Request

            // 1. Check Intent: Must NOT be 'create_order' or 'add_item'
            // The logic: If I say "Order Fries" and there are 5 places, starting an order flow 
            // is ambiguous. Better to 'find_nearby' (show list of places with fries).
            const forbiddenIntents = ['create_order', 'add_item'];
            if (forbiddenIntents.includes(result.intent)) {
                // EXCEPTION: If the intent is create_order BUT it successfully detected it needs clarification
                // (e.g. domain is system?). But NLU usually returns food/ordering domain.

                // Let's implement the strict fail first.
                throw new Error(`Unsafe Intent: Got '${result.intent}' for ambiguous item '${conflict.name}'. Expected 'find_nearby', 'unknown', or clarification intent.`);
            }

            // 2. Check Entity: Must NOT pick a specific restaurant
            if (result.entities.restaurantId || result.entities.restaurant) {
                throw new Error(`Unsafe Guess: System picked restaurant '${result.entities.restaurant}' for ambiguous item.`);
            }

            // If we are here -> PASS (e.g. intent is find_nearby, unknown, etc.)
            // console.log(`   ✅ PASS: "${input}" -> ${result.intent}`);
            report.passed++;

        } catch (err) {
            report.failed++;
            console.error(`   ❌ FAIL: "${input}" -> ${err.message}`);
            report.failures.push({
                dish: conflict.name,
                input,
                error: err.message
            });
        }
    }

    // 4. Final Report
    console.log(`\n============================================`);
    console.log(`📊 DISAMBIGUATION REPORT`);
    console.log(`Total Conflicts Tested: ${report.totalTests}`);
    console.log(`✅ Passed (Safe): ${report.passed}`);
    console.log(`❌ Failed (Unsafe): ${report.failed}`);
    console.log(`============================================\n`);

    if (report.failed > 0) {
        fs.writeFileSync(FAILURES_LOG_PATH, JSON.stringify(report.failures, null, 2));
        console.log(`📝 Detailed failures written to: ${FAILURES_LOG_PATH}`);
        process.exit(1);
    } else {
        console.log(`✨ System matches strict safety standards for disambiguation.`);
        process.exit(0);
    }
}

runDisambiguationTests();
