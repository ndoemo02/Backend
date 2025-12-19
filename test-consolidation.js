/**
 * FreeFlow Consolidation Pass — Test Suite
 * Testuje 3 scenariusze po konsolidacji brainRouter.js
 */

const testScenarios = [
  {
    name: 'Test 1: GeoContext Layer (Gdzie mogę zjeść w Piekarach)',
    sessionId: 'test-geo-1',
    text: 'Gdzie mogę zjeść w Piekarach',
    expectedIntent: 'nearby',
    expectedLocation: 'Piekary',
    expectedRestaurantsMin: 1,
  },
  {
    name: 'Test 2: Menu Request with Fuzzy Matching (Pokaż menu Klaps Burger)',
    sessionId: 'test-menu-2',
    text: 'Pokaż menu Klaps Burger',
    expectedIntent: 'menu_request',
    expectedRestaurant: 'Klaps Burgers',
  },
  {
    name: 'Test 3: Create Order with Dish Validation (Zamów pizzę Monte Carlo)',
    sessionId: 'test-order-3',
    text: 'Zamów pizzę Monte Carlo',
    expectedIntent: 'create_order',
    expectedRestaurant: 'Pizzeria Monte Carlo', // Pełna nazwa z bazy
  },
];

async function runTests() {
  console.log('🧪 FreeFlow Consolidation Pass — Test Suite\n');
  
  let passed = 0;
  let failed = 0;
  const startTime = Date.now();

  for (const scenario of testScenarios) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`📋 ${scenario.name}`);
    console.log(`${'='.repeat(70)}`);

    try {
      const response = await fetch('http://localhost:3000/api/brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: scenario.sessionId,
          text: scenario.text,
        }),
      });

      const data = await response.json();

      console.log(`\n📊 Response:`);
      console.log(`   Intent: ${data.intent}`);
      console.log(`   Restaurant: ${data.restaurant?.name || 'null'}`);
      console.log(`   Location: ${data.location || 'null'}`);
      console.log(`   Restaurants count: ${data.restaurants?.length || 0}`);
      console.log(`   Confidence: ${data.confidence}`);
      console.log(`   Fallback: ${data.fallback}`);
      console.log(`\n💬 Reply preview:`);
      console.log(`   ${data.reply?.substring(0, 150) || 'null'}...`);

      // Validation
      let testPassed = true;
      const errors = [];

      if (scenario.expectedIntent && data.intent !== scenario.expectedIntent) {
        errors.push(`❌ Intent mismatch: expected "${scenario.expectedIntent}", got "${data.intent}"`);
        testPassed = false;
      }

      if (scenario.expectedRestaurant && data.restaurant?.name !== scenario.expectedRestaurant) {
        errors.push(`❌ Restaurant mismatch: expected "${scenario.expectedRestaurant}", got "${data.restaurant?.name || 'null'}"`);
        testPassed = false;
      }

      if (scenario.expectedLocation && data.location !== scenario.expectedLocation) {
        errors.push(`❌ Location mismatch: expected "${scenario.expectedLocation}", got "${data.location || 'null'}"`);
        testPassed = false;
      }

      if (scenario.expectedRestaurantsMin && (!data.restaurants || data.restaurants.length < scenario.expectedRestaurantsMin)) {
        errors.push(`❌ Restaurants count: expected at least ${scenario.expectedRestaurantsMin}, got ${data.restaurants?.length || 0}`);
        testPassed = false;
      }

      if (testPassed) {
        console.log(`\n✅ TEST PASSED`);
        passed++;
      } else {
        console.log(`\n❌ TEST FAILED:`);
        errors.forEach(err => console.log(`   ${err}`));
        failed++;
      }

    } catch (error) {
      console.log(`\n🚨 ERROR: ${error.message}`);
      failed++;
    }
  }

  const duration = Date.now() - startTime;

  console.log(`\n${'='.repeat(70)}`);
  console.log(`📊 Test Summary`);
  console.log(`${'='.repeat(70)}`);
  console.log(`✅ Passed: ${passed}/${testScenarios.length}`);
  console.log(`❌ Failed: ${failed}/${testScenarios.length}`);
  console.log(`⏱️  Total duration: ${duration}ms (${(duration / 1000).toFixed(2)}s)`);
  console.log(`⚡ Avg response time: ${(duration / testScenarios.length).toFixed(0)}ms`);
  
  if (duration / testScenarios.length < 1500) {
    console.log(`✅ Performance: PASS (< 1.5s avg)`);
  } else {
    console.log(`⚠️  Performance: SLOW (> 1.5s avg)`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

runTests();

