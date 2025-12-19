
import { pipeline } from './api/brain/brainV2.js';
import { updateSession, getSession } from './api/brain/session/sessionStore.js';

async function runZombieTest() {
    const sessionId = 'zombie_test_user';
    console.log("🧟 Starting Zombie Session Test...");

    // 1. Setup Session: Pending Order ready for confirmation
    updateSession(sessionId, {
        lastRestaurant: { id: 21, name: 'Pizzeria Napoli' },
        pendingOrder: { items: [{ name: 'Pizza', price: 30 }], total: 30 },
        expectedContext: 'confirm_order'
    });

    // 2. Confirm Order (Should set status = COMPLETED)
    console.log("\n--- Request 1: Confirm Order ---");
    const res1 = await pipeline.process(sessionId, "Potwierdzam");
    console.log(`[R1] Reply: ${res1.reply}`);

    const sessAfter = getSession(sessionId);
    if (sessAfter.status === 'COMPLETED') {
        console.log("✅ SUCCESS: Session status is COMPLETED.");
    } else {
        console.log(`❌ FAIL: Session status is ${sessAfter.status}`);
    }

    // 3. Try to access menu (Should be BLOCKED)
    console.log("\n--- Request 2: Zombie Request (Menu) ---");
    const res2 = await pipeline.process(sessionId, "Pokaż menu");
    console.log(`[R2] Intent: ${res2.intent} | Reply: ${res2.reply}`);

    if (res2.intent === 'session_locked') {
        console.log("✅ SUCCESS: Zombie request blocked.");
    } else {
        console.log(`❌ FAIL: Request went through with intent ${res2.intent}`);
    }

    // 4. New Order (Should RESET)
    console.log("\n--- Request 3: New Order (Reset) ---");
    const res3 = await pipeline.process(sessionId, "Nowe zamówienie");
    console.log(`[R3] Intent: ${res3.intent} | Reply: ${res3.reply}`); // Might be unknown or find_nearby depending on text

    const sessReset = getSession(sessionId);
    if (sessReset.status === 'active') {
        console.log("✅ SUCCESS: Session status RESET to active.");
    } else {
        console.log(`❌ FAIL: Session status is ${sessReset.status}`);
    }
}

runZombieTest();
