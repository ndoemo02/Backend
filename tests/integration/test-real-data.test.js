/**
 * Testy integracyjne z prawdziwymi danymi z Supabase
 * Weryfikuje zgodność mockowych danych z rzeczywistą strukturą bazy
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { supabase } from '../../api/brain/supabaseClient.js';
import { parseOrderItems } from '../../api/brain/intent-router.js';

describe('Real Data Integration Tests', () => {
  let realMenuItems = [];
  let realRestaurants = [];
  let sampleCatalog = [];

  beforeAll(async () => {
    // Pobierz przykładowe dane z prawdziwej bazy
    try {
      // Pobierz kilka przykładowych pozycji menu
      const { data: menuData, error: menuError } = await supabase
        .from('menu_items_v2')
        .select('id, name, price_pln, restaurant_id, category, available')
        .limit(20);

      if (menuError) {
        console.warn('⚠️ Could not fetch real menu data:', menuError.message);
        return;
      }

      realMenuItems = menuData || [];

      if (realMenuItems.length > 0) {
        // Pobierz nazwy restauracji dla tych pozycji
        const restaurantIds = [...new Set(realMenuItems.map(mi => mi.restaurant_id))];
        
        const { data: restData, error: restError } = await supabase
          .from('restaurants')
          .select('id, name')
          .in('id', restaurantIds);

        if (!restError && restData) {
          realRestaurants = restData;
          const restaurantMap = {};
          realRestaurants.forEach(r => {
            restaurantMap[r.id] = r.name;
          });

          // Stwórz katalog w formacie używanym przez parseOrderItems
          sampleCatalog = realMenuItems.map(mi => ({
            id: mi.id,
            name: mi.name,
            price: mi.price_pln,
            restaurant_id: mi.restaurant_id,
            restaurant_name: restaurantMap[mi.restaurant_id] || 'Unknown',
            category: mi.category,
            available: mi.available
          }));
        }
      }
    } catch (err) {
      console.warn('⚠️ Error fetching real data:', err.message);
    }
  });

  describe('Data Structure Validation', () => {
    it('should have real menu items from database', () => {
      expect(realMenuItems.length).toBeGreaterThan(0);
    });

    it('should have correct structure for menu items', () => {
      if (realMenuItems.length === 0) {
        console.warn('⚠️ Skipping - no real data available');
        return;
      }

      const sample = realMenuItems[0];
      
      // Sprawdź wymagane pola
      expect(sample).toHaveProperty('id');
      expect(sample).toHaveProperty('name');
      expect(sample).toHaveProperty('price_pln');
      expect(sample).toHaveProperty('restaurant_id');
      
      // Sprawdź typy
      expect(typeof sample.id).toBe('string');
      expect(typeof sample.name).toBe('string');
      expect(typeof sample.price_pln).toBe('number');
      expect(typeof sample.restaurant_id).toBe('string');
    });

    it('should have restaurant names for menu items', () => {
      if (realRestaurants.length === 0) {
        console.warn('⚠️ Skipping - no restaurant data available');
        return;
      }

      const sample = realRestaurants[0];
      expect(sample).toHaveProperty('id');
      expect(sample).toHaveProperty('name');
      expect(typeof sample.name).toBe('string');
    });
  });

  describe('Catalog Format Compatibility', () => {
    it('should create catalog in correct format', () => {
      if (sampleCatalog.length === 0) {
        console.warn('⚠️ Skipping - no catalog data available');
        return;
      }

      const sample = sampleCatalog[0];
      
      // Sprawdź format zgodny z mockCatalog w testach jednostkowych
      expect(sample).toHaveProperty('id');
      expect(sample).toHaveProperty('name');
      expect(sample).toHaveProperty('price');
      expect(sample).toHaveProperty('restaurant_id');
      expect(sample).toHaveProperty('restaurant_name');
    });

    it('should have valid price values', () => {
      if (sampleCatalog.length === 0) {
        console.warn('⚠️ Skipping - no catalog data available');
        return;
      }

      sampleCatalog.forEach(item => {
        expect(typeof item.price).toBe('number');
        expect(item.price).toBeGreaterThanOrEqual(0);
      });
    });

    it('should have non-empty names', () => {
      if (sampleCatalog.length === 0) {
        console.warn('⚠️ Skipping - no catalog data available');
        return;
      }

      sampleCatalog.forEach(item => {
        expect(item.name).toBeTruthy();
        expect(item.name.trim().length).toBeGreaterThan(0);
      });
    });
  });

  describe('parseOrderItems with Real Data', () => {
    it('should parse order items from real menu data', () => {
      if (sampleCatalog.length === 0) {
        console.warn('⚠️ Skipping - no catalog data available');
        return;
      }

      // Użyj nazwy z prawdziwej bazy
      const testItem = sampleCatalog[0];
      const result = parseOrderItems(testItem.name, sampleCatalog);

      // Sprawdź czy parser znalazł pozycję
      const allItems = [
        ...(result.available || []),
        ...(result.groups?.flatMap(g => g.items || []) || [])
      ];
      const hasClarifications = result.clarify && result.clarify.length > 0;

      // Powinno znaleźć przynajmniej jedno dopasowanie LUB wymagać doprecyzowania
      expect(allItems.length > 0 || hasClarifications).toBe(true);
    });

    it('should handle Polish characters in real menu item names', () => {
      if (sampleCatalog.length === 0) {
        console.warn('⚠️ Skipping - no catalog data available');
        return;
      }

      // Znajdź pozycję z polskimi znakami
      const polishItem = sampleCatalog.find(item => 
        /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(item.name)
      );

      if (!polishItem) {
        console.warn('⚠️ No items with Polish characters found');
        return;
      }

      const result = parseOrderItems(polishItem.name, sampleCatalog);
      const allItems = [
        ...(result.available || []),
        ...(result.groups?.flatMap(g => g.items || []) || [])
      ];
      const hasClarifications = result.clarify && result.clarify.length > 0;

      expect(allItems.length > 0 || hasClarifications).toBe(true);
    });

    it('should handle partial matches with real data', () => {
      if (sampleCatalog.length === 0) {
        console.warn('⚠️ Skipping - no catalog data available');
        return;
      }

      // Użyj części nazwy (np. pierwsze słowo)
      const testItem = sampleCatalog[0];
      const firstWord = testItem.name.split(' ')[0];
      
      if (firstWord.length < 3) {
        console.warn('⚠️ First word too short for testing');
        return;
      }

      const result = parseOrderItems(firstWord, sampleCatalog);
      const allItems = [
        ...(result.available || []),
        ...(result.groups?.flatMap(g => g.items || []) || [])
      ];
      const hasClarifications = result.clarify && result.clarify.length > 0;

      // Powinno znaleźć dopasowanie (może wymagać doprecyzowania jeśli są warianty)
      expect(allItems.length > 0 || hasClarifications).toBe(true);
    });
  });

  describe('Mock vs Real Data Comparison', () => {
    it('should have same structure as mockCatalog', () => {
      if (sampleCatalog.length === 0) {
        console.warn('⚠️ Skipping - no catalog data available');
        return;
      }

      const mockCatalog = [
        { id: '1', name: 'Pizza Margherita', price: 25.00, category: 'pizza', restaurant_id: 'r1', restaurant_name: 'Test Pizza' }
      ];

      const realItem = sampleCatalog[0];
      const mockItem = mockCatalog[0];

      // Sprawdź czy mają te same klucze
      const realKeys = Object.keys(realItem).sort();
      const mockKeys = Object.keys(mockItem).sort();

      // Real data może mieć dodatkowe pola (category, available), ale powinna mieć wszystkie wymagane
      expect(mockKeys.every(key => realKeys.includes(key))).toBe(true);
    });

    it('should have compatible data types', () => {
      if (sampleCatalog.length === 0) {
        console.warn('⚠️ Skipping - no catalog data available');
        return;
      }

      const realItem = sampleCatalog[0];
      const mockItem = {
        id: '1',
        name: 'Test',
        price: 25.00,
        restaurant_id: 'r1',
        restaurant_name: 'Test'
      };

      // Sprawdź typy
      expect(typeof realItem.id).toBe(typeof mockItem.id);
      expect(typeof realItem.name).toBe(typeof mockItem.name);
      expect(typeof realItem.price).toBe(typeof mockItem.price);
      expect(typeof realItem.restaurant_id).toBe(typeof mockItem.restaurant_id);
      expect(typeof realItem.restaurant_name).toBe(typeof mockItem.restaurant_name);
    });
  });

  describe('Real Data Statistics', () => {
    it('should report data statistics', () => {
      if (sampleCatalog.length === 0) {
        console.warn('⚠️ No real data available for statistics');
        return;
      }

      const stats = {
        totalItems: sampleCatalog.length,
        uniqueRestaurants: new Set(sampleCatalog.map(item => item.restaurant_id)).size,
        avgPrice: sampleCatalog.reduce((sum, item) => sum + item.price, 0) / sampleCatalog.length,
        itemsWithPolishChars: sampleCatalog.filter(item => 
          /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(item.name)
        ).length,
        itemsWithSizeVariants: sampleCatalog.filter(item => 
          /\b(mała|duża|średnia|small|large|medium)\b/i.test(item.name)
        ).length
      };

      console.log('📊 Real Data Statistics:', stats);
      
      expect(stats.totalItems).toBeGreaterThan(0);
      expect(stats.uniqueRestaurants).toBeGreaterThan(0);
      expect(stats.avgPrice).toBeGreaterThan(0);
    });
  });
});




