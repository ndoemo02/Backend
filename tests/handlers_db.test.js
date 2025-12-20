
import dotenv from 'dotenv';
dotenv.config();

import { BrainPipeline } from '../api/brain/core/pipeline.js';
import { NLURouter } from '../api/brain/nlu/router.js';
import { getSession, updateSession } from '../api/brain/session/sessionStore.js';
import { supabase } from '../api/_supabase.js';
import fs from 'fs';

// Setup environment
global.BRAIN_DEBUG = true;

const nlu = new NLURouter();
// No mocks = Use real handlers with DB access
const pipeline = new BrainPipeline({ nlu });
const sessionId = 'test-e2e-real-db-1';

async function runTests() {
    console.log('🧪 Starting ETAP 3 - Integration Tests (Real Handlers & DB)\n');
    let passed = 0;
    let failed = 0;
    const failureDetails = [];

    // Reset session
    updateSession(sessionId, {});

    try {
        // Check DB connection first


        const data = await supabase.from('restaurants').select('id, name').limit(1);
        const err = data.error;
        if (err || !data.data || data.data.length === 0) {
            console.error('DB Error Detail:', err);
            throw new Error(`DB Connection Failed`);
        }
        // Test requires Piekary slaskie
        const checkLoc = await supabase.from('restaurants').select('id, name').ilike('city', '%Piekary%').limit(1);
        if (!checkLoc.data || checkLoc.data.length === 0) {
            console.error('No Piekary restaurants found. Check DB content.');
            throw new Error('No Piekary Slaskie restaurants found for test!');
        }

    } catch (e) {
        console.error("❌ Critical: DB Setup failure.");
        process.exit(1);
    }

    // Define Flow
    // 1. Find Restaurant (DB Read)
    // 2. Menu (DB Read + Caching)
    // 3. Order (Logic + Menu Parse)
    // 4. Confirm (Session Logic)

    let foundMenu = [];
    const scenarios = [
        {
            name: "3.1 Find Restaurants",
            input: "restauracje w Piekary",
            check: (res) => {
                if (!res.reply.toLowerCase().includes('piekary')) {
                    console.error("❌ Reply mismatch. Got:", res.reply);
                    return "Wrong location in reply";
                }
                const session = getSession(sessionId);
                if (!session.last_restaurants_list || session.last_restaurants_list.length === 0) return "No restaurants found/stored";
                if (session.expectedContext !== 'select_restaurant') return "Wrong context";
                return null;
            }
        },
        {
            name: "3.2 Select Restaurant",
            // Context is 'select_restaurant', so intent will be 'select_restaurant'
            input: "Stara Kamienica",  // Or "1", or "wybieram Stara X"
            check: (res) => {
                // Should return confirmation "Wybrano..."
                const session = getSession(sessionId);
                if (!session.lockedRestaurantId) return "Restaurant lock failed";
                if (session.expectedContext !== 'menu_or_order') return "Context update failed";
                return null;
            }
        },
        {
            name: "3.2b Show Menu",
            input: "pokaż menu",
            check: (res) => {
                if (!res.menu || res.menu.length === 0) return "No menu returned";
                foundMenu = res.menu;
                console.log("DEBUG Found Menu Items:", foundMenu.map(m => m.name).slice(0, 5));
                return null;
            }
        },
        {
            name: "3.3 Create Order",
            input: () => `zamawiam ${foundMenu[0]?.name || 'pizza'}`, // Dynamic input
            check: (res) => {
                const session = getSession(sessionId);
                if (!session.pendingOrder) {
                    console.error("❌ Stats: items found?", res.reply); // heuristic
                    console.error("❌ Session keys:", Object.keys(session));
                    console.error("❌ Context Updates in RES:", JSON.stringify(res)); // Check full Res to be sure
                    return "No pending order created";
                }
                if (session.expectedContext !== 'confirm_order') return "Wrong context (expected confirm)";
                return null;
            }
        },
        {
            name: "3.4 Confirm Order",
            input: "potwierdzam",
            check: (res) => {
                const session = getSession(sessionId);
                if (session.status !== 'COMPLETED') return `Session not completed, status: ${session.status}`;
                if (!res.reply.includes("Przyjęłam zamówienie")) return "Wrong reply";
                return null;
            }
        }
    ];

    for (const scen of scenarios) {
        let inputText = typeof scen.input === 'function' ? scen.input() : scen.input;
        console.log(`\n🔹 Scenario: ${scen.name} [Input: "${inputText}"]`);
        try {
            const res = await pipeline.process(sessionId, inputText);

            const err = scen.check(res);
            if (err) {
                console.error(`❌ FAILING RESPONSE DUMP:`, JSON.stringify(res, null, 2));
                throw new Error(err);
            }
            console.log(`✅ PASS`);
            passed++;
        } catch (e) {
            console.error(`❌ FAIL: ${e.message}`);
            failureDetails.push({ scenario: scen.name, error: e.message });
            failed++;
        }
    }

    console.log(`\nResults: ${passed} Passed, ${failed} Failed.`);
    fs.writeFileSync('integration_test_results.json', JSON.stringify({ passed, failed, failureDetails }, null, 2));

    if (failed > 0) process.exit(1);
}

runTests();
