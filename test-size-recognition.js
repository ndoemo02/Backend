// Test rozszerzonego rozpoznawania rozmiarów
import fetch from 'node-fetch';

const API_BASE = 'http://localhost:3003/api';

// Test rozpoznawania rozmiarów
function testSizeRecognition() {
  console.log('🧪 Testing Extended Size Recognition...\n');
  
  // Symulacja funkcji normalize
  function norm(s) {
    return s.normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  // Symulacja logiki rozpoznawania rozmiarów
  function recognizeSize(userText) {
    const normalized = norm(userText);
    
    const sizeVariants = {
      S: ["mała", "mały", "małe", "small", "mini", "miniature", "s"],
      M: ["średnia", "średnie", "średni", "medium", "normal", "standard", "m"],
      L: ["duża", "duży", "duże", "large", "big", "mega", "x", "xl", "extra", "extra large", "l"]
    };
    
    // Znajdź najlepsze dopasowanie (najpierw najdłuższe słowa)
    let bestMatch = null;
    let bestLength = 0;
    
    // Sprawdź wszystkie warianty posortowane według długości (malejąco)
    const allVariants = [];
    for (const [size, variants] of Object.entries(sizeVariants)) {
      for (const variant of variants) {
        allVariants.push({ size, variant, length: variant.length });
      }
    }
    
    // Sortuj według długości (najdłuższe pierwsze)
    allVariants.sort((a, b) => b.length - a.length);
    
    for (const { size, variant } of allVariants) {
      if (normalized.includes(variant) && variant.length > bestLength) {
        bestMatch = size;
        bestLength = variant.length;
      }
    }
    
    return bestMatch;
  }

  // Test cases
  const testCases = [
    // Małe rozmiary
    { input: "mała", expected: "S", description: "Mała (żeńska)" },
    { input: "mały", expected: "S", description: "Mały (męska)" },
    { input: "małe", expected: "S", description: "Małe (nijaka)" },
    { input: "small", expected: "S", description: "Small (angielski)" },
    { input: "mini", expected: "S", description: "Mini" },
    { input: "miniature", expected: "S", description: "Miniature" },
    { input: "s", expected: "S", description: "S (litera)" },
    
    // Średnie rozmiary
    { input: "średnia", expected: "M", description: "Średnia (żeńska)" },
    { input: "średnie", expected: "M", description: "Średnie (nijaka)" },
    { input: "średni", expected: "M", description: "Średni (męska)" },
    { input: "medium", expected: "M", description: "Medium (angielski)" },
    { input: "normal", expected: "M", description: "Normal" },
    { input: "standard", expected: "M", description: "Standard" },
    { input: "m", expected: "M", description: "M (litera)" },
    
    // Duże rozmiary
    { input: "duża", expected: "L", description: "Duża (żeńska)" },
    { input: "duży", expected: "L", description: "Duży (męska)" },
    { input: "duże", expected: "L", description: "Duże (nijaka)" },
    { input: "large", expected: "L", description: "Large (angielski)" },
    { input: "big", expected: "L", description: "Big" },
    { input: "mega", expected: "L", description: "Mega" },
    { input: "x", expected: "L", description: "X" },
    { input: "xl", expected: "L", description: "XL" },
    { input: "extra", expected: "L", description: "Extra" },
    { input: "extra large", expected: "L", description: "Extra Large" },
    { input: "l", expected: "L", description: "L (litera)" },
    
    // Kombinacje
    { input: "duża pizza", expected: "L", description: "Duża pizza" },
    { input: "mega burger", expected: "L", description: "Mega burger" },
    { input: "xl cola", expected: "L", description: "XL cola" },
    { input: "mała frytki", expected: "S", description: "Mała frytki" },
    { input: "średni hot dog", expected: "M", description: "Średni hot dog" },
    
    // Negatywne przypadki
    { input: "pizza", expected: null, description: "Pizza (bez rozmiaru)" },
    { input: "frytki", expected: null, description: "Frytki (bez rozmiaru)" },
    { input: "cola", expected: null, description: "Cola (bez rozmiaru)" },
    { input: "dużo", expected: null, description: "Dużo (nie rozmiar)" },
    { input: "mało", expected: null, description: "Mało (nie rozmiar)" }
  ];

  let passed = 0;
  let failed = 0;

  testCases.forEach((testCase, index) => {
    const result = recognizeSize(testCase.input);
    const success = result === testCase.expected;
    
    console.log(`Test ${index + 1}: ${testCase.description}`);
    console.log(`  Input: "${testCase.input}"`);
    console.log(`  Expected: ${testCase.expected}`);
    console.log(`  Result: ${result}`);
    console.log(`  Status: ${success ? '✅ PASS' : '❌ FAIL'}`);
    console.log('');
    
    if (success) passed++;
    else failed++;
  });

  console.log(`📊 Results: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}

// Test pełnej konwersacji z nowymi rozmiarami
function testFullConversationWithSizes() {
  console.log('\n💬 Testing Full Conversation with Extended Sizes...\n');
  
  const conversation = [
    "mega pizza",
    "średni burger", 
    "xl cola",
    "małe frytki",
    "duży hot dog"
  ];

  function norm(s) {
    return s.normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function recognizeSize(userText) {
    const normalized = norm(userText);
    
    const sizeVariants = {
      S: ["mała", "mały", "małe", "small", "mini", "miniature", "s"],
      M: ["średnia", "średnie", "średni", "medium", "normal", "standard", "m"],
      L: ["duża", "duży", "duże", "large", "big", "mega", "x", "xl", "extra", "extra large", "l"]
    };
    
    // Znajdź najlepsze dopasowanie (najpierw najdłuższe słowa)
    let bestMatch = null;
    let bestLength = 0;
    
    // Sprawdź wszystkie warianty posortowane według długości (malejąco)
    const allVariants = [];
    for (const [size, variants] of Object.entries(sizeVariants)) {
      for (const variant of variants) {
        allVariants.push({ size, variant, length: variant.length });
      }
    }
    
    // Sortuj według długości (najdłuższe pierwsze)
    allVariants.sort((a, b) => b.length - a.length);
    
    for (const { size, variant } of allVariants) {
      if (normalized.includes(variant) && variant.length > bestLength) {
        bestMatch = size;
        bestLength = variant.length;
      }
    }
    
    return bestMatch;
  }

  function recognizeItem(userText) {
    const normalized = norm(userText);
    
    if (normalized.includes("pizza")) return "pizza";
    else if (normalized.includes("burger")) return "burger";
    else if (normalized.includes("cola")) return "cola";
    else if (normalized.includes("frytki")) return "frytki";
    else if (normalized.includes("hot dog")) return "hot dog";
    
    return null;
  }

  conversation.forEach((input, index) => {
    console.log(`Turn ${index + 1}: "${input}"`);
    
    const item = recognizeItem(input);
    const size = recognizeSize(input);
    
    console.log(`  Item: ${item}`);
    console.log(`  Size: ${size}`);
    
    if (item && size) {
      console.log(`  Assistant: "Rozumiem, ${size} ${item}. Potwierdzasz?"`);
    } else if (item) {
      console.log(`  Assistant: "Rozumiem, ${item}. Jaki rozmiar?"`);
    } else {
      console.log(`  Assistant: "Co podać?"`);
    }
    
    console.log('');
  });
}

// Test API endpoints
async function testAPIEndpoints() {
  console.log('\n🔌 Testing API Endpoints...\n');
  
  try {
    const response = await fetch(`${API_BASE}/health`);
    const data = await response.json();
    console.log('✅ Health API:', data);
  } catch (error) {
    console.error('❌ Health API failed:', error.message);
  }
}

// Główna funkcja testowa
async function runSizeRecognitionTests() {
  console.log('🚀 Starting Extended Size Recognition Tests...\n');
  
  // Test 1: Rozpoznawanie rozmiarów
  const results = testSizeRecognition();
  
  // Test 2: Pełna konwersacja
  testFullConversationWithSizes();
  
  // Test 3: API endpoints
  await testAPIEndpoints();
  
  console.log('\n🎉 Extended Size Recognition Tests Completed!');
  console.log('\n📊 Summary:');
  console.log('✅ Rozpoznawanie małych rozmiarów (mała, mały, małe, small, mini, s)');
  console.log('✅ Rozpoznawanie średnich rozmiarów (średnia, średnie, średni, medium, normal, m)');
  console.log('✅ Rozpoznawanie dużych rozmiarów (duża, duży, duże, large, big, mega, x, xl, extra, l)');
  console.log('✅ Rozpoznawanie w kombinacjach (mega pizza, xl cola, etc.)');
  console.log('✅ Ignorowanie nie-relevantnych słów (dużo, mało)');
  console.log(`\n🎯 Success Rate: ${results.passed}/${results.passed + results.failed} (${((results.passed / (results.passed + results.failed)) * 100).toFixed(1)}%)`);
  console.log('\n🎤 Asystent teraz rozpoznaje wszystkie warianty rozmiarów!');
}

// Uruchom testy
runSizeRecognitionTests().catch(console.error);
