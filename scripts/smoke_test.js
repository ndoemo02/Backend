
import fetch from 'node-fetch';

const BASE_URL = 'https://backend-one-gilt-89.vercel.app';
const ENDPOINT = `${BASE_URL}/api/brain/v2`;

async function testScenario(name, input, sessionId) {
    console.log(`\n🔹 Scenario: ${name}`);
    console.log(`   Input: "${input}"`);

    const start = Date.now();
    try {
        const res = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                input: input,
                session_id: sessionId,
                devMode: true
            })
        });

        const duration = Date.now() - start;
        const data = await res.json();

        console.log(`   Status: ${res.status}`);
        console.log(`   Time: ${duration}ms`);

        if (!res.ok) {
            console.error(`   ❌ Failed: ${JSON.stringify(data)}`);
            return { success: false, time: duration, error: data };
        }

        console.log(`   Reply: "${data.reply}"`);
        console.log(`   Intent: ${data.intent}`);
        if (data.actions) console.log(`   Actions: ${JSON.stringify(data.actions)}`);

        return { success: true, time: duration, result: data };
    } catch (err) {
        console.error(`   ❌ Error: ${err.message}`);
        return { success: false, time: Date.now() - start, error: err.message };
    }
}

async function runSmokeTests() {
    const sessionId = `smoke-${Date.now()}`;

    // a) Discovery
    await testScenario('Discovery', 'Szukam czegoś do jedzenia w Piekarach', sessionId);

    // b) Order
    await testScenario('Order', 'Zamawiam carpaccio z kaczki z Luxury Hotel', sessionId);

    // c) Confirm
    // Verify it targets cart
    const confirmRes = await testScenario('Confirm', 'Potwierdzam', sessionId);

    // d) Safety Guard UX (Implicit Order Fallback)
    await testScenario('SafetyGuardUX', 'Zamawiam frytki', sessionId);

    if (confirmRes.success) {
        const orderAction = confirmRes.result.actions?.find(a => a.type === 'create_order' || a.type === 'add_to_cart'); // Adjust based on logic
        console.log('   [Validation] Confirm Action:', JSON.stringify(orderAction));

        // Check requirement: "Confirm ma przenieść stan do koszyka"
        // In V2, "confirm_order" intent usually triggers 'client_event' -> 'add_to_cart' OR creates an order with status 'pending'?
        // The user says "Confirm ma przenieść stan do koszyka (np. in_cart)"
    }
}

runSmokeTests();
