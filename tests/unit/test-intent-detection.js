/**
 * Testy jednostkowe dla intent detection
 * Testuje funkcje normalizacji, fuzzy matching i detekcji intencji
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { 
  normalizeTxt, 
  fuzzyIncludes, 
  applyAliases, 
  extractSize,
  parseOrderItems 
} from '../../api/brain/intent-router.js';

describe('Text Normalization', () => {
  it('should normalize Polish characters correctly', () => {
    expect(normalizeTxt('ąćęłńóśźż')).toBe('acelnoszz');
    expect(normalizeTxt('ĄĆĘŁŃÓŚŹŻ')).toBe('ACELNOSZZ');
    expect(normalizeTxt('pizza Margherita')).toBe('pizza margherita');
  });

  it('should handle mixed case and special characters', () => {
    expect(normalizeTxt('Pizza Margherita!')).toBe('pizza margherita!');
    expect(normalizeTxt('Co jest dostępne w pobliżu?')).toBe('co jest dostepne w poblizu?');
  });
});

describe('Fuzzy Matching', () => {
  it('should match exact strings', () => {
    expect(fuzzyIncludes('pizza margherita', 'pizza margherita')).toBe(true);
    expect(fuzzyIncludes('Pizza Margherita', 'pizza margherita')).toBe(true);
  });

  it('should match partial strings with high similarity', () => {
    expect(fuzzyIncludes('margherita', 'pizza margherita')).toBe(true);
    expect(fuzzyIncludes('pizza', 'pizza margherita')).toBe(true);
  });

  it('should not match completely different strings', () => {
    expect(fuzzyIncludes('burger', 'pizza margherita')).toBe(false);
    expect(fuzzyIncludes('kebab', 'pizza margherita')).toBe(false);
  });

  it('should handle Polish characters in fuzzy matching', () => {
    expect(fuzzyIncludes('pizza margherita', 'Pizza Margherita')).toBe(true);
    expect(fuzzyIncludes('żurek śląski', 'zurek slaski')).toBe(true);
  });
});

describe('Alias Application', () => {
  it('should apply basic aliases', () => {
    expect(applyAliases('burger')).toBe('burger');
    expect(applyAliases('burgera')).toBe('burger');
    expect(applyAliases('burgerka')).toBe('burger');
  });

  it('should handle female variants', () => {
    expect(applyAliases('pizza margherita')).toBe('pizza margherita');
    expect(applyAliases('pizza margherity')).toBe('pizza margherita');
  });

  it('should not modify non-matching strings', () => {
    expect(applyAliases('kebab')).toBe('kebab');
    expect(applyAliases('sałatka')).toBe('sałatka');
  });
});

describe('Size Extraction', () => {
  it('should extract size from dish names', () => {
    expect(extractSize('mała pizza')).toEqual({ name: 'pizza', size: 'mała' });
    expect(extractSize('duża pizza margherita')).toEqual({ name: 'pizza margherita', size: 'duża' });
    expect(extractSize('pizza margherita')).toEqual({ name: 'pizza margherita', size: null });
  });

  it('should handle various size formats', () => {
    expect(extractSize('small burger')).toEqual({ name: 'burger', size: 'small' });
    expect(extractSize('large fries')).toEqual({ name: 'fries', size: 'large' });
  });
});

describe('Order Items Parsing', () => {
  const mockCatalog = [
    { id: '1', name: 'Pizza Margherita', price: 25.00, category: 'pizza' },
    { id: '2', name: 'Burger Classic', price: 20.00, category: 'burger' },
    { id: '3', name: 'Kebab w bułce', price: 18.00, category: 'kebab' },
    { id: '4', name: 'Mała Pizza Margherita', price: 15.00, category: 'pizza' },
    { id: '5', name: 'Duża Pizza Margherita', price: 35.00, category: 'pizza' }
  ];

  it('should parse simple order items', async () => {
    const result = await parseOrderItems('pizza margherita', mockCatalog);
    
    expect(result.available).toHaveLength(1);
    expect(result.available[0].name).toBe('Pizza Margherita');
    expect(result.unavailable).toHaveLength(0);
    expect(result.needsClarification).toBe(false);
  });

  it('should handle multiple items', async () => {
    const result = await parseOrderItems('pizza margherita i burger', mockCatalog);
    
    expect(result.available).toHaveLength(2);
    expect(result.available.map(item => item.name)).toContain('Pizza Margherita');
    expect(result.available.map(item => item.name)).toContain('Burger Classic');
  });

  it('should handle size preferences', async () => {
    const result = await parseOrderItems('mała pizza margherita', mockCatalog);
    
    expect(result.available).toHaveLength(1);
    expect(result.available[0].name).toBe('Mała Pizza Margherita');
    expect(result.available[0].price).toBe(15.00);
  });

  it('should handle unavailable items', async () => {
    const result = await parseOrderItems('pizza hawajska i burger', mockCatalog);
    
    expect(result.available).toHaveLength(1);
    expect(result.available[0].name).toBe('Burger Classic');
    expect(result.unavailable).toHaveLength(1);
    expect(result.unavailable[0]).toBe('pizza hawajska');
  });

  it('should handle empty catalog', async () => {
    const result = await parseOrderItems('pizza margherita', []);
    
    expect(result.available).toHaveLength(0);
    expect(result.unavailable).toHaveLength(1);
    expect(result.missingAll).toBe(true);
  });

  it('should deduplicate similar items', async () => {
    const result = await parseOrderItems('pizza margherita', mockCatalog);
    
    // Should return only one pizza margherita (not all 3 variants)
    expect(result.available).toHaveLength(1);
  });
});

describe('Edge Cases', () => {
  it('should handle empty input', async () => {
    const result = await parseOrderItems('', []);
    expect(result.available).toHaveLength(0);
    expect(result.unavailable).toHaveLength(0);
    expect(result.missingAll).toBe(true);
  });

  it('should handle null input', async () => {
    const result = await parseOrderItems(null, []);
    expect(result.available).toHaveLength(0);
    expect(result.unavailable).toHaveLength(0);
    expect(result.missingAll).toBe(true);
  });

  it('should handle special characters in dish names', async () => {
    const catalog = [
      { id: '1', name: 'Crème brûlée', price: 12.00, category: 'dessert' }
    ];
    
    const result = await parseOrderItems('creme brulee', catalog);
    expect(result.available).toHaveLength(1);
    expect(result.available[0].name).toBe('Crème brûlée');
  });
});

