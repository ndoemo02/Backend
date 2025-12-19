
import { pipeline } from './api/brain/brainV2.js';
import { updateSession } from './api/brain/session/sessionStore.js';

async function runPerformanceTest() {
    const sessionId = 'perf_test_user';
    console.log("🚀 Starting Performance Cache Test...");

    // 1. Setup Session (Mock finding a restaurant first to populate context)
    updateSession(sessionId, {
        lastRestaurant: { id: 21, name: 'Pizzeria Napoli', city: 'Zabrze' }, // Mock ID
        expectedContext: 'neutral'
    });

    // 2. First Request (Cold Start - Should hit DB)
    console.log("\n--- Request 1: Cold Menu Request (Expect DB) ---");
    const res1 = await pipeline.process(sessionId, "Pokaż menu");
    console.log(`[R1] Response: ${res1.meta.latency_total_ms}ms | Source: ${res1.meta.source} | Reply: ${res1.reply.slice(0, 50)}...`);

    // 3. Second Request (Warm Cache - Should hit Cache)
    console.log("\n--- Request 2: Warm Menu Request (Expect Cache) ---");
    const start2 = Date.now();
    const res2 = await pipeline.process(sessionId, "Pokaż menu");
    const duration2 = Date.now() - start2;
    console.log(`[R2] Response: ${res2.meta.latency_total_ms}ms | Source: ${res2.meta.source} | Reply: ${res2.reply.slice(0, 50)}...`);

    if (res2.meta.source === 'cache' && res2.meta.latency_total_ms < 50) {
        console.log("\n✅ SUCCESS: Cache shortcut works! Latency < 50ms");
    } else {
        console.log("\n❌ FAIL: Cache did not trigger or was slow.");
    }

    // 4. Test Lexical Override
    console.log("\n--- Request 3: Order Intent Override ---");
    const res3 = await pipeline.process(sessionId, "Poproszę pizzę capricciosa");
    console.log(`[R3] Intent: ${res3.intent} (Expected: create_order) | Source: ${res3.meta.nlu_source}`);

    if (res3.intent === 'create_order') {
        console.log("✅ SUCCESS: Lexical override works!");
    } else {
        console.log(`❌ FAIL: Got intent ${res3.intent}`);
    }
}

runPerformanceTest();
