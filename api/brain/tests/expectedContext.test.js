
// /api/brain/tests/expectedContext.test.js
// Specjalizowane testy dla expectedContext flow

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { boostIntent } from '../intents/boostIntent.js';
import { updateSession, getSession } from '../context.js';

describe('🧠 ExpectedContext Flow Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('✅ Confirm Menu Flow', () => {
    it('should detect confirmation with confirm_menu context', () => {
      const session = {
        expectedContext: 'confirm_menu',
        lastRestaurant: { name: 'Test Restaurant' }
      };

      const confirmCases = [
        'tak',
        'tak pokaz',
        'chętnie',
        'chętnie zobaczę',
        'pokaż',
        'jasne'
      ];

      confirmCases.forEach(text => {
        const result = boostIntent('none', text, session);
        if (typeof result === 'object') {
          expect(result.intent).toBe('show_menu');
          expect(result.boosted).toBe(true);
        } else {
          expect(result).toBe('show_menu');
        }
      });
    });

    it('should accept show_menu as alias for confirm_menu context', () => {
      const session = {
        expectedContext: 'show_menu', // old legacy context
        lastRestaurant: { name: 'Test Restaurant' }
      };
      const result = boostIntent('none', 'tak', session);
      if (typeof result === 'object') {
        expect(result.intent).toBe('show_menu');
      } else {
        expect(result).toBe('show_menu');
      }
    });

    it('should NOT boost if text is too long', () => {
      const session = { expectedContext: 'confirm_menu' };
      const longText = 'tak poproszę ale chciałbym też wiedzieć czy macie frytki';
      const result = boostIntent('none', longText, session);
      expect(result).toBe('none'); // No boost
    });
  });

  describe('✅ Confirm Choice Flow', () => {
    it('should detect confirmation with confirm_choice context', () => {
      const session = {
        expectedContext: 'confirm_choice',
      };

      const confirmCases = ['tak', 'potwierdzam', 'poproszę', 'ok'];

      confirmCases.forEach(text => {
        const result = boostIntent('none', text, session);
        if (typeof result === 'object') {
          expect(result.intent).toBe('confirm');
        } else {
          expect(result).toBe('confirm');
        }
      });
    });

    it('should NOT boost unrelated text', () => {
      const session = { expectedContext: 'confirm_choice' };
      const result = boostIntent('none', 'nie wiem', session);
      expect(result).toBe('none');
    });
  });


  describe('🧪 Session State Tests', () => {
    it('should preserve session state during expectedContext flow', () => {
      const sessionId = 'test-session';

      // Ustaw początkową sesję
      updateSession(sessionId, {
        lastIntent: 'find_nearby',
        lastRestaurant: { name: 'Original Restaurant' },
        last_location: 'Piekary Śląskie'
      });

      // Ustaw expectedContext
      updateSession(sessionId, {
        expectedContext: 'confirm_menu'
      });

      const session = getSession(sessionId);

      // Sprawdź czy dane zostały zachowane
      expect(session.lastIntent).toBe('find_nearby');
      expect(session.lastRestaurant.name).toBe('Original Restaurant');
      expect(session.expectedContext).toBe('confirm_menu');
    });
  });

  describe('🎭 Edge Cases', () => {
    it('should handle missing expectedContext gracefully', () => {
      const session = {
        expectedContext: null
      };
      const result = boostIntent('none', 'tak', session);
      expect(result).toBe('none');
    });

    it('should handle undefined session', () => {
      const result = boostIntent('none', 'tak', undefined);
      expect(result).toBe('none');
    });
  });
});
