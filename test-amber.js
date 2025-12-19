// test-amber.js - Ogólny test logiki Amber
// Używamy wbudowanego fetch (Node.js 18+)

const BACKEND_URL = 'http://localhost:3000/api/brain';
const TEST_SESSION = 'test-session-' + Date.now();

// Kolory dla logów
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(color, message) {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testAmber(text, expectedIntent = null, description = '') {
  try {
    log('cyan', `\n🧪 TEST: ${description || text}`);
    log('yellow', `📤 Wysyłam: "${text}"`);
    
    const response = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: TEST_SESSION,
        text: text
      })
    });

    const data = await response.json();
    
    log('blue', `📥 Otrzymano:`);
    console.log(JSON.stringify(data, null, 2));
    
    if (expectedIntent && data.intent !== expectedIntent) {
      log('red', `❌ BŁĄD: Oczekiwano intent="${expectedIntent}", otrzymano="${data.intent}"`);
      return false;
    } else if (expectedIntent) {
      log('green', `✅ SUKCES: Intent="${data.intent}" zgodny z oczekiwanym`);
    }
    
    return true;
  } catch (error) {
    log('red', `❌ BŁĄD: ${error.message}`);
    return false;
  }
}

async function runTests() {
  log('bright', '🚀 ROZPOCZYNAM OGÓLNY TEST LOGIKI AMBER');
  log('yellow', '=' .repeat(60));
  
  let passed = 0;
  let total = 0;

  // TEST 1: Podstawowe wyszukiwanie restauracji
  total++;
  if (await testAmber('gdzie zjeść?', 'find_nearby', 'Podstawowe wyszukiwanie restauracji')) {
    passed++;
  }

  // TEST 2: Wyszukiwanie z lokalizacją
  total++;
  if (await testAmber('gdzie zjeść w Piekarach?', 'find_nearby', 'Wyszukiwanie z lokalizacją')) {
    passed++;
  }

  // TEST 3: Wyszukiwanie z typem kuchni
  total++;
  if (await testAmber('chcę pizzę', 'find_nearby', 'Wyszukiwanie z typem kuchni')) {
    passed++;
  }

  // TEST 4: Pokaż więcej opcji (expectedContext)
  total++;
  if (await testAmber('pokaż więcej opcji', 'show_more_options', 'Pokaż więcej opcji (expectedContext)')) {
    passed++;
  }

  // TEST 5: Wybieranie restauracji
  total++;
  if (await testAmber('wybieram pierwszą', 'select_restaurant', 'Wybieranie restauracji')) {
    passed++;
  }

  // TEST 6: Prośba o menu
  total++;
  if (await testAmber('pokaż menu', 'menu_request', 'Prośba o menu')) {
    passed++;
  }

  // TEST 7: Zamówienie z aliasem (diabolo)
  total++;
  if (await testAmber('zamów pizzę diabolo', 'create_order', 'Zamówienie z aliasem (diabolo → diavola)')) {
    passed++;
  }

  // TEST 8: Zamówienie (żeby ustawić expectedContext)
  total++;
  if (await testAmber('zamów pizzę margherita', 'create_order', 'Zamówienie (ustawienie expectedContext)')) {
    passed++;
  }

  // TEST 9: Potwierdzenie zamówienia
  total++;
  if (await testAmber('tak', 'confirm_order', 'Potwierdzenie zamówienia')) {
    passed++;
  }

  // TEST 10: Anulowanie zamówienia (potrzebuje expectedContext)
  total++;
  if (await testAmber('zamów pizzę margherita', 'create_order', 'Zamówienie (ustawienie expectedContext dla anulowania)')) {
    passed++;
  }

  // TEST 11: Anulowanie zamówienia
  total++;
  if (await testAmber('nie', 'cancel_order', 'Anulowanie zamówienia')) {
    passed++;
  }

  // TEST 12: Rekomendacje
  total++;
  if (await testAmber('co polecasz?', 'recommend', 'Rekomendacje')) {
    passed++;
  }

  // TEST 13: Zmiana restauracji
  total++;
  if (await testAmber('nie, pokaż inne', 'change_restaurant', 'Zmiana restauracji')) {
    passed++;
  }

  // TEST 14: Potwierdzenie ogólne
  total++;
  if (await testAmber('ok', 'confirm', 'Potwierdzenie ogólne')) {
    passed++;
  }

  // PODSUMOWANIE
  log('bright', '\n' + '=' .repeat(60));
  log('bright', '📊 PODSUMOWANIE TESTÓW');
  log('bright', '=' .repeat(60));
  
  if (passed === total) {
    log('green', `✅ WSZYSTKIE TESTY PRZESZŁY! (${passed}/${total})`);
  } else {
    log('red', `❌ ${total - passed} TESTÓW NIE PRZESZŁO (${passed}/${total})`);
  }
  
  log('yellow', `\n🎯 Szczegóły w logach powyżej`);
  
  return { passed, total };
}

// 🧪 EDGE CASES - Testy odporności Amber
async function runEdgeCaseTests() {
  log('magenta', '\n🛡️ URUCHAMIANIE TESTÓW ODPORNOŚCI (EDGE CASES)');
  log('magenta', '=' .repeat(60));
  
  let passed = 0;
  let total = 0;
  
  // TEST 1: Pusty tekst
  total++;
  if (await testAmber('', 'none', 'Pusty tekst')) {
    passed++;
  }
  
  // TEST 2: Tylko spacje
  total++;
  if (await testAmber('   ', 'none', 'Tylko spacje')) {
    passed++;
  }
  
  // TEST 3: Bardzo długi tekst
  total++;
  const longText = 'a'.repeat(2000);
  if (await testAmber(longText, 'none', 'Bardzo długi tekst (2000 znaków)')) {
    passed++;
  }
  
  // TEST 4: Znaki specjalne
  total++;
  if (await testAmber('<>{}[]\\|`~', 'none', 'Znaki specjalne')) {
    passed++;
  }
  
  // TEST 5: Losowy tekst
  total++;
  if (await testAmber('asdfghjklqwertyuiop', 'none', 'Losowy tekst')) {
    passed++;
  }
  
  // TEST 6: Tekst z emoji
  total++;
  if (await testAmber('🍕 pizza 🍕', 'find_nearby', 'Tekst z emoji')) {
    passed++;
  }
  
  // TEST 7: Tekst z polskimi znakami
  total++;
  if (await testAmber('żółć gęślą jaźń', 'none', 'Tekst z polskimi znakami')) {
    passed++;
  }
  
  // TEST 8: Liczby
  total++;
  if (await testAmber('123456789', 'none', 'Tylko liczby')) {
    passed++;
  }
  
  // TEST 9: Znaki interpunkcyjne
  total++;
  if (await testAmber('!!!???...', 'none', 'Znaki interpunkcyjne')) {
    passed++;
  }
  
  // TEST 10: HTML/XML
  total++;
  if (await testAmber('<script>alert("test")</script>', 'none', 'HTML/XML')) {
    passed++;
  }
  
  // TEST 11: SQL injection attempt
  total++;
  if (await testAmber("'; DROP TABLE restaurants; --", 'none', 'SQL injection attempt')) {
    passed++;
  }
  
  // TEST 12: JSON
  total++;
  if (await testAmber('{"test": "value"}', 'none', 'JSON string')) {
    passed++;
  }
  
  // TEST 13: URL
  total++;
  if (await testAmber('https://example.com', 'none', 'URL')) {
    passed++;
  }
  
  // TEST 14: Email
  total++;
  if (await testAmber('test@example.com', 'none', 'Email')) {
    passed++;
  }
  
  // TEST 15: Unicode
  total++;
  if (await testAmber('🚀🌟💫⭐', 'none', 'Unicode emoji')) {
    passed++;
  }
  
  log('bright', '\n' + '=' .repeat(60));
  log('bright', '📊 PODSUMOWANIE TESTÓW ODPORNOŚCI');
  log('bright', '=' .repeat(60));
  
  if (passed === total) {
    log('green', `✅ WSZYSTKIE TESTY ODPORNOŚCI PRZESZŁY! (${passed}/${total})`);
  } else {
    log('red', `❌ ${total - passed} TESTÓW ODPORNOŚCI NIE PRZESZŁO (${passed}/${total})`);
  }
  
  return { passed, total };
}

// Uruchom testy
async function runAllTests() {
  log('bright', '\n🚀 URUCHAMIANIE WSZYSTKICH TESTÓW AMBER');
  log('bright', '=' .repeat(80));
  
  const basicResults = await runTests();
  const edgeResults = await runEdgeCaseTests();
  
  const totalPassed = basicResults.passed + edgeResults.passed;
  const totalTests = basicResults.total + edgeResults.total;
  
  log('bright', '\n' + '=' .repeat(80));
  log('bright', '🏆 FINALNE PODSUMOWANIE');
  log('bright', '=' .repeat(80));
  
  if (totalPassed === totalTests) {
    log('green', `🎉 WSZYSTKIE TESTY PRZESZŁY! (${totalPassed}/${totalTests})`);
    log('green', '🛡️ Amber jest KULOODPORNA!');
  } else {
    log('red', `❌ ${totalTests - totalPassed} TESTÓW NIE PRZESZŁO (${totalPassed}/${totalTests})`);
    log('yellow', '🔧 Wymagane poprawki przed produkcją');
  }
  
  log('yellow', `\n📊 Szczegóły:`);
  log('blue', `   - Testy podstawowe: ${basicResults.passed}/${basicResults.total}`);
  log('blue', `   - Testy odporności: ${edgeResults.passed}/${edgeResults.total}`);
}

runAllTests().catch(console.error);
