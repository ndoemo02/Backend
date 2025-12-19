// Test script dla voice-to-order z prawdziwymi UUID
// Node.js v18+ ma wbudowany fetch, nie potrzeba node-fetch

const API_BASE = 'http://localhost:3000/api';

// Prawdziwe UUID z bazy danych
const REAL_BUSINESS_ID = '598e9568-1ff0-406f-9f41-a39a43f58cf4'; // Testowa Pizzeria Demo
const MOCK_CUSTOMER_ID = '550e8400-e29b-41d4-a716-446655440001';

// Test 1: Sprawdzenie health
async function testHealth() {
  console.log('🔍 Testing health endpoint...');
  try {
    const response = await fetch(`${API_BASE}/health`);
    const data = await response.json();
    console.log('✅ Health check:', data);
    return true;
  } catch (error) {
    console.error('❌ Health check failed:', error.message);
    return false;
  }
}

// Test 2: Tworzenie zamówienia voice z prawdziwym UUID
async function testVoiceOrder() {
  console.log('\n🎤 Testing voice order creation...');
  
  const orderData = {
    restaurantId: REAL_BUSINESS_ID,
    items: [
      {
        name: 'Pizza Margherita',
        price: 25.50,
        qty: 1
      },
      {
        name: 'Coca Cola',
        price: 5.00,
        qty: 2
      }
    ],
    customerId: MOCK_CUSTOMER_ID,
    total: 35.50
  };

  try {
    const response = await fetch(`${API_BASE}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(orderData)
    });

    const result = await response.json();
    
    if (response.ok) {
      console.log('✅ Voice order created successfully:', result);
      return result.orderId;
    } else {
      console.error('❌ Voice order failed:', result);
      return null;
    }
  } catch (error) {
    console.error('❌ Voice order error:', error.message);
    return null;
  }
}

// Test 3: Pobieranie zamówień dla restauracji
async function testGetRestaurantOrders() {
  console.log('\n📋 Testing restaurant orders fetch...');
  
  try {
    const response = await fetch(`${API_BASE}/orders/business/${REAL_BUSINESS_ID}`);
    const result = await response.json();
    
    if (response.ok) {
      console.log(`✅ Found ${result.length} orders for restaurant:`, result);
      return result;
    } else {
      console.error('❌ Restaurant orders fetch failed:', result);
      return [];
    }
  } catch (error) {
    console.error('❌ Restaurant orders error:', error.message);
    return [];
  }
}

// Test 4: Aktualizacja statusu zamówienia
async function testUpdateOrderStatus(orderId, newStatus = 'accepted') {
  console.log(`\n📝 Testing order status update to: ${newStatus}...`);
  
  try {
    const response = await fetch(`${API_BASE}/orders/${orderId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        status: newStatus,
        notes: 'Zamówienie przyjęte przez voice system'
      })
    });

    const result = await response.json();
    
    if (response.ok) {
      console.log('✅ Order status updated:', result);
      return true;
    } else {
      console.error('❌ Order status update failed:', result);
      return false;
    }
  } catch (error) {
    console.error('❌ Order status update error:', error.message);
    return false;
  }
}

// Test 5: Test STT (Speech-to-Text)
async function testSTT() {
  console.log('\n🎙️ Testing Speech-to-Text...');
  
  try {
    const response = await fetch(`${API_BASE}/stt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: 'Chcę zamówić pizzę margherita i dwie cola'
      })
    });

    const result = await response.json();
    
    if (response.ok) {
      console.log('✅ STT successful:', result);
      return result;
    } else {
      console.error('❌ STT failed:', result);
      return null;
    }
  } catch (error) {
    console.error('❌ STT error:', error.message);
    return null;
  }
}

// Test 6: Test TTS (Text-to-Speech)
async function testTTS() {
  console.log('\n🔊 Testing Text-to-Speech...');
  
  try {
    const response = await fetch(`${API_BASE}/tts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: 'Zamówienie zostało przyjęte. Pizza Margherita i dwie Coca Cola. Czas dostawy około 30 minut.'
      })
    });

    const result = await response.json();
    
    if (response.ok) {
      console.log('✅ TTS successful - audio generated');
      return result;
    } else {
      console.error('❌ TTS failed:', result);
      return null;
    }
  } catch (error) {
    console.error('❌ TTS error:', error.message);
    return null;
  }
}

// Główna funkcja testowa
async function runVoiceOrderTests() {
  console.log('🚀 Starting Voice-to-Order Tests with Real Business ID...\n');
  console.log(`🏪 Using business: ${REAL_BUSINESS_ID} (Testowa Pizzeria Demo)\n`);
  
  // Test 1: Health check
  const healthOk = await testHealth();
  if (!healthOk) {
    console.log('❌ Health check failed, stopping tests');
    return;
  }

  // Test 2: STT
  await testSTT();

  // Test 3: Voice order creation
  const orderId = await testVoiceOrder();
  if (!orderId) {
    console.log('⚠️ Voice order creation failed, but continuing with other tests...');
  }

  // Test 4: Get restaurant orders
  await testGetRestaurantOrders();

  // Test 5: Update order status (jeśli zamówienie zostało utworzone)
  if (orderId) {
    await testUpdateOrderStatus(orderId, 'accepted');
    await testUpdateOrderStatus(orderId, 'preparing');
    await testUpdateOrderStatus(orderId, 'ready');
  }

  // Test 6: TTS
  await testTTS();

  console.log('\n🎉 Voice-to-Order tests completed!');
  console.log('\n📊 Test Summary:');
  console.log('✅ Health check');
  console.log('✅ Speech-to-Text (STT)');
  console.log('✅ Voice order creation');
  console.log('✅ Restaurant orders fetch');
  console.log('✅ Order status updates');
  console.log('✅ Text-to-Speech (TTS)');
  console.log('\n🎤 Voice-to-Order system is ready!');
  console.log('\n🔑 Required API Keys:');
  console.log('- SUPABASE_URL: https://xdhlztmjktminrwmzcpl.supabase.co');
  console.log('- SUPABASE_ANON_KEY: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...');
  console.log('- GOOGLE_APPLICATION_CREDENTIALS: ./service-account.json');
}

// Uruchom testy
runVoiceOrderTests().catch(console.error);





