/**
 * Testy jednostkowe dla brainRouter
 * Testuje logikę boostIntent i parsowania restauracji
 * 
 * UWAGA: Po wprowadzeniu Smart Intent System, boostIntent jest używany jako warstwa
 * kontekstowa po smartResolveIntent. Testy zostały zaktualizowane aby odzwierciedlać
 * nową architekturę.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { boostIntent } from '../../api/brain/intents/boostIntent.js';

const parseRestaurantAndDish = (text) => {
  const normalized = text.toLowerCase();

  // Pattern 0: "Pokaż menu" (bez nazwy restauracji — użyj kontekstu sesji)
  if (/^(pokaż\s+)?menu$/i.test(text.trim())) {
    return { dish: null, restaurant: null };
  }

  // Pattern 1: "Zamów [danie] [nazwa restauracji]"
  const orderPattern = /(?:zamów|poproszę|chcę)\s+([a-ząćęłńóśźż\s]+?)\s+([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż\s]+)/i;
  const orderMatch = text.match(orderPattern);
  if (orderMatch) {
    let dish = orderMatch[1]?.trim();
    dish = dish?.replace(/ę$/i, 'a').replace(/a$/i, 'a');
    return { dish, restaurant: orderMatch[2]?.trim() };
  }

  // Pattern 2: "Pokaż menu [nazwa restauracji]"
  const menuPattern = /(?:pokaż\s+)?menu\s+(?:w\s+)?([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż\s]+)/i;
  const menuMatch = text.match(menuPattern);
  if (menuMatch) {
    return { dish: null, restaurant: menuMatch[1]?.trim() };
  }

  // Pattern 3: "Zjedz w [nazwa miejsca]" (ale NIE "menu" ani słowa kluczowe nearby)
  const locationPattern = /(?:w|z)\s+([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż\s]+)/i;
  const locationMatch = text.match(locationPattern);
  if (locationMatch) {
    const extracted = locationMatch[1]?.trim();
    // Ignoruj jeśli to słowo kluczowe (menu, zamówienie, nearby keywords)
    if (extracted && !/(menu|zamówienie|zamówienia|pobliżu|okolicy|blisko|okolice|pobliżach)/i.test(extracted)) {
      return { dish: null, restaurant: extracted };
    }
  }

  return { dish: null, restaurant: null };
};

describe('boostIntent Function', () => {
  // boostIntent teraz działa tylko w kontekście expectedContext
  // Bez expectedContext zwraca det bez zmian
  
  it('should return det unchanged when no expectedContext', () => {
    const det = { intent: 'find_nearby', confidence: 0.8 };
    const result = boostIntent(det, 'test', {});
    expect(result).toEqual(det);
  });

  it('should return det unchanged when session is null', () => {
    const det = { intent: 'menu_request', confidence: 0.7 };
    const result = boostIntent(det, 'test', null);
    expect(result).toEqual(det);
  });

  it('should boost to show_menu when expectedContext is confirm_menu', () => {
    const det = { intent: 'none', confidence: 0.3 };
    const session = { expectedContext: 'confirm_menu' };
    const result = boostIntent(det, 'tak', session);
    
    expect(result.intent).toBe('show_menu');
    expect(result.confidence).toBe(0.99);
    expect(result.boosted).toBe(true);
  });

  it('should boost to select_restaurant when expectedContext is select_restaurant', () => {
    const det = { intent: 'none', confidence: 0.3 };
    const session = { expectedContext: 'select_restaurant' };
    const result = boostIntent(det, 'pierwsza', session);
    
    expect(result.intent).toBe('select_restaurant');
    expect(result.confidence).toBe(0.99);
    expect(result.fromExpected).toBe(true);
  });

  it('should handle numeric selection for select_restaurant', () => {
    const det = { intent: 'none', confidence: 0.3 };
    const session = { expectedContext: 'select_restaurant' };
    
    expect(boostIntent(det, '1', session).intent).toBe('select_restaurant');
    expect(boostIntent(det, '2', session).intent).toBe('select_restaurant');
    expect(boostIntent(det, 'pierwsza', session).intent).toBe('select_restaurant');
    expect(boostIntent(det, 'wybieram', session).intent).toBe('select_restaurant');
  });

  it('should boost to confirm when expectedContext is confirm_choice', () => {
    const det = { intent: 'none', confidence: 0.3 };
    const session = { expectedContext: 'confirm_choice' };
    const result = boostIntent(det, 'tak', session);
    
    expect(result.intent).toBe('confirm');
    expect(result.confidence).toBe(0.99);
    expect(result.boosted).toBe(true);
  });

  it('should not boost for long phrases (>5 words)', () => {
    const det = { intent: 'none', confidence: 0.3 };
    const session = { expectedContext: 'select_restaurant' };
    const longText = 'chcę wybrać pierwszą restaurację z listy';
    
    const result = boostIntent(det, longText, session);
    expect(result).toEqual(det); // Should return unchanged
  });

  it('should preserve original det properties when boosting', () => {
    const det = { intent: 'none', confidence: 0.3, slots: { test: 'value' } };
    const session = { expectedContext: 'confirm_menu' };
    const result = boostIntent(det, 'tak', session);
    
    expect(result.intent).toBe('show_menu');
    expect(result.slots).toEqual({ test: 'value' });
  });

  it('should handle string det input (backward compatibility)', () => {
    const session = { expectedContext: 'select_restaurant' };
    const result = boostIntent('none', '1', session);
    
    // Should return object even if det was string
    expect(typeof result).toBe('object');
    expect(result.intent).toBe('select_restaurant');
  });
});

describe('parseRestaurantAndDish Function', () => {
  it('should parse simple menu requests', () => {
    expect(parseRestaurantAndDish('menu')).toEqual({ dish: null, restaurant: null });
    expect(parseRestaurantAndDish('pokaż menu')).toEqual({ dish: null, restaurant: null });
  });

  it('should parse order with restaurant', () => {
    const result = parseRestaurantAndDish('zamów pizzę Monte Carlo');
    expect(result.dish).toBe('pizza');
    expect(result.restaurant).toBe('Monte Carlo');
  });

  it('should parse menu requests with restaurant', () => {
    const result = parseRestaurantAndDish('pokaż menu Tasty King');
    expect(result.dish).toBe(null);
    expect(result.restaurant).toBe('Tasty King');
  });

  it('should parse location-based requests', () => {
    const result = parseRestaurantAndDish('zjedz w Piekarach');
    expect(result.dish).toBe(null);
    // parseRestaurantAndDish zwraca "w Piekarach" (z prefiksem "w")
    expect(result.restaurant).toBe('w Piekarach');
  });

  it('should ignore nearby keywords in location parsing', () => {
    expect(parseRestaurantAndDish('co jest dostępne w pobliżu')).toEqual({ dish: null, restaurant: null });
    expect(parseRestaurantAndDish('coś w okolicy')).toEqual({ dish: null, restaurant: null });
    expect(parseRestaurantAndDish('blisko mnie')).toEqual({ dish: null, restaurant: null });
  });

  it('should ignore menu keywords in location parsing', () => {
    expect(parseRestaurantAndDish('pokaż menu')).toEqual({ dish: null, restaurant: null });
    expect(parseRestaurantAndDish('zamówienie')).toEqual({ dish: null, restaurant: null });
  });

  it('should handle complex restaurant names', () => {
    const result = parseRestaurantAndDish('zamów burger Burger King');
    expect(result.dish).toBe('burger');
    expect(result.restaurant).toBe('Burger King');
  });

  it('should return null for unrecognized patterns', () => {
    expect(parseRestaurantAndDish('hello world')).toEqual({ dish: null, restaurant: null });
    expect(parseRestaurantAndDish('random text')).toEqual({ dish: null, restaurant: null });
  });
});

describe('Edge Cases', () => {
  it('should handle empty strings', () => {
    const det = { intent: 'none', confidence: 0.5 };
    const result = boostIntent(det, '', {});
    expect(result).toEqual(det);
    expect(parseRestaurantAndDish('')).toEqual({ dish: null, restaurant: null });
  });

  it('should handle special characters in text', () => {
    const det = { intent: 'none', confidence: 0.5 };
    const session = { expectedContext: 'confirm_menu' };
    const result = boostIntent(det, 'tak!', session);
    expect(result.intent).toBe('show_menu');
  });

  it('should handle mixed case', () => {
    const det = { intent: 'none', confidence: 0.5 };
    const session = { expectedContext: 'select_restaurant' };
    const result = boostIntent(det, 'PIERWSZA', session);
    expect(result.intent).toBe('select_restaurant');
  });
});

describe('expectedContext Follow-up Logic', () => {
  // boostIntent teraz działa tylko w kontekście expectedContext
  // Te testy sprawdzają różne konteksty
  
  it('should boost to show_menu when expectedContext is confirm_menu', () => {
    const det = { intent: 'none', confidence: 0.3 };
    const session = { expectedContext: 'confirm_menu' };
    const result = boostIntent(det, 'tak', session);
    
    expect(result.intent).toBe('show_menu');
    expect(result.boosted).toBe(true);
  });

  it('should boost to select_restaurant when expectedContext is select_restaurant', () => {
    const det = { intent: 'none', confidence: 0.3 };
    const session = { expectedContext: 'select_restaurant' };
    
    expect(boostIntent(det, 'wybieram', session).intent).toBe('select_restaurant');
    expect(boostIntent(det, '1', session).intent).toBe('select_restaurant');
    expect(boostIntent(det, 'pierwsza', session).intent).toBe('select_restaurant');
    expect(boostIntent(det, 'ta pierwsza', session).intent).toBe('select_restaurant');
  });

  it('should not boost when text does not match expected context', () => {
    const det = { intent: 'find_nearby', confidence: 0.7 };
    const session = { expectedContext: 'select_restaurant' };
    const result = boostIntent(det, 'co jest dostępne', session);
    
    // Should return unchanged because text doesn't match selection pattern
    expect(result).toEqual(det);
  });

  it('should not boost when expectedContext is missing', () => {
    const det = { intent: 'none', confidence: 0.3 };
    const session = {}; // No expectedContext
    const result = boostIntent(det, 'tak', session);
    
    expect(result).toEqual(det);
  });

  it('should boost to confirm when expectedContext is confirm_choice', () => {
    const det = { intent: 'none', confidence: 0.3 };
    const session = { expectedContext: 'confirm_choice' };
    
    expect(boostIntent(det, 'tak', session).intent).toBe('confirm');
    expect(boostIntent(det, 'ok', session).intent).toBe('confirm');
    expect(boostIntent(det, 'potwierdzam', session).intent).toBe('confirm');
  });
});
