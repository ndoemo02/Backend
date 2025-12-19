/**
 * Testy walidacji struktury danych
 * Porównuje mockowe dane z oczekiwaną strukturą z Supabase
 */

import { describe, it, expect } from 'vitest';
import { parseOrderItems } from '../../api/brain/intent-router.js';

describe('Data Structure Validation', () => {
  // Mock catalog zgodny z formatem z loadMenuCatalog
  const mockCatalog = [
    { 
      id: '1', 
      name: 'Pizza Margherita', 
      price: 25.00, 
      category: 'pizza', 
      restaurant_id: 'r1', 
      restaurant_name: 'Test Pizza' 
    },
    { 
      id: '2', 
      name: 'Burger Classic', 
      price: 20.00, 
      category: 'burger', 
      restaurant_id: 'r1', 
      restaurant_name: 'Test Pizza' 
    },
    { 
      id: '3', 
      name: 'Kebab w bułce', 
      price: 18.00, 
      category: 'kebab', 
      restaurant_id: 'r1', 
      restaurant_name: 'Test Pizza' 
    },
    { 
      id: '4', 
      name: 'Mała Pizza Margherita', 
      price: 15.00, 
      category: 'pizza', 
      restaurant_id: 'r1', 
      restaurant_name: 'Test Pizza' 
    },
    { 
      id: '5', 
      name: 'Duża Pizza Margherita', 
      price: 35.00, 
      category: 'pizza', 
      restaurant_id: 'r1', 
      restaurant_name: 'Test Pizza' 
    }
  ];

  describe('Mock Catalog Structure', () => {
    it('should have all required fields', () => {
      mockCatalog.forEach(item => {
        expect(item).toHaveProperty('id');
        expect(item).toHaveProperty('name');
        expect(item).toHaveProperty('price');
        expect(item).toHaveProperty('restaurant_id');
        expect(item).toHaveProperty('restaurant_name');
      });
    });

    it('should have correct data types', () => {
      mockCatalog.forEach(item => {
        expect(typeof item.id).toBe('string');
        expect(typeof item.name).toBe('string');
        expect(typeof item.price).toBe('number');
        expect(typeof item.restaurant_id).toBe('string');
        expect(typeof item.restaurant_name).toBe('string');
      });
    });

    it('should have valid price values', () => {
      mockCatalog.forEach(item => {
        expect(item.price).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(item.price)).toBe(true);
      });
    });

    it('should have non-empty names', () => {
      mockCatalog.forEach(item => {
        expect(item.name).toBeTruthy();
        expect(item.name.trim().length).toBeGreaterThan(0);
      });
    });
  });

  describe('Compatibility with loadMenuCatalog Format', () => {
    it('should match format from loadMenuCatalog function', () => {
      // Format z loadMenuCatalog (intent-router.js:294-300):
      // {
      //   id: mi.id,
      //   name: mi.name,
      //   price: mi.price_pln,
      //   restaurant_id: mi.restaurant_id,
      //   restaurant_name: restaurantMap[mi.restaurant_id] || 'Unknown'
      // }

      const expectedFormat = {
        id: 'string',
        name: 'string',
        price: 'number',
        restaurant_id: 'string',
        restaurant_name: 'string'
      };

      mockCatalog.forEach(item => {
        Object.keys(expectedFormat).forEach(key => {
          expect(item).toHaveProperty(key);
          expect(typeof item[key]).toBe(expectedFormat[key]);
        });
      });
    });

    it('should handle missing optional fields gracefully', () => {
      // category i available są opcjonalne w niektórych miejscach
      const minimalItem = {
        id: 'test',
        name: 'Test Item',
        price: 10.00,
        restaurant_id: 'r1',
        restaurant_name: 'Test'
      };

      // parseOrderItems powinno działać z minimalnym formatem
      const result = parseOrderItems('Test Item', [minimalItem]);
      expect(result).toBeDefined();
      expect(result).toHaveProperty('available');
      expect(result).toHaveProperty('groups');
    });
  });

  describe('Real-World Scenarios', () => {
    it('should handle items with Polish characters', () => {
      const polishItems = [
        { id: '1', name: 'Żurek śląski', price: 15.00, restaurant_id: 'r1', restaurant_name: 'Test' },
        { id: '2', name: 'Kotlet schabowy', price: 22.00, restaurant_id: 'r1', restaurant_name: 'Test' },
        { id: '3', name: 'Pierogi ruskie', price: 18.00, restaurant_id: 'r1', restaurant_name: 'Test' }
      ];

      polishItems.forEach(item => {
        const result = parseOrderItems(item.name, polishItems);
        const allItems = [
          ...(result.available || []),
          ...(result.groups?.flatMap(g => g.items || []) || [])
        ];
        const hasClarifications = result.clarify && result.clarify.length > 0;
        
        expect(allItems.length > 0 || hasClarifications).toBe(true);
      });
    });

    it('should handle items with size variants', () => {
      const sizeVariants = [
        { id: '1', name: 'Pizza Margherita', price: 25.00, restaurant_id: 'r1', restaurant_name: 'Test' },
        { id: '2', name: 'Mała Pizza Margherita', price: 15.00, restaurant_id: 'r1', restaurant_name: 'Test' },
        { id: '3', name: 'Duża Pizza Margherita', price: 35.00, restaurant_id: 'r1', restaurant_name: 'Test' }
      ];

      // Test bez rozmiaru - powinno wymagać doprecyzowania
      const result1 = parseOrderItems('pizza margherita', sizeVariants);
      expect(result1.clarify && result1.clarify.length > 0).toBe(true);

      // Test z rozmiarem - powinno znaleźć konkretną pozycję
      const result2 = parseOrderItems('mała pizza margherita', sizeVariants);
      const allItems2 = [
        ...(result2.available || []),
        ...(result2.groups?.flatMap(g => g.items || []) || [])
      ];
      expect(allItems2.length).toBeGreaterThan(0);
    });

    it('should handle items with special characters', () => {
      const specialChars = [
        { id: '1', name: 'Crème brûlée', price: 12.00, restaurant_id: 'r1', restaurant_name: 'Test' },
        { id: '2', name: 'Café latte', price: 8.00, restaurant_id: 'r1', restaurant_name: 'Test' },
        { id: '3', name: 'Pizza "Pepperoni"', price: 28.00, restaurant_id: 'r1', restaurant_name: 'Test' }
      ];

      specialChars.forEach(item => {
        const result = parseOrderItems(item.name, specialChars);
        const allItems = [
          ...(result.available || []),
          ...(result.groups?.flatMap(g => g.items || []) || [])
        ];
        const hasClarifications = result.clarify && result.clarify.length > 0;
        
        expect(allItems.length > 0 || hasClarifications).toBe(true);
      });
    });

    it('should handle long item names', () => {
      const longNames = [
        { 
          id: '1', 
          name: 'Pizza Margherita z dodatkowym serem i pomidorami', 
          price: 30.00, 
          restaurant_id: 'r1', 
          restaurant_name: 'Test' 
        },
        { 
          id: '2', 
          name: 'Burger Classic z frytkami i colą', 
          price: 25.00, 
          restaurant_id: 'r1', 
          restaurant_name: 'Test' 
        }
      ];

      longNames.forEach(item => {
        const result = parseOrderItems(item.name, longNames);
        const allItems = [
          ...(result.available || []),
          ...(result.groups?.flatMap(g => g.items || []) || [])
        ];
        const hasClarifications = result.clarify && result.clarify.length > 0;
        
        expect(allItems.length > 0 || hasClarifications).toBe(true);
      });
    });
  });

  describe('Edge Cases in Data Structure', () => {
    it('should handle null/undefined values gracefully', () => {
      const invalidItems = [
        { id: null, name: 'Test', price: 10.00, restaurant_id: 'r1', restaurant_name: 'Test' },
        { id: '1', name: undefined, price: 10.00, restaurant_id: 'r1', restaurant_name: 'Test' },
        { id: '2', name: 'Test', price: null, restaurant_id: 'r1', restaurant_name: 'Test' }
      ];

      // parseOrderItems powinno filtrować nieprawidłowe pozycje
      invalidItems.forEach(item => {
        const result = parseOrderItems('Test', [item]);
        // Nie powinno rzucić błędu
        expect(result).toBeDefined();
      });
    });

    it('should handle empty strings', () => {
      const emptyItems = [
        { id: '', name: 'Test', price: 10.00, restaurant_id: 'r1', restaurant_name: 'Test' },
        { id: '1', name: '', price: 10.00, restaurant_id: 'r1', restaurant_name: 'Test' }
      ];

      emptyItems.forEach(item => {
        const result = parseOrderItems('Test', [item]);
        expect(result).toBeDefined();
      });
    });

    it('should handle very large price values', () => {
      const largePrice = {
        id: '1',
        name: 'Expensive Item',
        price: 999999.99,
        restaurant_id: 'r1',
        restaurant_name: 'Test'
      };

      const result = parseOrderItems('Expensive Item', [largePrice]);
      expect(result).toBeDefined();
      const allItems = [
        ...(result.available || []),
        ...(result.groups?.flatMap(g => g.items || []) || [])
      ];
      expect(allItems.length).toBeGreaterThan(0);
    });
  });
});




