// test-brain-integration.js - Test full flow: rozpoznawanie restauracji, menu, TTS
// Node.js v18+ ma wbudowany fetch, nie potrzeba node-fetch

const API_URL = 'http://localhost:3000';
const SESSION_ID = 'test-integration-' + Date.now();

async function testBrainIntegration() {
  console.log('🧪 Testing FreeFlow /api/brain full integration\n');
  console.log(`Session ID: ${SESSION_ID}\n`);
  
  const tests = [
    {
      name: '1️⃣ Find Restaurants by Location',
      text: 'Gdzie mogę zjeść w Bytomiu?',
      expectedIntent: 'find_nearby'
    },
    {
      name: '2️⃣ Select Restaurant (contextual)',
      text: 'Wybierz pierwszą',
      expectedIntent: 'select_restaurant'
    },
    {
      name: '3️⃣ Show Menu',
      text: 'Pokaż menu',
      expectedIntent: 'menu_request'
    },
    {
      name: '4️⃣ Order Dish',
      text: 'Zamów pizzę margarita',
      expectedIntent: 'create_order'
    },
    {
      name: '5️⃣ Confirm Order',
      text: 'Tak, potwierdź',
      expectedIntent: 'confirm'
    }
  ];

  for (let i = 0; i < tests.length; i++) {
    const test = tests[i];
    console.log(`\n${test.name}`);
    console.log(`📝 Input: "${test.text}"`);
    console.log('─'.repeat(60));
    
    try {
      const response = await fetch(`${API_URL}/api/brain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: test.text,
          sessionId: SESSION_ID,
          includeTTS: false // Wyłącz TTS w testach (szybciej)
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      const data = await response.json();
      
      console.log(`✅ Intent: ${data.intent}`);
      console.log(`🎯 Confidence: ${data.confidence}`);
      console.log(`🏪 Restaurant: ${data.restaurant?.name || 'brak'}`);
      console.log(`💬 Amber: ${data.reply?.substring(0, 150)}${data.reply?.length > 150 ? '...' : ''}`);
      
      // Verify intent
      if (test.expectedIntent && data.intent !== test.expectedIntent) {
        console.log(`⚠️  Expected intent: ${test.expectedIntent}, got: ${data.intent}`);
      }
      
    } catch (error) {
      console.error(`❌ Error: ${error.message}`);
    }
    
    // Odczekaj 1s między testami
    if (i < tests.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('🎉 Integration test completed!');
}

// Test TTS endpoint separately
async function testTTS() {
  console.log('\n\n🎤 Testing TTS endpoint...');
  
  try {
    const response = await fetch(`${API_URL}/api/brain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Cześć, jestem Amber',
        sessionId: SESSION_ID + '-tts',
        includeTTS: true
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    
    if (data.audioContent) {
      console.log(`✅ TTS Audio generated: ${data.audioContent.substring(0, 50)}... (${data.audioContent.length} chars base64)`);
      console.log(`🔊 Encoding: ${data.audioEncoding}`);
    } else {
      console.log('⚠️  No audio content in response');
    }
    
  } catch (error) {
    console.error(`❌ TTS Error: ${error.message}`);
  }
}

// Check if server is running
async function checkHealth() {
  try {
    const response = await fetch(`${API_URL}/api/health`);
    const data = await response.json();
    
    if (data.ok) {
      console.log('✅ Backend is running');
      console.log(`📊 Supabase: ${data.supabase.ok ? '✅ Connected' : '❌ Disconnected'}`);
      return true;
    }
  } catch (error) {
    console.error('❌ Backend is not running. Start it with: npm start');
    return false;
  }
}

// Run tests
(async () => {
  if (await checkHealth()) {
    await testBrainIntegration();
    await testTTS();
  }
})();

