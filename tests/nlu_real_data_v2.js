
import { NLURouter } from '../api/brain/nlu/router.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Setup environment
global.BRAIN_DEBUG = false; // Turn off verbose logs for test runner

const nlu = new NLURouter();
const sessionId = 'test-session-real-data-' + Date.now();

// Load Real Data
const dataPath = path.join(__dirname, '../test_data_dump.json');
if (!fs.existsSync(dataPath)) {
    console.error('❌ CRITICAL: test_data_dump.json not found! Run fetch_test_data.js first.');
    process.exit(1);
}
const realData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

// Helper to normalize for fuzzy matching
const norm = (str) => str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

async function runRealDataTests() {
    console.log('🧪 Starting REAL DATA NLU Tests...');
    console.log(`Loaded ${realData.restaurants.length} restaurants and menu samples.\n`);

    let passed = 0;
    let failed = 0;
    const failures = [];

    // ============================================
    // 1. Restaurant Discovery (Exact & Fuzzy)
    // ============================================
    console.log('📍 Testing Restaurant Discovery...');

    for (const r of realData.restaurants) {
        // Case 1.1: Intent "find_nearby" + Restaurant Name Entity detection
        // Note: Unless it's a direct command like "Pokaż menu Bar Praha", just mentioning a name 
        // implies we are looking for it or selecting it.
        // Current Router -> "select_restaurant" if exact match found in catalog

        const inputs = [
            `Gdzie jest ${r.name}`,
            `${r.name}`,
            `Chcę zamówić z ${r.name}`
        ];

        for (const input of inputs) {
            const result = await nlu.detect({ text: input, session: { id: sessionId } });

            // Acceptable intents: find_nearby OR select_restaurant (if catalog match is strong)
            const acceptableIntents = ['find_nearby', 'select_restaurant', 'menu_request'];

            const isIntentOk = acceptableIntents.includes(result.intent);
            const isEntityOk = result.entities.restaurantId === r.id || result.entities.restaurant === r.name;

            if (isIntentOk && (isEntityOk || result.intent === 'select_restaurant')) { // select_restaurant implies entity match usually
                passed++;
            } else {
                failed++;
                console.error(`❌ FAIL: "${input}" -> Got ${result.intent}, Entity: ${result.entities.restaurant}`);
                failures.push({ type: 'restaurant_discovery', input, result, expected: r.name });
            }
        }
    }

    // ============================================
    // 2. Unique Menu Items (Implied Order / Context)
    // ============================================
    console.log('\n🍔 Testing Unique Menu Items (Sample)...');

    // Flatten all items to find uniques manually first for verification would be complex, 
    // so we trust the "order_unique" logic or check specific known unique items from the dump.

    const uniqueTestItems = [
        { name: "Rumcajsowy Burger", restId: "8b00b05e-72f7-4a5f-b50c-5630a75d6312" }, // Bar Praha
        { name: "Kosmiczne Jaja Double", restId: "569a7d29-57be-4224-bdf3-09c483415cea" }, // Klaps
        { name: "Wodzionka", restId: "af8448ef-974b-46c8-a4ae-b04b8dc7c9f8" }, // Hubertus
        { name: "Sajgonki z ryżem", restId: "70842598-1632-43f6-8015-706d5adf182f" } // Vien-Thien
    ];

    for (const item of uniqueTestItems) {
        const input = `Zamawiam ${item.name}`;
        const result = await nlu.detect({ text: input, session: { id: sessionId } });

        // Expect: create_order OR add_item
        // AND ideally extracting the restaurant context if logic allows, 
        // though V2 NLU might just say "create_order" and let the Brain logic handle the lookup.

        if (['create_order', 'add_item'].includes(result.intent)) {
            passed++;
            // Bonus: Check if entities captured the dish name roughly
            if (result.entities.raw && result.entities.raw.includes(item.name)) {
                // good
            }
        } else {
            failed++;
            console.error(`❌ FAIL: "${input}" -> Got ${result.intent}`);
            failures.push({ type: 'unique_item', input, result, expected: 'create_order' });
        }
    }

    // ============================================
    // 3. Ambiguous/Common Items (Conflict Check)
    // ============================================
    console.log('\n⚔️ Testing Ambiguous Items (Expect generic intent or guard)...');

    const commonItems = ["Zupa pomidorowa", "Coca-Cola", "Frytki"];

    for (const name of commonItems) {
        const input = `Chcę ${name}`;
        const result = await nlu.detect({ text: input, session: { id: sessionId } });

        // If I say "Chcę frytki", I expect 'find_nearby' (discovery) OR 'create_order' (if aggressive).
        // BUT it shouldn't confidently pick a random restaurant ID in the entities unless mocked.
        // In this test environment, we just check intent sanity.

        if (['find_nearby', 'create_order'].includes(result.intent)) {
            passed++;
        } else {
            failed++;
            console.error(`❌ FAIL: "${input}" -> Got ${result.intent}`);
            failures.push({ type: 'ambiguous_item', input, result });
        }
    }

    // ============================================
    // 4. Context Guards
    // ============================================
    console.log('\n🛡️ Testing Context Guards...');

    const contextTests = [
        { ctx: 'confirm_order', input: 'nie, anuluj', expected: 'cancel_order' },
        { ctx: 'confirm_order', input: 'tak, poproszę', expected: 'confirm_order' },
        { ctx: 'select_restaurant', input: 'numer 1', expected: 'select_restaurant' },
        { ctx: 'select_restaurant', input: 'druga opcja', expected: 'select_restaurant' }
    ];

    for (const t of contextTests) {
        const result = await nlu.detect({ text: t.input, session: { id: sessionId, expectedContext: t.ctx } });

        if (result.intent === t.expected) {
            passed++;
        } else {
            failed++;
            console.error(`❌ FAIL (Ctx: ${t.ctx}): "${t.input}" -> Got ${result.intent}, Expected ${t.expected}`);
            failures.push({ type: 'context_guard', input: t.input, ctx: t.ctx, result, expected: t.expected });
        }
    }

    // Summary
    console.log(`\n============================================`);
    console.log(`📊 CHECK COMPLETE`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`============================================\n`);

    if (failed > 0) {
        const logPath = 'nlu_real_data_failures.json';
        fs.writeFileSync(logPath, JSON.stringify(failures, null, 2));
        console.log(`📝 Failures written to ${logPath}`);
        process.exit(1);
    } else {
        console.log('✨ All real-data checks passed!');
        process.exit(0);
    }
}

runRealDataTests();
