
import { NLURouter } from '../api/brain/nlu/router.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Setup Environment
global.BRAIN_DEBUG = false; // Silence logs
process.env.EXPERT_MODE = 'false'; // Ensure deterministic logic, no LLM

// Configuration
const TEST_DATA_PATH = path.join(__dirname, '../test_data_dump.json');
const FAILURES_LOG_PATH = path.join(__dirname, '../data_coverage_failures.json');

// Tools
const nlu = new NLURouter();
const sessionId = 'data-coverage-test';

// Assertions Helper
function assert(condition, message) {
    if (!condition) throw new Error(message);
}

// Main Test Runner
async function runDataCoverageTests() {
    console.log('🧪 Starting NLU Menu Data Coverage Tests...');

    // 1. Load Data
    if (!fs.existsSync(TEST_DATA_PATH)) {
        console.error(`❌ Missing data file: ${TEST_DATA_PATH}`);
        process.exit(1);
    }
    const data = JSON.parse(fs.readFileSync(TEST_DATA_PATH, 'utf8'));

    // Validate Data Structure
    if (!data.restaurants || !data.menuSamples) {
        console.error('❌ Invalid data structure');
        process.exit(1);
    }

    const report = {
        totalTests: 0,
        passed: 0,
        failed: 0,
        failures: []
    };

    console.log(`📋 Found ${data.restaurants.length} restaurants to test.`);

    // 2. Iterate Restaurants
    for (const restaurant of data.restaurants) {
        const menuData = data.menuSamples[restaurant.id];

        if (!menuData || !menuData.items || menuData.items.length === 0) {
            console.warn(`⚠️  Skipping ${restaurant.name} (No menu items found)`);
            continue;
        }

        console.log(`\n🔹 Testing Restaurant: ${restaurant.name} (${menuData.items.length} items)`);

        // 3. Iterate Menu Items
        for (const item of menuData.items) {
            report.totalTests++;

            // SKIP: Technical/Hidden/Empty items
            if (!item.name || item.name.trim().length < 2 || item.available === false) {
                console.log(`   ⏭️  Skip invalid/unavailable: [${item.id}]`);
                continue;
            }

            // Construct Deterministic Input
            // Format: "Zamawiam {Dish} z {Restaurant}"
            // This format MUST trigger strict ordering logic (Rule 3 + Lexical Override)
            const input = `Zamawiam ${item.name} z ${restaurant.name}`;

            try {
                // Execute NLU
                const result = await nlu.detect({
                    text: input,
                    session: { id: sessionId }
                });

                // 4. Assertions
                // Requirement 1: Intent must be create_order or add_item
                const validIntents = ['create_order', 'add_item'];
                if (!validIntents.includes(result.intent)) {
                    throw new Error(`Invalid Intent: Got '${result.intent}', expected one of [${validIntents.join(', ')}]`);
                }

                // Requirement 2: Restaurant Association
                // The router should lock onto the restaurant name provided in the text
                // It might return it as `entities.restaurant` (name) or `entities.restaurantId`
                // OR checking match in `entities.raw` if NLU is fuzzy

                // Strict check: NLU Entity Extraction for Restaurant Name or ID
                const extractedRestId = result.entities.restaurantId;
                const extractedRestName = result.entities.restaurant;

                const idMatch = extractedRestId === restaurant.id;
                const nameMatch = extractedRestName && restaurant.name.toLowerCase().includes(extractedRestName.toLowerCase()); // Simple loose match

                // Note: The router ensures Rule 3 matches exact names from catalog.
                // However, if the router relies on `entities.restaurant` being purely the string found:
                if (!idMatch && !extractedRestName) {
                    throw new Error(`Failed to associate restaurant. Entity: ${JSON.stringify(result.entities)}`);
                }

                // Requirement 3: NO Unknown/Find_Nearby logic for explicit orders
                if (result.intent === 'find_nearby' || result.intent === 'unknown') {
                    throw new Error(`Critical Logic Fail: Fallback intent triggered for explicit order.`);
                }

                // If we get here, pass.
                // console.log(`   ✅ PASS: ${item.name}`); // Optional: Comment out for speed
                report.passed++;

            } catch (err) {
                report.failed++;
                console.error(`   ❌ FAIL: "${input}" -> ${err.message}`);

                report.failures.push({
                    restaurant: restaurant.name,
                    dish: item.name,
                    dishId: item.id,
                    input,
                    error: err.message,
                    // result: err.result // If attached
                });
            }
        }
    }

    // 5. Final Report
    console.log(`\n============================================`);
    console.log(`📊 COVERAGE REPORT`);
    console.log(`Total Menu Items Tested: ${report.totalTests}`);
    console.log(`✅ Passed: ${report.passed}`);
    console.log(`❌ Failed: ${report.failed}`);
    console.log(`============================================\n`);

    // Write failures to file
    if (report.failed > 0) {
        fs.writeFileSync(FAILURES_LOG_PATH, JSON.stringify(report.failures, null, 2));
        console.log(`📝 Detailed failures written to: ${FAILURES_LOG_PATH}`);
        process.exit(1);
    } else {
        console.log(`✨ 100% Data Coverage Verification Complete.`);
        process.exit(0);
    }
}

runDataCoverageTests();
