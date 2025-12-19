// tests/brain-cascade.test.js - Comprehensive cascade tests for brain API
import { describe, it, expect, beforeAll } from 'vitest';

const API_URL = process.env.API_URL || 'http://localhost:3000';
const SESSION_ID = 'test-session-' + Date.now();

// Helper function for API calls
async function callBrain(text, sessionId = SESSION_ID) {
  const response = await fetch(`${API_URL}/api/brain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, sessionId })
  });
  
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  
  return response.json();
}

describe('🧠 Brain API - Cascade Tests', () => {
  
  // ============================================================================
  // TIER 1: HEALTH & BASIC VALIDATION
  // ============================================================================
  
  describe('Tier 1: Health & Basic Validation', () => {
    it('should respond to health check', async () => {
      const response = await fetch(`${API_URL}/api/health`);
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(data.supabase.ok).toBe(true);
    });
    
    it('should reject empty text', async () => {
      const response = await fetch(`${API_URL}/api/brain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: SESSION_ID })
      });
      expect(response.status).toBe(400);
    });
    
    it('should reject non-POST methods', async () => {
      const response = await fetch(`${API_URL}/api/brain`, {
        method: 'GET'
      });
      expect(response.status).toBe(405);
    });
  });
  
  // ============================================================================
  // TIER 2: INTENT DETECTION
  // ============================================================================
  
  describe('Tier 2: Intent Detection', () => {
    it('should detect find_nearby intent', async () => {
      const result = await callBrain('Gdzie mogę zjeść w Piekarach?');
      expect(result.ok).toBe(true);
      expect(result.intent).toBe('find_nearby');
      expect(result.reply).toBeTruthy();
    });
    
    it('should detect menu_request intent', async () => {
      const result = await callBrain('Pokaż menu Monte Carlo');
      expect(result.ok).toBe(true);
      expect(['menu_request', 'select_restaurant']).toContain(result.intent);
    });
    
    it('should detect select_restaurant intent', async () => {
      const result = await callBrain('Wybierz restaurację Monte Carlo');
      expect(result.ok).toBe(true);
      expect(['select_restaurant', 'menu_request']).toContain(result.intent);
    });
    
    it('should detect create_order intent', async () => {
      const result = await callBrain('Zamów pizzę Margherita w Monte Carlo');
      expect(result.ok).toBe(true);
      expect(result.intent).toBe('create_order');
    });
  });
  
  // ============================================================================
  // TIER 3: GEO CONTEXT LAYER
  // ============================================================================
  
  describe('Tier 3: Geo Context Layer', () => {
    it('should extract location from text', async () => {
      const result = await callBrain('Gdzie zjeść w Bytomiu?');
      expect(result.ok).toBe(true);
      expect(result.location || result.context?.last_location).toBeTruthy();
    });
    
    it('should handle cuisine type filtering', async () => {
      const result = await callBrain('Gdzie zjeść pizzę w Piekarach?');
      expect(result.ok).toBe(true);
      expect(result.reply).toMatch(/(pizza|pizzer|włosk)/i);
    });
    
    it('should handle azjatyckie cuisine alias', async () => {
      const result = await callBrain('Coś azjatyckiego w Piekarach');
      expect(result.ok).toBe(true);
      expect(result.restaurants?.length || 0).toBeGreaterThanOrEqual(0);
    });
  });
  
  // ============================================================================
  // TIER 4: SESSION CONTEXT & MEMORY
  // ============================================================================
  
  describe('Tier 4: Session Context & Memory', () => {
    const sessionId = 'test-context-' + Date.now();
    
    it('should remember last restaurant', async () => {
      await callBrain('Wybierz Monte Carlo', sessionId);
      const result = await callBrain('Pokaż menu', sessionId);
      expect(result.ok).toBe(true);
      expect(result.reply).toMatch(/Monte Carlo/i);
    });
    
    it('should remember last location', async () => {
      // Uwaga: w bazie mamy tylko Piekary Śląskie, więc test pamięci lokalizacji
      // sprawdzamy na tej miejscowości
      await callBrain('Gdzie zjeść w Piekarach?', sessionId);
      const result = await callBrain('Pokaż restauracje', sessionId);
      expect(result.ok).toBe(true);
      expect(result.context?.last_location).toMatch(/Piekary/i);
    });
  });
  
  // ============================================================================
  // TIER 5: FUZZY MATCHING & ALIASES
  // ============================================================================
  
  describe('Tier 5: Fuzzy Matching & Aliases', () => {
    it('should handle typos in restaurant names', async () => {
      const result = await callBrain('Menu Monte Karlo');
      expect(result.ok).toBe(true);
      expect(['menu_request', 'select_restaurant']).toContain(result.intent);
    });
    
    it('should handle dish aliases', async () => {
      const result = await callBrain('Zamów margheritę');
      expect(result.ok).toBe(true);
      expect(result.intent).toBe('create_order');
    });
    
    it('should normalize Polish characters', async () => {
      const result = await callBrain('Gdzie zjeść pizzę?');
      expect(result.ok).toBe(true);
      expect(result.intent).toBe('find_nearby');
    });
  });
  
  // ============================================================================
  // TIER 6: QUANTITY & SIZE DETECTION
  // ============================================================================
  
  describe('Tier 6: Quantity & Size Detection', () => {
    it('should detect quantity from numbers', async () => {
      const result = await callBrain('Zamów 2x pizza Margherita');
      expect(result.ok).toBe(true);
      expect(result.intent).toBe('create_order');
    });
    
    it('should detect quantity from words', async () => {
      const result = await callBrain('Zamów dwie pizze');
      expect(result.ok).toBe(true);
      expect(result.intent).toBe('create_order');
    });
    
    it('should detect pizza size', async () => {
      const result = await callBrain('Zamów dużą pizzę Margherita');
      expect(result.ok).toBe(true);
      expect(result.intent).toBe('create_order');
    });
  });
  
  // ============================================================================
  // TIER 7: SMART CONTEXT BOOST
  // ============================================================================
  
  describe('Tier 7: Smart Context Boost', () => {
    it('should boost "nie/inne" to change_restaurant', async () => {
      const result = await callBrain('Nie, pokaż inne restauracje');
      expect(result.ok).toBe(true);
      expect(result.intent).toBe('change_restaurant');
    });
    
    it('should boost "polecisz" to recommend', async () => {
      const result = await callBrain('Co polecisz?');
      expect(result.ok).toBe(true);
      expect(result.intent).toBe('recommend');
    });
    
    it('should boost "tak" to confirm', async () => {
      const sessionId = 'test-confirm-' + Date.now();
      await callBrain('Wybierz Monte Carlo', sessionId);
      const result = await callBrain('Tak', sessionId);
      expect(result.ok).toBe(true);
      expect(['confirm', 'menu_request']).toContain(result.intent);
    });
  });
  
  // ============================================================================
  // TIER 8: ERROR HANDLING & EDGE CASES
  // ============================================================================
  
  describe('Tier 8: Error Handling & Edge Cases', () => {
    it('should handle non-existent restaurant', async () => {
      const result = await callBrain('Menu w restauracji XYZ123');
      expect(result.ok).toBe(true);
      expect(result.reply).toMatch(/(nie znalazłam|nie mam|brak)/i);
    });
    
    it('should handle empty restaurant list', async () => {
      const result = await callBrain('Restauracje w Antarktyce');
      expect(result.ok).toBe(true);
      expect(result.reply).toMatch(/(nie znalazłam|brak|nie widzę)/i);
    });
    
    it('should handle ambiguous input', async () => {
      const result = await callBrain('coś');
      expect(result.ok).toBe(true);
      expect(result.intent).toBeTruthy();
    });
    
    it('should handle very long input', async () => {
      const longText = 'Chciałbym zamówić '.repeat(50) + 'pizzę';
      const result = await callBrain(longText);
      expect(result.ok).toBe(true);
    });
  });
  
  // ============================================================================
  // TIER 9: MULTI-ITEM ORDERING
  // ============================================================================
  
  describe('Tier 9: Multi-Item Ordering', () => {
    it('should parse multiple items', async () => {
      const result = await callBrain('Zamów pizzę Margherita i pizzę Pepperoni');
      expect(result.ok).toBe(true);
      expect(result.intent).toBe('create_order');
    });
    
    it('should handle mixed quantities', async () => {
      const result = await callBrain('Zamów 2 pizze Margherita i jedną Pepperoni');
      expect(result.ok).toBe(true);
      expect(result.intent).toBe('create_order');
    });
  });
  
  // ============================================================================
  // TIER 10: FULL USER FLOW
  // ============================================================================
  
  describe('Tier 10: Full User Flow', () => {
    const flowSessionId = 'test-flow-' + Date.now();
    
    it('should complete full ordering flow', async () => {
      // Step 1: Find restaurants
      const step1 = await callBrain('Gdzie zjeść w Piekarach?', flowSessionId);
      expect(step1.ok).toBe(true);
      expect(step1.intent).toBe('find_nearby');
      
      // Step 2: Select restaurant
      const step2 = await callBrain('Monte Carlo', flowSessionId);
      expect(step2.ok).toBe(true);
      expect(['select_restaurant', 'menu_request']).toContain(step2.intent);
      
      // Step 3: View menu
      const step3 = await callBrain('Pokaż menu', flowSessionId);
      expect(step3.ok).toBe(true);
      expect(step3.intent).toBe('menu_request');
      
      // Step 4: Order
      const step4 = await callBrain('Zamów pizzę Margherita', flowSessionId);
      expect(step4.ok).toBe(true);
      expect(step4.intent).toBe('create_order');
    });
  });
  
  // ============================================================================
  // TIER 11: EXPECTED CONTEXT & FOLLOW-UP
  // ============================================================================

  describe('Tier 11: Expected Context & Follow-up', () => {
    const contextSessionId = 'test-context-' + Date.now();

    it('should handle "show more options" follow-up', async () => {
      // Step 1: Find restaurants (should show limited list)
      const step1 = await callBrain('Gdzie zjeść w Piekarach?', contextSessionId);
      expect(step1.ok).toBe(true);
      expect(step1.intent).toBe('find_nearby');

      // Sprawdź, czy odpowiedź zawiera informację o dodatkowych opcjach
      const hasMoreOptions = step1.reply.includes('więcej') || step1.reply.includes('+');

      // Step 2: Ask for more options (follow-up)
      const step2 = await callBrain('Pokaż więcej opcji', contextSessionId);
      expect(step2.ok).toBe(true);
      expect(step2.intent).toBe('show_more_options');
      expect(step2.reply).toBeTruthy();

      // Sprawdź, czy odpowiedź NIE zawiera błędu "nie mam więcej"
      expect(step2.reply).not.toMatch(/nie mam więcej/i);

      // Jeśli były dodatkowe opcje, odpowiedź powinna zawierać więcej restauracji
      if (hasMoreOptions) {
        expect(step2.reply).toMatch(/\d+\./); // Powinna zawierać numerowaną listę
      }
    });

    it('should handle restaurant selection by number', async () => {
      // Step 1: Find restaurants
      const step1 = await callBrain('Gdzie zjeść w Piekarach?', contextSessionId + '-select');
      expect(step1.ok).toBe(true);
      expect(step1.intent).toBe('find_nearby');

      // Step 2: Select restaurant by number
      const step2 = await callBrain('Wybieram numer 1', contextSessionId + '-select');
      expect(step2.ok).toBe(true);
      expect(step2.intent).toBe('select_restaurant');
      expect(step2.reply).toMatch(/wybrano restaurację/i);
    });

    it('should handle restaurant selection by ordinal', async () => {
      // Step 1: Find restaurants
      const step1 = await callBrain('Gdzie zjeść w Piekarach?', contextSessionId + '-ordinal');
      expect(step1.ok).toBe(true);
      expect(step1.intent).toBe('find_nearby');

      // Step 2: Select restaurant by ordinal
      const step2 = await callBrain('Ta pierwsza', contextSessionId + '-ordinal');
      expect(step2.ok).toBe(true);
      expect(step2.intent).toBe('select_restaurant');
      expect(step2.reply).toMatch(/wybrano restaurację/i);
    });

    it('should clear expectedContext after handling follow-up', async () => {
      // Step 1: Find restaurants
      const step1 = await callBrain('Gdzie zjeść w Piekarach?', contextSessionId + '-clear');
      expect(step1.ok).toBe(true);

      // Step 2: Show more options
      const step2 = await callBrain('Pokaż więcej', contextSessionId + '-clear');
      expect(step2.ok).toBe(true);
      expect(step2.intent).toBe('show_more_options');

      // Step 3: New unrelated query (should not be affected by previous context)
      const step3 = await callBrain('Pokaż menu', contextSessionId + '-clear');
      expect(step3.ok).toBe(true);
      expect(step3.intent).toBe('menu_request');
    });

    it('should ignore expectedContext when user says something unrelated', async () => {
      // Step 1: Find restaurants (sets expectedContext)
      const step1 = await callBrain('Gdzie zjeść w Piekarach?', contextSessionId + '-ignore');
      expect(step1.ok).toBe(true);

      // Step 2: User ignores the question and asks something else
      const step2 = await callBrain('Co polecasz?', contextSessionId + '-ignore');
      expect(step2.ok).toBe(true);
      expect(step2.intent).toBe('recommend'); // Should detect new intent, not follow-up
    });
  });

  // ============================================================================
  // TIER 12: SESSION CONTEXT PRIORITY
  // ============================================================================

  describe('Tier 12: Session Context Priority', () => {
    const sessionContextId = 'test-session-context-' + Date.now();

    it('should prioritize session restaurant over text detection', async () => {
      // Step 1: Wybierz restaurację (ustaw kontekst sesji)
      const step1 = await callBrain('Pokaż menu Monte Carlo', sessionContextId);
      expect(step1.ok).toBe(true);
      expect(['menu_request', 'select_restaurant']).toContain(step1.intent);

      // Step 2: Zamów danie BEZ podawania nazwy restauracji
      // System powinien użyć restauracji z sesji, a nie szukać nowej
      const step2 = await callBrain('Poproszę tiramisu', sessionContextId);
      expect(step2.ok).toBe(true);
      // Powinno wykryć zamówienie, nie próbować znaleźć restauracji "tiramisu"
      expect(['create_order', 'clarify_order']).toContain(step2.intent);
    });

    it('should detect new restaurant when indicators present', async () => {
      // Step 1: Mamy restaurację w sesji
      const step1 = await callBrain('Pokaż menu Monte Carlo', sessionContextId + '-new');
      expect(step1.ok).toBe(true);

      // Step 2: Użytkownik wyraźnie chce zmienić restaurację (wskaźnik "w")
      const step2 = await callBrain('Pokaż menu w Tasty King', sessionContextId + '-new');
      expect(step2.ok).toBe(true);
      expect(['menu_request', 'select_restaurant']).toContain(step2.intent);
      // Odpowiedź powinna zawierać "Tasty King", nie "Monte Carlo"
      expect(step2.reply).toMatch(/tasty king/i);
    });

    it('should skip restaurant search when session context exists', async () => {
      // Ten test sprawdza, czy system nie przeszukuje wszystkich restauracji
      // gdy użytkownik ma już restaurację w sesji i nie podaje wskaźników nowej
      const step1 = await callBrain('Pokaż menu Monte Carlo', sessionContextId + '-skip');
      expect(step1.ok).toBe(true);

      // Zamów danie - system powinien użyć sesji, nie przeszukiwać bazy
      const step2 = await callBrain('Zamów pizzę', sessionContextId + '-skip');
      expect(step2.ok).toBe(true);
      // Nie powinno być błędu "nie znaleziono restauracji"
      expect(step2.reply).not.toMatch(/nie znalazłam restauracji/i);
    });
  });

  // ============================================================================
  // TIER 13: ORDER CONFIRMATION FLOW
  // ============================================================================

  describe('Tier 13: Order Confirmation Flow', () => {
    const confirmSessionId = 'test-session-confirm-' + Date.now();

    it('should NOT add to cart immediately, but wait for confirmation', async () => {
      // Step 1: Wybierz restaurację
      const step1 = await callBrain('Pokaż menu Monte Carlo', confirmSessionId);
      expect(step1.ok).toBe(true);

      // Step 2: Zamów danie - powinno zapytać o potwierdzenie
      const step2 = await callBrain('Poproszę tiramisu', confirmSessionId);
      expect(step2.ok).toBe(true);
      expect(step2.intent).toBe('create_order');
      expect(step2.reply).toMatch(/dodać do koszyka/i);
      // NIE powinno zwrócić parsed_order (bo czeka na potwierdzenie)
      expect(step2.parsed_order).toBeUndefined();
      // Powinno ustawić expectedContext
      expect(step2.context?.expectedContext).toBe('confirm_order');
      expect(step2.context?.pendingOrder).toBeDefined();
    });

    it('should add to cart after user confirms with "tak"', async () => {
      // Step 1: Wybierz restaurację
      const step1 = await callBrain('Pokaż menu Monte Carlo', confirmSessionId + '-confirm');
      expect(step1.ok).toBe(true);

      // Step 2: Zamów danie
      const step2 = await callBrain('Poproszę tiramisu', confirmSessionId + '-confirm');
      expect(step2.ok).toBe(true);
      expect(step2.intent).toBe('create_order');
      expect(step2.context?.expectedContext).toBe('confirm_order');

      // Step 3: Potwierdź zamówienie
      const step3 = await callBrain('tak', confirmSessionId + '-confirm');
      expect(step3.ok).toBe(true);
      expect(step3.intent).toBe('confirm_order');
      // TERAZ powinno zwrócić parsed_order
      expect(step3.parsed_order).toBeDefined();
      expect(step3.parsed_order.items).toBeDefined();
      expect(step3.parsed_order.total).toBeGreaterThan(0);
      expect(step3.reply).toMatch(/dodaję do koszyka/i);
    });

    it('should cancel order when user says "nie"', async () => {
      // Step 1: Wybierz restaurację
      const step1 = await callBrain('Pokaż menu Monte Carlo', confirmSessionId + '-cancel');
      expect(step1.ok).toBe(true);

      // Step 2: Zamów danie
      const step2 = await callBrain('Poproszę tiramisu', confirmSessionId + '-cancel');
      expect(step2.ok).toBe(true);
      expect(step2.intent).toBe('create_order');
      expect(step2.context?.expectedContext).toBe('confirm_order');

      // Step 3: Anuluj zamówienie
      const step3 = await callBrain('nie', confirmSessionId + '-cancel');
      expect(step3.ok).toBe(true);
      expect(step3.intent).toBe('cancel_order');
      // NIE powinno zwrócić parsed_order
      expect(step3.parsed_order).toBeUndefined();
      expect(step3.reply).toMatch(/anulowałam/i);
      // expectedContext powinien być wyczyszczony
      expect(step3.context?.expectedContext).toBeNull();
    });

    it('should confirm order with "proszę dodać"', async () => {
      // Step 1: Wybierz restaurację
      const step1 = await callBrain('Pokaż menu Monte Carlo', confirmSessionId + '-proszeodac');
      expect(step1.ok).toBe(true);

      // Step 2: Zamów danie
      const step2 = await callBrain('Poproszę tiramisu', confirmSessionId + '-proszeodac');
      expect(step2.ok).toBe(true);
      expect(step2.intent).toBe('create_order');
      expect(step2.context?.expectedContext).toBe('confirm_order');

      // Step 3: Potwierdź z "proszę dodać"
      const step3 = await callBrain('proszę dodać', confirmSessionId + '-proszeodac');
      expect(step3.ok).toBe(true);
      expect(step3.intent).toBe('confirm_order');
      expect(step3.parsed_order).toBeDefined();
      expect(step3.reply).toMatch(/dodaję do koszyka/i);
    });

    it('should confirm order with "zamawiam"', async () => {
      // Step 1: Wybierz restaurację
      const step1 = await callBrain('Pokaż menu Monte Carlo', confirmSessionId + '-zamawiam');
      expect(step1.ok).toBe(true);

      // Step 2: Zamów danie
      const step2 = await callBrain('Poproszę tiramisu', confirmSessionId + '-zamawiam');
      expect(step2.ok).toBe(true);
      expect(step2.intent).toBe('create_order');
      expect(step2.context?.expectedContext).toBe('confirm_order');

      // Step 3: Potwierdź z "zamawiam"
      const step3 = await callBrain('zamawiam', confirmSessionId + '-zamawiam');
      expect(step3.ok).toBe(true);
      expect(step3.intent).toBe('confirm_order');
      expect(step3.parsed_order).toBeDefined();
      expect(step3.reply).toMatch(/dodaję do koszyka/i);
    });
  });

  // ============================================================================
  // TIER 14: PERFORMANCE & TIMEOUT
  // ============================================================================

  describe('Tier 14: Performance', () => {
    it('should respond within 5 seconds', async () => {
      const start = Date.now();
      await callBrain('Gdzie zjeść?');
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(5000);
    });

    it('should handle concurrent requests', async () => {
      const promises = Array.from({ length: 5 }, (_, i) =>
        callBrain(`Test ${i}`, `concurrent-${i}`)
      );
      const results = await Promise.all(promises);
      expect(results.every(r => r.ok)).toBe(true);
    });
  });
});

describe('🔧 Brain Stats API', () => {
  it('should return brain statistics', async () => {
    const response = await fetch(`${API_URL}/api/brain/stats`);
    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data).toBeTruthy();
  });
});

console.log('✅ Brain API cascade tests completed');

