
import { NLURouter } from '../api/brain/nlu/router.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Setup environment
global.BRAIN_DEBUG = false;

const nlu = new NLURouter();
const sessionId = 'mass-test-session-' + Date.now();

// Load Real Data
const dataPath = path.join(__dirname, '../test_data_dump.json');
if (!fs.existsSync(dataPath)) {
    console.error('❌ CRITICAL: test_data_dump.json not found! Run fetch_test_data.js first.');
    process.exit(1);
}
const realData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

async function runMassRestaurantTest() {
    console.log(`🚀 STARTING MASS TEST for ${realData.restaurants.length} restaurants...\n`);

    let totalPassed = 0;
    let totalFailed = 0;
    const allFailures = [];

    for (const restaurant of realData.restaurants) {
        const menuData = realData.menuSamples[restaurant.id];

        if (!menuData || !menuData.items || menuData.items.length === 0) {
            console.log(`⚠️  Skipping ${restaurant.name} (No menu data)`);
            continue;
        }

        console.log(`\n--------------------------------------------`);
        console.log(`🧪 TESTING: ${restaurant.name} (${restaurant.city})`);
        console.log(`📋 Items: ${menuData.items.length}`);

        let localPassed = 0;
        let localFailed = 0;

        // ============================================
        // A. Single Item Tests
        // ============================================
        for (const item of menuData.items) {
            const input = `Zamawiam ${item.name}`;
            const result = await nlu.detect({ text: input, session: { id: sessionId } });

            // Accept generic discovery for common items, but prefer create_order
            const validIntents = ['create_order', 'add_item', 'find_nearby'];

            if (validIntents.includes(result.intent)) {
                localPassed++;
            } else {
                localFailed++;
                console.error(`  ❌ FAIL: "${item.name}" -> Got ${result.intent}`);
                allFailures.push({ restaurant: restaurant.name, input, result });
            }
        }

        // ============================================
        // B. Complex Order
        // ============================================
        if (menuData.items.length >= 2) {
            const comboItems = menuData.items.slice(0, 2);
            const explicitInput = `Zamawiam ${comboItems[0].name} i ${comboItems[1].name} z ${restaurant.name}`;

            const explicitResult = await nlu.detect({ text: explicitInput, session: { id: sessionId } });

            if (explicitResult.intent === 'create_order') {
                localPassed++;
                // console.log(`  ✅ Complex Order OK`);
            } else {
                localFailed++;
                console.error(`  ❌ FAIL COMPLEX: "${explicitInput}" -> Got ${explicitResult.intent}`);
                allFailures.push({ restaurant: restaurant.name, input: explicitInput, result: explicitResult });
            }
        }

        console.log(`  🏁 Result: ${localPassed} Pass / ${localFailed} Fail`);
        totalPassed += localPassed;
        totalFailed += localFailed;
    }

    // ============================================
    // SUMMARY
    // ============================================
    console.log(`\n============================================`);
    console.log(`📊 FINAL RESULTS`);
    console.log(`✅ Total Passed: ${totalPassed}`);
    console.log(`❌ Total Failed: ${totalFailed}`);
    console.log(`============================================\n`);

    if (totalFailed > 0) {
        fs.writeFileSync('mass_failures.json', JSON.stringify(allFailures, null, 2));
        console.log('📝 Failures written to mass_failures.json');
        process.exit(1);
    } else {
        console.log('✨ All restaurants passed!');
        process.exit(0);
    }
}

runMassRestaurantTest();
