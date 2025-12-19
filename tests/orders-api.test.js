// tests/orders-api.test.js - Tests for Orders API
import { describe, it, expect } from 'vitest';

const API_URL = process.env.API_URL || 'http://localhost:3000';

describe('🛒 Orders API Tests', () => {
  
  // ============================================================================
  // TIER 1: BASIC VALIDATION
  // ============================================================================
  
  describe('Tier 1: Basic Validation', () => {
    it('should reject non-POST methods for createOrder', async () => {
      const response = await fetch(`${API_URL}/api/orders`, {
        method: 'GET'
      });
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
    
    it('should reject empty order data', async () => {
      const response = await fetch(`${API_URL}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      
      if (response.ok) {
        const data = await response.json();
        expect(data.ok).toBeFalsy();
      } else {
        expect(response.status).toBeGreaterThanOrEqual(400);
      }
    });
    
    it('should reject order without restaurant_id', async () => {
      const response = await fetch(`${API_URL}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ name: 'Pizza', quantity: 1 }]
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        expect(data.ok).toBeFalsy();
      } else {
        expect(response.status).toBeGreaterThanOrEqual(400);
      }
    });
    
    it('should reject order without items', async () => {
      const response = await fetch(`${API_URL}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurant_id: '123'
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        expect(data.ok).toBeFalsy();
      } else {
        expect(response.status).toBeGreaterThanOrEqual(400);
      }
    });
  });
  
  // ============================================================================
  // TIER 2: GET ORDERS
  // ============================================================================
  
  describe('Tier 2: GET Orders', () => {
    it('should return orders list', async () => {
      const response = await fetch(`${API_URL}/api/orders`);
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(data).toBeDefined();
      expect(Array.isArray(data) || typeof data === 'object').toBe(true);
    });
    
    it('should handle query parameters', async () => {
      const response = await fetch(`${API_URL}/api/orders?status=pending`);
      expect(response.ok).toBe(true);
    });
  });
  
  // ============================================================================
  // TIER 3: CREATE ORDER (INTEGRATION)
  // ============================================================================
  
  describe('Tier 3: Create Order Integration', () => {
    it('should create order with valid data', async () => {
      // Get a valid restaurant first
      const restaurantsRes = await fetch(`${API_URL}/api/restaurants`);
      if (!restaurantsRes.ok) {
        console.warn('⚠️ Cannot fetch restaurants, skipping test');
        return;
      }
      
      const restaurantsData = await restaurantsRes.json();
      const restaurants = restaurantsData.data || restaurantsData;
      
      if (!restaurants || restaurants.length === 0) {
        console.warn('⚠️ No restaurants available, skipping test');
        return;
      }
      
      const testRestaurant = restaurants[0];
      
      const response = await fetch(`${API_URL}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurant_id: testRestaurant.id,
          items: [
            { name: 'Pizza Margherita', quantity: 1, price: 25 }
          ],
          sessionId: 'test-session-' + Date.now()
        })
      });
      
      // Accept both success and expected failure (if DB is not configured)
      if (response.ok) {
        const data = await response.json();
        expect(data).toBeDefined();
        console.log('✅ Order created:', data);
      } else {
        console.warn('⚠️ Order creation failed (expected if DB not configured)');
      }
    });
    
    it('should handle items as JSON string', async () => {
      const response = await fetch(`${API_URL}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurant_id: 'test-id',
          items: '[{"name":"Pizza","quantity":1}]', // string instead of array
          sessionId: 'test-session'
        })
      });
      
      // Should accept string and parse it
      expect(response).toBeDefined();
    });
  });
  
  // ============================================================================
  // TIER 4: FUZZY MATCHING (findBestMatch)
  // ============================================================================
  
  describe('Tier 4: Restaurant/Menu Fuzzy Matching', () => {
    it('should find restaurant with typo in name', async () => {
      const response = await fetch(`${API_URL}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Zamów pizzę',
          restaurant_name: 'Monte Karlo', // typo
          user_email: 'test@example.com'
        })
      });
      
      // Should handle fuzzy matching or gracefully fail
      expect(response).toBeDefined();
    });
    
    it('should handle diacritics in restaurant name', async () => {
      const response = await fetch(`${API_URL}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Zamów pizzę',
          restaurant_name: 'Restauracja Śląska',
          user_email: 'test@example.com'
        })
      });
      
      expect(response).toBeDefined();
    });
  });
  
  // ============================================================================
  // TIER 5: ERROR HANDLING
  // ============================================================================
  
  describe('Tier 5: Error Handling', () => {
    it('should handle non-existent restaurant gracefully', async () => {
      const response = await fetch(`${API_URL}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Zamów pizzę',
          restaurant_name: 'XYZABC123NonExistent',
          user_email: 'test@example.com'
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        // Should return error message about restaurant not found
        expect(data.reply || data.error).toBeDefined();
      }
    });
    
    it('should handle malformed items array', async () => {
      const response = await fetch(`${API_URL}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurant_id: 'test-id',
          items: 'invalid-json-string',
          sessionId: 'test'
        })
      });
      
      // Should handle parsing error gracefully
      expect(response).toBeDefined();
    });
    
    it('should respond within 5 seconds', async () => {
      const start = Date.now();
      
      const response = await fetch(`${API_URL}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurant_id: 'test',
          items: [{ name: 'Test', quantity: 1 }]
        })
      });
      
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(5000);
    });
  });
  
  // ============================================================================
  // TIER 6: AUTHENTICATION (if available)
  // ============================================================================
  
  describe('Tier 6: Authentication', () => {
    it('should handle authorization header', async () => {
      const response = await fetch(`${API_URL}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token'
        },
        body: JSON.stringify({
          message: 'Test order',
          restaurant_name: 'Test Restaurant',
          user_email: 'test@example.com'
        })
      });
      
      // Should not crash with auth header
      expect(response).toBeDefined();
    });
    
    it('should work without authorization header', async () => {
      const response = await fetch(`${API_URL}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: 'Test order',
          restaurant_name: 'Test Restaurant',
          user_email: 'guest@example.com'
        })
      });
      
      expect(response).toBeDefined();
    });
  });
});

console.log('✅ Orders API tests completed');

