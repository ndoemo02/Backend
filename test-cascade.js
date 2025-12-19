
const fetch = global.fetch; // Node 18+

const API_URL = 'http://localhost:3000/api/brain';
const SESSION_ID = `cascade-test-${Date.now()}`;

async function send(text) {
    console.log(`\n📤 Sending: "${text}"`);
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text,
                sessionId: SESSION_ID,
                includeTTS: false,
                lat: 50.348,
                lng: 18.932
            })
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`HTTP ${res.status}: ${err}`);
        }

        const data = await res.json();
        console.log(`📥 Intent: ${data.intent}`);
        console.log(`   Reply: ${data.reply}`);
        console.log(`   Context:`, JSON.stringify(data.context?.expectedContext || null));
        if (data.context?.lastRestaurant) console.log(`   Restaurant: ${data.context.lastRestaurant.name}`);
        if (data.context?.pendingOrder) console.log(`   PendingOrder: ${data.context.pendingOrder.items?.length} items`);

        return data;
    } catch (e) {
        console.error('❌ Error:', e.message);
        return null;
    }
}

async function runCascade() {
    console.log(`🚀 Starting Cascading Test (Session: ${SESSION_ID})`);

    // 1. Find Nearby
    let res = await send("Znajdź włoską restaurację w pobliżu");
    if (res?.intent !== 'find_nearby') console.warn('⚠️ Step 1 failed intent check');

    // 2. Select Restaurant (assuming lists are returned via context or logic simulates selection)
    // If only one result, might auto-select or ask confirmation.
    // If multiple, we select first.
    res = await send("Wybieram pierwszą");
    if (res?.intent !== 'select_restaurant') console.warn('⚠️ Step 2 failed intent check');

    // 3. Confirm Menu (Context Lock check)
    // If Step 2 set expectedContext: 'confirm_menu', sending 'tak' should trigger 'show_menu'.
    if (res?.context?.expectedContext === 'confirm_menu') {
        res = await send("tak");
        if (res?.intent !== 'show_menu') console.error('❌ Context Lock Failed! Expected show_menu, got:', res?.intent);
        else console.log('✅ Context Lock OK: show_menu triggered');
    } else {
        console.log('ℹ️ Skipping Confirm Menu check (no context set)');
        // Try requesting menu explicitly
        if (res && res.intent !== 'show_menu') {
            res = await send("pokaż menu");
        }
    }

    // 4. Create Order
    res = await send("Zamawiam pizzę margherita");
    if (res?.intent !== 'create_order') console.warn('⚠️ Step 4 failed intent check (got ' + res?.intent + ')');

    // 5. Confirm Order
    if (res?.context?.expectedContext === 'confirm_order') {
        res = await send("tak, poproszę");
        if (res?.intent !== 'confirm_order') console.error('❌ Order Confirm Failed! Expected confirm_order, got:', res?.intent);
        else console.log('✅ Order Confirmed');
    } else {
        console.warn('⚠️ No confirm_order context after ordering.');
    }

    console.log('\n🏁 Test Completed');
}

runCascade();
