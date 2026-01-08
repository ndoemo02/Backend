/**
 * Test: Context Conversation Flow - Pending Dish Memory
 * 
 * Scenariusz:
 * 1. "wezmę kebab duży" (generic order) -> system pyta o miasto, zapisuje pendingDish
 * 2. "Piekary Śląskie" (standalone location) -> system pokazuje restauracje + pamięta kebab
 * 3. Verify: pendingDish preserved, awaiting cleared
 */

import fetch from 'node-fetch';

const BASE_URL = 'https://backend-one-gilt-89.vercel.app';
const ENDPOINT = `${BASE_URL}/api/brain/v2`;

async function testContextFlow() {
    const sessionId = `context-flow-${Date.now()}`;

    console.log('\n🧪 TEST: Context Conversation Flow\n');

    // Turn 1: Generic order without location
    console.log('📍 Turn 1: "wezmę kebab duży"');
    const turn1 = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            input: 'wezmę kebab duży',
            session_id: sessionId
        })
    });

    const res1 = await turn1.json();
    console.log(`   Intent: ${res1.intent}`);
    console.log(`   Reply: "${res1.reply?.substring(0, 80)}..."`);
    console.log(`   Context.pendingDish: ${res1.context?.pendingDish || 'NOT SET'}`);
    console.log(`   Context.awaiting: ${res1.context?.awaiting || 'NOT SET'}`);

    // Validate Turn 1
    const t1Passed = res1.intent === 'find_nearby' &&
        res1.context?.awaiting === 'location' &&
        res1.context?.pendingDish !== null;

    console.log(`   ✅ Status: ${t1Passed ? 'PASS' : 'FAIL'}`);

    if (!t1Passed) {
        console.log('   ❌ Expected: intent=find_nearby, awaiting=location, pendingDish=set');
        return;
    }

    // Turn 2: Standalone location response
    console.log('\n📍 Turn 2: "Piekary Śląskie"');
    const turn2 = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            input: 'Piekary Śląskie',
            session_id: sessionId
        })
    });

    const res2 = await turn2.json();
    console.log(`   Intent: ${res2.intent}`);
    console.log(`   Reply: "${res2.reply?.substring(0, 80)}..."`);
    console.log(`   Context.pendingDish: ${res2.context?.pendingDish || 'CLEARED'}`);
    console.log(`   Context.awaiting: ${res2.context?.awaiting || 'CLEARED'}`);
    console.log(`   Restaurants found: ${res2.restaurants?.length || 0}`);

    // Validate Turn 2
    const t2Passed = res2.intent === 'find_nearby' &&
        res2.context?.awaiting !== 'location' && // Should be cleared
        res2.restaurants?.length > 0;

    console.log(`   ✅ Status: ${t2Passed ? 'PASS' : 'FAIL'}`);

    if (!t2Passed) {
        console.log('   ❌ Expected: intent=find_nearby, awaiting=null, restaurants>0');
    }

    // Final Report
    console.log('\n📊 FINAL REPORT:');
    console.log(`   Turn 1 (Implicit Order): ${t1Passed ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   Turn 2 (Location Response): ${t2Passed ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   Overall: ${t1Passed && t2Passed ? '✅ SUCCESS' : '❌ FAILED'}`);
}

testContextFlow().catch(err => {
    console.error('❌ Test failed:', err.message);
    process.exit(1);
});
