
import dotenv from 'dotenv';
dotenv.config();

import { BrainPipeline } from './api/brain/core/pipeline.js';
import { updateSession, getSession } from './api/brain/session/sessionStore.js';

class MockNLU {
    async detect(ctx) {
        return {
            intent: 'show_menu',
            domain: 'food',
            confidence: 1.0,
            source: 'mock',
            entities: { restaurant: null } // Use session restaurant
        };
    }
}

async function runBackendAsmTest() {
    const sessionId = 'asm_test_user_mock';
    console.log("🎤 Starting Backend ASM Test (Mock NLU)...");

    // 0. Setup Pipeline with Mock NLU
    const pipeline = new BrainPipeline({ nlu: new MockNLU() });

    // 1. Setup Session: Inside Restaurant
    const mockRestId = '123e4567-e89b-12d3-a456-426614174000';
    updateSession(sessionId, {
        lastRestaurant: { id: mockRestId, name: 'Pizzeria Napoli' },
        context: 'IN_RESTAURANT',
        lockedRestaurantId: mockRestId,
        expectedContext: 'menu_or_order'
    });

    // 2. First Menu Request (Full List)
    console.log("\n--- Request 1: Full Menu Request ---");
    const res1 = await pipeline.process(sessionId, "Pokaż menu");
    console.log(`[R1] Reply: ${res1.reply}`); // Likely "Przepraszam..." if no DB data

    // 3. Second Menu Request (Short Mode)
    console.log("\n--- Request 2: Repeated Menu Request (Short Mode) ---");
    const res2 = await pipeline.process(sessionId, "Pokaż menu");
    console.log(`[R2] Reply: ${res2.reply}`);
    console.log(`[R2] Source: ${res2.meta.source}`);

    if (res2.reply.includes("Listę dań masz na ekranie")) {
        console.log("✅ SUCCESS: Second request short-circuited (Anti-Loop).");
    } else {
        console.error(`❌ FAIL: Short mode did not trigger. Source: ${res2.meta.source}`);
    }
}

runBackendAsmTest();
