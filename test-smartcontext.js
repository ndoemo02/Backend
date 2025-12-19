/**
 * SmartContext v3.1: Test Suite
 * 10 scenariuszy testowych zgodnie z FreeFlow Amber — SmartContext v3.1 Implementation Plan
 */

const API_URL = 'http://localhost:3000/api/brain';

// Kolory dla terminala
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

async function testScenario(name, sessionId, text, expectations) {
  console.log(`\n${colors.cyan}=== TEST: ${name} ===${colors.reset}`);
  console.log(`${colors.gray}Query: "${text}"${colors.reset}`);
  
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, text })
    });
    
    const result = await response.json();
    
    // Sprawdź expectations
    let passed = true;
    const checks = [];
    
    if (expectations.intent) {
      const intentMatch = result.intent === expectations.intent;
      checks.push({
        name: 'Intent',
        expected: expectations.intent,
        actual: result.intent,
        passed: intentMatch
      });
      if (!intentMatch) passed = false;
    }
    
    if (expectations.cuisine) {
      // Sprawdź czy reply zawiera cuisine type
      const cuisineMatch = result.reply.toLowerCase().includes(expectations.cuisine.toLowerCase());
      checks.push({
        name: 'Cuisine',
        expected: expectations.cuisine,
        actual: cuisineMatch ? 'found' : 'not found',
        passed: cuisineMatch
      });
      if (!cuisineMatch) passed = false;
    }
    
    if (expectations.restaurant) {
      const restaurantMatch = result.restaurant?.name === expectations.restaurant || 
                             result.reply.includes(expectations.restaurant);
      checks.push({
        name: 'Restaurant',
        expected: expectations.restaurant,
        actual: result.restaurant?.name || 'not found',
        passed: restaurantMatch
      });
      if (!restaurantMatch) passed = false;
    }
    
    if (expectations.replyContains) {
      const replyMatch = expectations.replyContains.some(phrase => 
        result.reply.toLowerCase().includes(phrase.toLowerCase())
      );
      checks.push({
        name: 'Reply contains',
        expected: expectations.replyContains.join(' OR '),
        actual: replyMatch ? 'found' : 'not found',
        passed: replyMatch
      });
      if (!replyMatch) passed = false;
    }
    
    // Wyświetl wyniki
    checks.forEach(check => {
      const icon = check.passed ? '✅' : '❌';
      const color = check.passed ? colors.green : colors.red;
      console.log(`  ${icon} ${check.name}: ${color}${check.actual}${colors.reset} (expected: ${check.expected})`);
    });
    
    console.log(`${colors.gray}Reply: ${result.reply.substring(0, 120)}...${colors.reset}`);
    
    return { name, passed, result };
    
  } catch (error) {
    console.error(`${colors.red}ERROR: ${error.message}${colors.reset}`);
    return { name, passed: false, error: error.message };
  }
}

// Helper: delay between tests
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runTests() {
  console.log(`${colors.cyan}╔════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.cyan}║  SmartContext v3.1: Test Suite (10 scenariuszy)           ║${colors.reset}`);
  console.log(`${colors.cyan}╚════════════════════════════════════════════════════════════╝${colors.reset}`);

  const results = [];

  // TEST 1: Szybkie jedzenie
  results.push(await testScenario(
    'TEST 1: Szybkie jedzenie',
    'test-smart-1',
    'Cześć, chciałbym coś na szybko w Piekarach',
    {
      intent: 'find_nearby',
      replyContains: ['Klaps', 'Tasty', 'burger', 'kebab', 'szybk']
    }
  ));
  await delay(500); // 500ms delay

  // TEST 2: Kuchnia azjatycka
  results.push(await testScenario(
    'TEST 2: Kuchnia azjatycka',
    'test-smart-2',
    'Mam ochotę na coś azjatyckiego',
    {
      intent: 'find_nearby',
      replyContains: ['Vien-Thien', 'azjat', 'wietnam']
    }
  ));
  await delay(500);
  
  // TEST 3: Rekomendacja
  results.push(await testScenario(
    'TEST 3: Rekomendacja',
    'test-smart-3',
    'Polecisz mi coś dobrego?',
    {
      intent: 'recommend',
      replyContains: ['polecam', 'Monte Carlo', 'pizza', 'idealn']
    }
  ));
  await delay(500);

  // TEST 4: Menu request
  results.push(await testScenario(
    'TEST 4: Menu request',
    'test-smart-4',
    'Pokaż menu Klaps Burgers',
    {
      intent: 'menu_request',
      restaurant: 'Klaps Burgers'
    }
  ));
  await delay(500);

  // TEST 5: Zamów tutaj (follow-up)
  results.push(await testScenario(
    'TEST 5: Zamów tutaj (context)',
    'test-smart-5a',
    'Pokaż menu Monte Carlo',
    {
      intent: 'menu_request'
    }
  ));
  await delay(500);

  results.push(await testScenario(
    'TEST 5b: Zamów tutaj',
    'test-smart-5a',
    'Zamów tutaj',
    {
      intent: 'create_order',
      replyContains: ['zamówien', 'Monte Carlo']
    }
  ));
  await delay(500);

  // TEST 6: Nie, coś innego (change_restaurant)
  results.push(await testScenario(
    'TEST 6: Nie, coś innego',
    'test-smart-6a',
    'Gdzie mogę zjeść w Piekarach',
    {
      intent: 'find_nearby'
    }
  ));
  await delay(500);

  results.push(await testScenario(
    'TEST 6b: Nie, coś innego',
    'test-smart-6a',
    'Nie, coś innego',
    {
      intent: 'change_restaurant',
      replyContains: ['inne', 'opcj', 'Piekary']
    }
  ));
  await delay(500);

  // TEST 7: Wege jedzenie (fallback)
  results.push(await testScenario(
    'TEST 7: Wege jedzenie',
    'test-smart-7',
    'Chciałbym wege jedzenie',
    {
      intent: 'find_nearby',
      replyContains: ['nie', 'brak', 'nie znalaz', 'nie mam']
    }
  ));
  await delay(500);

  // TEST 8: Zobacz co mają (fuzzy match)
  results.push(await testScenario(
    'TEST 8: Zobacz co mają',
    'test-smart-8',
    'Zobacz co mają w Monte Carlo',
    {
      intent: 'menu_request',
      restaurant: 'Pizzeria Monte Carlo'
    }
  ));
  await delay(500);

  // TEST 9: Poproszę burgera (create_order OR find_nearby)
  results.push(await testScenario(
    'TEST 9: Poproszę burgera',
    'test-smart-9',
    'Poproszę burgera w Piekarach',
    {
      intent: 'find_nearby', // lub create_order jeśli jest context
      replyContains: ['burger', 'Klaps', 'Amerykańsk']
    }
  ));
  await delay(500);

  // TEST 10: Gdzie dobrze zjem w Bytomiu (nearby city fallback)
  results.push(await testScenario(
    'TEST 10: Nearby city fallback',
    'test-smart-10',
    'Gdzie dobrze zjem w Bytomiu',
    {
      intent: 'find_nearby',
      replyContains: ['Piekary', 'Bytom', 'nie', 'dalej', 'minut']
    }
  ));
  
  // Podsumowanie
  console.log(`\n${colors.cyan}╔════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.cyan}║  PODSUMOWANIE TESTÓW                                       ║${colors.reset}`);
  console.log(`${colors.cyan}╚════════════════════════════════════════════════════════════╝${colors.reset}`);
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;
  
  results.forEach(r => {
    const icon = r.passed ? '✅' : '❌';
    const color = r.passed ? colors.green : colors.red;
    console.log(`  ${icon} ${color}${r.name}${colors.reset}`);
  });
  
  console.log(`\n${colors.cyan}Total: ${total} | Passed: ${colors.green}${passed}${colors.cyan} | Failed: ${colors.red}${failed}${colors.reset}`);
  
  if (passed === total) {
    console.log(`\n${colors.green}🎉 WSZYSTKIE TESTY PRZESZŁY! SmartContext v3.1 działa perfekcyjnie! ✅${colors.reset}\n`);
  } else {
    console.log(`\n${colors.yellow}⚠️  ${failed} testów nie przeszło. Sprawdź logi powyżej.${colors.reset}\n`);
  }
  
  process.exit(passed === total ? 0 : 1);
}

// Uruchom testy
runTests().catch(error => {
  console.error(`${colors.red}FATAL ERROR: ${error.message}${colors.reset}`);
  process.exit(1);
});

