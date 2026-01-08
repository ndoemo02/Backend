
import { BrainPipeline } from '../api/brain/core/pipeline.js';
import { NLURouter } from '../api/brain/nlu/router.js';
import { InMemoryRestaurantRepository } from '../api/brain/core/repository.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Setup Environment
global.BRAIN_DEBUG = false;
process.env.EXPERT_MODE = 'false';

// Configuration
const TEST_DATA_PATH = path.join(__dirname, '../test_data_dump.json');

// INIT DATA for In-Memory Repo
if (!fs.existsSync(TEST_DATA_PATH)) {
    console.error("❌ Test Data Dump not found!");
    process.exit(1);
}
const testData = JSON.parse(fs.readFileSync(TEST_DATA_PATH, 'utf8'));

// Initialize Components with In-Memory Repository
const nlu = new NLURouter();
const repository = new InMemoryRestaurantRepository(testData);
const pipeline = new BrainPipeline({ nlu, repository });

async function runPipelineFlowTests() {
    console.log('🧪 Starting Pipeline Context Flow Tests (In-Memory Repository)...');

    // 1. Setup Test Data (Identify Conflict from Dump)
    const dishMap = new Map();
    for (const r of testData.restaurants) {
        if (!testData.menuSamples[r.id]) continue;
        for (const item of testData.menuSamples[r.id].items) {
            const norm = item.name.toLowerCase().trim();
            if (!dishMap.has(norm)) dishMap.set(norm, []);
            dishMap.get(norm).push(r);
        }
    }

    let conflict = null;
    for (const [name, list] of dishMap.entries()) {
        if (list.length > 1) {
            conflict = { name, candidates: list };
            break;
        }
    }

    if (!conflict) {
        console.error('⚠️ No ambiguous dishes found in dump. Skipping test.');
        process.exit(0);
    }

    // Force known working phrase if needed, or stick to dumped name
    // Assuming dump has "Pizza Margherita" or similar common item.
    // We will use conflict.name directly.

    // Choose target
    const targetRestaurant = conflict.candidates[0];
    const sessionId = `pipe-mem-${Date.now()}`;
    const report = { passed: 0, failed: 0 };

    console.log(`📋 Scenario: Ambiguous "${conflict.name}" (Active in Memory: ${conflict.candidates.length} places)`);

    try {
        // ===========================================
        // TURN 0: Pre-set Location
        // Use explicit search intent to guarantee FindHandler execution and session update
        // ===========================================
        const city = targetRestaurant.city; // e.g. "Piekary Śląskie"
        const input0 = `Szukam jedzenia w ${city}`;
        console.log(`\n🗣️  Turn 0: "${input0}"`);
        await pipeline.process(sessionId, input0, {});

        // ===========================================
        // TURN 1: Ambiguous Dish
        // Use "Szukam" to assist NLU intent detection AND regex dish extraction
        // ===========================================
        const input1 = `Szukam ${conflict.name}`; // e.g. "Gdzie mają Pizza Margherita"
        console.log(`🗣️  Turn 1: "${input1}"`);
        const result1 = await pipeline.process(sessionId, input1, {});

        console.log(`🤖 Reply 1: "${result1.reply}"`);
        console.log(`[DEBUG] T1 Result Keys:`, Object.keys(result1));
        console.log(`[DEBUG] T1 Intent: ${result1.intent} / Domain: ${result1.domain}`);
        console.log(`[DEBUG] T1 Restaurants: ${result1.restaurants ? result1.restaurants.length : 'N/A'}`);

        // Check Repo Results
        if (!result1.restaurants || result1.restaurants.length === 0) {
            console.warn("⚠️ T1 Warning: 0 restaurants found. Proceeding to checking T2 recovery...");
        } else {
            console.log(`✅ T1: Found ${result1.restaurants.length} restaurants via Memory.`);
        }

        // DEBUG SESSION STATE
        // Note: pipeline instance doesn't expose sessionStore publicly in my last edit?
        // Actually BrainPipeline usually has it. Let's try to access or just rely on handler return if possible.
        // But better: use the return value 'result1.contextUpdates' if available in test scope? 
        // Standard pipeline.process returns the handler response merged/processed. 

        // Let's rely on internal knowledge or add a getter if needed. 
        // Or assume pipeline.sessionStore is available (it usually is if using standard pipeline class).
        if (pipeline.sessionStore) {
            const sess = await pipeline.sessionStore.get(sessionId);
            console.log('🔍 Session after T1:', JSON.stringify(sess, null, 2));
        }

        // ===========================================
        // TURN 2: Selection
        // ===========================================
        const input2 = targetRestaurant.name;
        console.log(`🗣️  Turn 2: "${input2}"`);
        const result2 = await pipeline.process(sessionId, input2, {});

        console.log(`🤖 Reply 2: "${result2.reply}"`);

        // Verify Auto-Order
        const orderAction = result2.actions ? result2.actions.find(a => a.type === 'create_order') : null;
        if (!orderAction) {
            throw new Error("T2 Fail: No order action created. PendingDish logic might differ in execution path.");
        }

        const payload = orderAction.payload;
        if (payload.restaurant_id !== targetRestaurant.id) {
            throw new Error(`T2 Fail: Restaurant ID mismatch (Got ${payload.restaurant_id}, Wanted ${targetRestaurant.id})`);
        }

        // Verify Item Name
        const orderedItem = payload.items[0].name;
        // Loose check for item name preservation
        if (!orderedItem.toLowerCase().includes(conflict.name.toLowerCase())) {
            console.warn(`⚠️ Item name changed significantly? "${conflict.name}" -> "${orderedItem}"`);
        }

        console.log(`✅ PASS: Pipeline successfully bridged context using In-Memory Repository.`);
        report.passed++;

    } catch (err) {
        report.failed++;
        console.error(`❌ FAIL: ${err.message}`);
    }

    console.log(`\n📊 REPORT: ${report.passed} Pass / ${report.failed} Fail`);
    if (report.failed > 0) process.exit(1);
}

runPipelineFlowTests();
