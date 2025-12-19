const API_URL = 'http://localhost:3000/api/brain';

async function testAmberLocation(text) {
  console.log(`\n📡 Testing: "${text}"`);
  
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: text,
        sessionId: 'test-location-session',
        includeTTS: false
      })
    });

    const data = await response.json();
    
    console.log('✅ Response:');
    console.log('  Intent:', data.intent);
    console.log('  Reply:', data.reply);
    console.log('  Restaurant:', data.restaurant?.name || 'NULL');
    console.log('  Context location:', data.context?.last_location || 'NULL');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function runTests() {
  console.log('🧪 Testing Amber location detection...\n');
  
  const testCases = [
    'Piekary Śląskie',
    'w Piekarach Śląskich',
    'Pokaż restauracje w Piekarach',
    'Gdzie mogę zjeść w Bytomiu',
    'Pizza w Katowicach'
  ];

  for (const testCase of testCases) {
    await testAmberLocation(testCase);
    await new Promise(resolve => setTimeout(resolve, 500)); // Delay between requests
  }
}

runTests();

