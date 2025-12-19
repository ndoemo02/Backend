// /api/brain/tests/aliases.test.js
// Testy dla aliasów dań w intent-router.js

import { describe, it, expect } from 'vitest';
import { applyAliases } from '../intent-router.js';

describe('🍕 Food Aliases Tests', () => {
  describe('🍕 Pizza Aliases', () => {
    it('should map "diabolo" to "pizza diavola"', () => {
      const testCases = [
        'chcę pizzę diabolo',
        'zamów diabolo',
        'pizza diabolo',
        'diabolo proszę'
      ];

      testCases.forEach(text => {
        const result = applyAliases(text);
        expect(result).toContain('pizza diavola');
      });
    });

    it('should map "diabola" to "pizza diavola"', () => {
      const testCases = [
        'zamów diabola',
        'pizza diabola',
        'chcę diabola'
      ];

      testCases.forEach(text => {
        const result = applyAliases(text);
        expect(result).toContain('pizza diavola');
      });
    });

    it('should map "pizza diabolo" to "pizza diavola"', () => {
      const result = applyAliases('pizza diabolo');
      expect(result).toContain('pizza diavola');
    });

    it('should map "margherita" variants', () => {
      const testCases = [
        'margherita',
        'margherite',
        'margerita',  // częsty błąd STT
        'margarita'   // częsty błąd STT
      ];

      testCases.forEach(text => {
        const result = applyAliases(text);
        expect(result).toContain('pizza margherita');
      });
    });

    it('should map other pizza types', () => {
      const testCases = [
        { input: 'pepperoni', expected: 'pizza pepperoni' },
        { input: 'hawajska', expected: 'pizza hawajska' },
        { input: 'hawajskiej', expected: 'pizza hawajska' },
        { input: 'diavola', expected: 'pizza diavola' },
        { input: 'capricciosa', expected: 'pizza capricciosa' }
      ];

      testCases.forEach(({ input, expected }) => {
        const result = applyAliases(input);
        expect(result).toContain(expected);
      });
    });
  });

  describe('🍲 Soup Aliases', () => {
    it('should map "czosnkowa" variants', () => {
      const testCases = [
        'czosnkowa',
        'czosnkowe',
        'czosnkowej'
      ];

      testCases.forEach(text => {
        const result = applyAliases(text);
        expect(result).toContain('zupa czosnkowa');
      });
    });

    it('should map "żurek" variants', () => {
      const testCases = [
        'zurek',
        'zurku',
        'zurkiem'
      ];

      testCases.forEach(text => {
        const result = applyAliases(text);
        expect(result).toContain('żurek śląski');
      });
    });

    it('should map "pho" to "zupa pho bo"', () => {
      const result = applyAliases('pho');
      expect(result).toContain('zupa pho bo');
    });
  });

  describe('🥩 Meat Aliases', () => {
    it('should map "schabowy" variants', () => {
      const testCases = [
        'schabowy',
        'schabowe',
        'schabowego',
        'kotlet',
        'kotleta'
      ];

      testCases.forEach(text => {
        const result = applyAliases(text);
        expect(result).toContain('kotlet schabowy');
      });
    });

    it('should map "gulasz" variants', () => {
      const testCases = [
        'gulasz',
        'gulasza',
        'gulaszem'
      ];

      testCases.forEach(text => {
        const result = applyAliases(text);
        expect(result).toContain('gulasz wieprzowy');
      });
    });

    it('should map "rolada" variants', () => {
      const testCases = [
        'rolada',
        'rolade',
        'rolady'
      ];

      testCases.forEach(text => {
        const result = applyAliases(text);
        expect(result).toContain('rolada śląska');
      });
    });
  });

  describe('🥟 Pierogi Aliases', () => {
    it('should map "pierogi" variants', () => {
      const testCases = [
        'pierogi',
        'pierogów',
        'pierogami'
      ];

      testCases.forEach(text => {
        const result = applyAliases(text);
        expect(result).toContain('pierogi z mięsem');
      });
    });
  });

  describe('🍝 Italian Aliases', () => {
    it('should map "lasagne" variants', () => {
      const testCases = [
        'lasagne',
        'lasania',  // częsty błąd STT
        'lasanie'
      ];

      testCases.forEach(text => {
        const result = applyAliases(text);
        expect(result).toContain('lasagne bolognese');
      });
    });

    it('should map other Italian dishes', () => {
      const testCases = [
        { input: 'tiramisu', expected: 'tiramisu' },
        { input: 'caprese', expected: 'sałatka caprese' }
      ];

      testCases.forEach(({ input, expected }) => {
        const result = applyAliases(input);
        expect(result).toContain(expected);
      });
    });
  });

  describe('🍜 Asian Aliases', () => {
    it('should map "pad thai" variants', () => {
      const testCases = [
        'pad thai',
        'pad taj',  // częsty błąd STT
        'padthai'
      ];

      testCases.forEach(text => {
        const result = applyAliases(text);
        expect(result).toContain('pad thai z krewetkami');
      });
    });

    it('should map "sajgonki" variants', () => {
      const testCases = [
        'sajgonki',
        'sajgonek',
        'sajgonkami'
      ];

      testCases.forEach(text => {
        const result = applyAliases(text);
        expect(result).toContain('sajgonki z mięsem');
      });
    });
  });

  describe('🍔 Other Aliases', () => {
    it('should map "burger" variants', () => {
      const testCases = [
        'burger',
        'burgera'
      ];

      testCases.forEach(text => {
        const result = applyAliases(text);
        expect(result).toContain('burger');
      });
    });

    it('should map "placki" variants', () => {
      const testCases = [
        'placki',
        'placków'
      ];

      testCases.forEach(text => {
        const result = applyAliases(text);
        expect(result).toContain('placki ziemniaczane');
      });
    });

    it('should map "frytki" variants', () => {
      const testCases = [
        'frytki',
        'frytek'
      ];

      testCases.forEach(text => {
        const result = applyAliases(text);
        expect(result).toContain('frytki belgijskie');
      });
    });
  });

  describe('🔄 Multiple Aliases', () => {
    it('should handle multiple aliases in one text', () => {
      const text = 'chcę pizzę margheritę i diabolo';
      const result = applyAliases(text);
      
      expect(result).toContain('pizza margherita');
      expect(result).toContain('pizza diavola');
    });

    it('should handle complex order with multiple aliases', () => {
      const text = 'zamów pizzę diabolo, zupę czosnkową i kotlet schabowy';
      const result = applyAliases(text);
      
      expect(result).toContain('pizza diavola');
      expect(result).toContain('zupa czosnkowa');
      expect(result).toContain('kotlet schabowy');
    });

    it('should not duplicate existing full names', () => {
      const text = 'chcę pizza margherita'; // już pełna nazwa
      const result = applyAliases(text);
      
      // Nie powinno dodać duplikatu
      const matches = result.match(/pizza margherita/g);
      expect(matches).toHaveLength(1);
    });
  });

  describe('🎭 Edge Cases', () => {
    it('should handle empty text', () => {
      const result = applyAliases('');
      expect(result).toBe('');
    });

    it('should handle null text', () => {
      const result = applyAliases(null);
      expect(result).toBe('');
    });

    it('should handle undefined text', () => {
      const result = applyAliases(undefined);
      expect(result).toBe('');
    });

    it('should handle text without aliases', () => {
      const text = 'chcę coś do jedzenia';
      const result = applyAliases(text);
      expect(result).toBe(text); // Bez zmian
    });

    it('should handle case insensitive matching', () => {
      const testCases = [
        'DIABOLO',
        'Diabolo',
        'diabolo',
        'DiAbOlO'
      ];

      testCases.forEach(text => {
        const result = applyAliases(text);
        expect(result).toContain('pizza diavola');
      });
    });
  });
});


