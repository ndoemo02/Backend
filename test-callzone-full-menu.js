// test-callzone-full-menu.js - Test czy Brain API wykrywa wszystkie 35 pozycji Callzone
// Node.js v18+ ma wbudowany fetch, nie potrzeba node-fetch

const API_URL = 'http://localhost:3000';
const SESSION_ID = 'test-callzone-' + Date.now();

async function testCallzoneFullMenu() {
  console.log('🧪 Testing Callzone Full Menu (35 items)\n');
  console.log(`Session ID: ${SESSION_ID}\n`);
  
  const tests = [
    {
      name: '1️⃣ Find Callzone',
      text: 'Pokaż menu Callzone',
      expectedMenuCount: 35
    },
    {
      name: '2️⃣ Order Pizza from Callzone',
      text: 'Zamów pizzę margherita',
      expectedIntent: 'create_order'
    },
    {
      name: '3️⃣ Order Burger from Callzone',
      text: 'Chcę bacon burgera',
      expectedIntent: 'create_order'
    },
    {
      name: '4️⃣ Order Salad from Callzone',
      text: 'Poproszę sałatkę Cezar',
      expectedIntent: 'create_order'
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
          includeTTS: false
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      const data = await response.json();
      
      console.log(`✅ Intent: ${data.intent}`);
      console.log(`🎯 Confidence: ${data.confidence}`);
      console.log(`🏪 Restaurant: ${data.restaurant?.name || 'brak'}`);
      console.log(`💬 Amber: ${data.reply?.substring(0, 120)}...`);
      
      // Check menu items count
      if (data.context?.last_menu) {
        const menuCount = data.context.last_menu.length;
        console.log(`📋 Menu loaded: ${menuCount} items`);
        
        if (test.expectedMenuCount && menuCount < test.expectedMenuCount) {
          console.log(`⚠️  Expected ${test.expectedMenuCount} items, got only ${menuCount}`);
          console.log(`   Sample items: ${data.context.last_menu.slice(0, 5).map(m => m.name).join(', ')}...`);
        } else if (test.expectedMenuCount && menuCount >= test.expectedMenuCount) {
          console.log(`✅ All ${menuCount} items loaded successfully!`);
        }
      }
      
    } catch (error) {
      console.error(`❌ Error: ${error.message}`);
    }
    
    // Odczekaj między testami
    if (i < tests.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('🎉 Callzone menu test completed!');
  console.log('\n⚠️  UWAGA: Jeśli widzisz tylko 4 pozycje zamiast 35:');
  console.log('   1. Zrestartuj backend: npm start');
  console.log('   2. Uruchom test ponownie: node test-callzone-full-menu.js');
}

// Check if server is running
async function checkHealth() {
  try {
    const response = await fetch(`${API_URL}/api/health`);
    const data = await response.json();
    
    if (data.ok) {
      console.log('✅ Backend is running\n');
      return true;
    }
  } catch (error) {
    console.error('❌ Backend is not running. Start it with: npm start');
    return false;
  }
}

// Run test
(async () => {
  if (await checkHealth()) {
    await testCallzoneFullMenu();
  }
})();

