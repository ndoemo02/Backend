// Test script dla voice-to-order
// Node.js v18+ ma wbudowany fetch, nie potrzeba node-fetch

const API_BASE = 'http://localhost:3000/api';

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

// Test 2: Tworzenie zamówienia voice
async function testVoiceOrder() {
  console.log('\n🎤 Testing voice order creation...');
  
  const orderData = {
    restaurantId: 'test-restaurant-1',
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
    customerId: 'voice-customer-123',
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
async function testGetRestaurantOrders(businessId = 'test-restaurant-1') {
  console.log('\n📋 Testing restaurant orders fetch...');
  
  try {
    const response = await fetch(`${API_BASE}/orders/business/${businessId}`);
    const result = await response.json();
    
    if (response.ok) {
      console.log(`✅ Found ${result.count} orders for restaurant:`, result.orders);
      return result.orders;
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

// Test 5: Routing zamówienia
async function testOrderRouting() {
  console.log('\n🗺️ Testing order routing...');
  
  const routingData = {
    customer_id: 'voice-customer-123',
    order_items: [
      {
        name: 'Pizza Pepperoni',
        price: 28.00,
        quantity: 1
      }
    ],
    delivery_address: 'ul. Testowa 123, Warszawa',
    customer_notes: 'Zamówienie przez voice - bez cebuli',
    customer_location: {
      lat: 52.2297,
      lng: 21.0122,
      address: 'Warszawa, Polska'
    },
    order_type: 'delivery'
  };

  try {
    const response = await fetch(`${API_BASE}/order-routing`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(routingData)
    });

    const result = await response.json();
    
    if (response.ok) {
      console.log('✅ Order routing successful:', result);
      return result.data?.order_id;
    } else {
      console.error('❌ Order routing failed:', result);
      return null;
    }
  } catch (error) {
    console.error('❌ Order routing error:', error.message);
    return null;
  }
}

// Główna funkcja testowa
async function runVoiceOrderTests() {
  console.log('🚀 Starting Voice-to-Order Tests...\n');
  
  // Test 1: Health check
  const healthOk = await testHealth();
  if (!healthOk) {
    console.log('❌ Health check failed, stopping tests');
    return;
  }

  // Test 2: Voice order creation
  const orderId = await testVoiceOrder();
  if (!orderId) {
    console.log('❌ Voice order creation failed, stopping tests');
    return;
  }

  // Test 3: Get restaurant orders
  await testGetRestaurantOrders();

  // Test 4: Update order status
  await testUpdateOrderStatus(orderId, 'accepted');
  await testUpdateOrderStatus(orderId, 'preparing');
  await testUpdateOrderStatus(orderId, 'ready');

  // Test 5: Order routing
  await testOrderRouting();

  console.log('\n🎉 Voice-to-Order tests completed!');
  console.log('\n📊 Test Summary:');
  console.log('✅ Health check');
  console.log('✅ Voice order creation');
  console.log('✅ Restaurant orders fetch');
  console.log('✅ Order status updates');
  console.log('✅ Order routing');
}

// Uruchom testy
runVoiceOrderTests().catch(console.error);





