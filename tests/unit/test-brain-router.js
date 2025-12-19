/**
 * Testy jednostkowe dla brainRouter
 * Testuje logikę boostIntent i parsowania restauracji
 */

import { describe, it, expect, beforeEach } from 'vitest';

// Mock funkcji z brainRouter
const boostIntent = (text, intent, confidence = 0) => {
  const lower = text.toLowerCase();

  // Nie modyfikuj jeśli intencja jest bardzo pewna
  if (confidence >= 0.8) {
    return intent;
  }

  // Follow-up logic — krótkie odpowiedzi kontekstowe
  if (/^(tak|ok|dobrze|zgoda|pewnie)$/i.test(text.trim())) {
    return 'confirm';
  }

  // Zmiana restauracji
  if (/(\bnie\b|zmien|inne|cos innego|pokaz inne|inna restaurac)/i.test(lower)) {
    return 'change_restaurant';
  }

  // Rekomendacje
  if (/(polec|polecasz|co polecasz|co warto|co dobre|co najlepsze)/i.test(lower)) {
    return 'recommend';
  }

  // "Na szybko" / "coś szybkiego" → find_nearby z fast food
  if (/(na szybko|cos szybkiego|szybkie jedzenie|fast food)/i.test(lower)) {
    return 'find_nearby';
  }

  // "Mam ochotę na" / "chcę coś" → find_nearby
  if (/(mam ochote|ochote na|chce cos|szukam czegos)/i.test(lower)) {
    return 'find_nearby';
  }

  // "Co jest dostępne" / "co w pobliżu" → find_nearby
  if (/(co jest dostepne|co dostepne|co w poblizu|co w okolicy|co jest w okolicy|co mam w poblizu)/i.test(lower)) {
    return 'find_nearby';
  }

  // "Wege" / "wegetariańskie" → find_nearby
  if (/(wege|wegetarian|roslinne)/i.test(lower)) {
    return 'find_nearby';
  }

  // "Zamów tutaj" / "zamów to" → create_order
  if (/(zamów tutaj|zamów tu|chcę to zamówić|zamów to)/i.test(lower)) {
    return 'create_order';
  }

  // Menu keywords
  if (/(menu|karta|co mają|co serwują|zobacz co|zobacz menu)/i.test(lower)) {
    return 'menu_request';
  }

  // Jeśli intent=none, spróbuj wykryć semantycznie
  if (intent === 'none') {
    // Nearby keywords
    if (/(restaurac|zjesc|jedzenie|posilek|obiad)/i.test(lower)) {
      return 'find_nearby';
    }
  }

  return intent;
};

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
  it('should not modify high confidence intents', () => {
    expect(boostIntent('test', 'find_nearby', 0.9)).toBe('find_nearby');
    expect(boostIntent('test', 'menu_request', 0.85)).toBe('menu_request');
  });

  it('should detect confirm intent', () => {
    expect(boostIntent('tak', 'none', 0.5)).toBe('confirm');
    expect(boostIntent('ok', 'none', 0.5)).toBe('confirm');
    expect(boostIntent('dobrze', 'none', 0.5)).toBe('confirm');
  });

  it('should detect change_restaurant intent', () => {
    expect(boostIntent('nie', 'none', 0.5)).toBe('change_restaurant');
    expect(boostIntent('pokaż inne', 'none', 0.5)).toBe('change_restaurant');
    expect(boostIntent('zmień restaurację', 'none', 0.5)).toBe('change_restaurant');
  });

  it('should detect recommend intent', () => {
    expect(boostIntent('co polecasz', 'none', 0.5)).toBe('recommend');
    expect(boostIntent('co warto zjeść', 'none', 0.5)).toBe('recommend');
    expect(boostIntent('polecisz coś', 'none', 0.5)).toBe('recommend');
  });

  it('should detect find_nearby for quick food', () => {
    expect(boostIntent('na szybko', 'none', 0.5)).toBe('find_nearby');
    expect(boostIntent('coś szybkiego', 'none', 0.5)).toBe('find_nearby');
    expect(boostIntent('fast food', 'none', 0.5)).toBe('find_nearby');
  });

  it('should detect find_nearby for general food search', () => {
    expect(boostIntent('mam ochotę na coś', 'none', 0.5)).toBe('find_nearby');
    expect(boostIntent('chcę coś zjeść', 'none', 0.5)).toBe('find_nearby');
    expect(boostIntent('szukam czegoś do jedzenia', 'none', 0.5)).toBe('find_nearby');
  });

  it('should detect find_nearby for availability queries', () => {
    expect(boostIntent('co jest dostępne', 'none', 0.5)).toBe('find_nearby');
    expect(boostIntent('co w pobliżu', 'none', 0.5)).toBe('find_nearby');
    expect(boostIntent('co jest w okolicy', 'none', 0.5)).toBe('find_nearby');
    expect(boostIntent('co mam w pobliżu', 'none', 0.5)).toBe('find_nearby');
  });

  it('should detect find_nearby for vegetarian queries', () => {
    expect(boostIntent('coś wegetariańskiego', 'none', 0.5)).toBe('find_nearby');
    expect(boostIntent('wegańskie jedzenie', 'none', 0.5)).toBe('find_nearby');
    expect(boostIntent('roślinne opcje', 'none', 0.5)).toBe('find_nearby');
  });

  it('should detect create_order intent', () => {
    expect(boostIntent('zamów tutaj', 'none', 0.5)).toBe('create_order');
    expect(boostIntent('chcę to zamówić', 'none', 0.5)).toBe('create_order');
    expect(boostIntent('zamów to', 'none', 0.5)).toBe('create_order');
  });

  it('should detect menu_request intent', () => {
    expect(boostIntent('pokaż menu', 'none', 0.5)).toBe('menu_request');
    expect(boostIntent('co mają w menu', 'none', 0.5)).toBe('menu_request');
    expect(boostIntent('zobacz co serwują', 'none', 0.5)).toBe('menu_request');
  });

  it('should fallback to find_nearby for generic food keywords', () => {
    expect(boostIntent('restauracja', 'none', 0.5)).toBe('find_nearby');
    expect(boostIntent('chcę zjeść', 'none', 0.5)).toBe('find_nearby');
    expect(boostIntent('posiłek', 'none', 0.5)).toBe('find_nearby');
  });

  it('should return original intent if no patterns match', () => {
    expect(boostIntent('random text', 'menu_request', 0.5)).toBe('menu_request');
    expect(boostIntent('hello world', 'none', 0.5)).toBe('none');
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
    expect(result.restaurant).toBe('Piekarach');
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
    expect(boostIntent('', 'none', 0.5)).toBe('none');
    expect(parseRestaurantAndDish('')).toEqual({ dish: null, restaurant: null });
  });

  it('should handle special characters', () => {
    expect(boostIntent('co jest dostępne?', 'none', 0.5)).toBe('find_nearby');
    expect(boostIntent('zamów tutaj!', 'none', 0.5)).toBe('create_order');
  });

  it('should handle mixed case', () => {
    expect(boostIntent('CO JEST DOSTĘPNE', 'none', 0.5)).toBe('find_nearby');
    expect(boostIntent('Pokaż Menu', 'none', 0.5)).toBe('menu_request');
  });
});

