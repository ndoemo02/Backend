/**
 * Testy dla funkcjonalnych intencji (ETAP 1)
 * Testuje detekcję intencji na podstawie ZAMIARU, nie frazy
 */

import { describe, it, expect } from 'vitest';
import { 
  detectFunctionalIntent, 
  FUNCTIONAL_INTENTS,
  isFunctionalIntent 
} from '../../api/brain/intents/functionalIntentDetector.js';

describe('Functional Intent Detection (ETAP 1)', () => {
  describe('ADD_ITEM Intent', () => {
    it('should detect "a jeszcze mogę" as ADD_ITEM', () => {
      const result = detectFunctionalIntent('a jeszcze mogę', {});
      expect(result.intent).toBe(FUNCTIONAL_INTENTS.ADD_ITEM);
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it('should detect "a może by to dorzucić" as ADD_ITEM', () => {
      const result = detectFunctionalIntent('a może by to dorzucić', {});
      expect(result.intent).toBe(FUNCTIONAL_INTENTS.ADD_ITEM);
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it('should detect "dorzuć" as ADD_ITEM', () => {
      const result = detectFunctionalIntent('dorzuć', {});
      expect(result.intent).toBe(FUNCTIONAL_INTENTS.ADD_ITEM);
    });

    it('should detect "wezmę jeszcze" as ADD_ITEM', () => {
      const result = detectFunctionalIntent('wezmę jeszcze', {});
      expect(result.intent).toBe(FUNCTIONAL_INTENTS.ADD_ITEM);
    });

    it('should detect "a może być" as ADD_ITEM', () => {
      const result = detectFunctionalIntent('a może być', {});
      expect(result.intent).toBe(FUNCTIONAL_INTENTS.ADD_ITEM);
    });
  });

  describe('CONTINUE_ORDER Intent', () => {
    it('should detect "jeszcze coś" as CONTINUE_ORDER', () => {
      const result = detectFunctionalIntent('jeszcze coś', {});
      expect(result.intent).toBe(FUNCTIONAL_INTENTS.CONTINUE_ORDER);
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it('should detect "jakbym chciał jeszcze" as CONTINUE_ORDER', () => {
      const result = detectFunctionalIntent('jakbym chciał jeszcze', {});
      expect(result.intent).toBe(FUNCTIONAL_INTENTS.CONTINUE_ORDER);
    });

    it('should detect "coś jeszcze" as CONTINUE_ORDER', () => {
      const result = detectFunctionalIntent('coś jeszcze', {});
      expect(result.intent).toBe(FUNCTIONAL_INTENTS.CONTINUE_ORDER);
    });
  });

  describe('CONFIRM_ORDER Intent', () => {
    it('should detect "tak" as CONFIRM_ORDER in confirm context', () => {
      const session = { expectedContext: 'confirm_order', pendingOrder: true };
      const result = detectFunctionalIntent('tak', session);
      expect(result.intent).toBe(FUNCTIONAL_INTENTS.CONFIRM_ORDER);
      expect(result.confidence).toBeGreaterThanOrEqual(0.95);
    });

    it('should detect "potwierdzam" as CONFIRM_ORDER in confirm context', () => {
      const session = { expectedContext: 'confirm_order' };
      const result = detectFunctionalIntent('potwierdzam', session);
      expect(result.intent).toBe(FUNCTIONAL_INTENTS.CONFIRM_ORDER);
    });

    it('should detect "poproszę" as CONFIRM_ORDER in confirm context', () => {
      const session = { expectedContext: 'confirm_order' };
      const result = detectFunctionalIntent('poproszę', session);
      expect(result.intent).toBe(FUNCTIONAL_INTENTS.CONFIRM_ORDER);
    });
  });

  describe('CANCEL_ORDER Intent', () => {
    it('should detect "nie" as CANCEL_ORDER in confirm context', () => {
      const session = { expectedContext: 'confirm_order', pendingOrder: true };
      const result = detectFunctionalIntent('nie', session);
      expect(result.intent).toBe(FUNCTIONAL_INTENTS.CANCEL_ORDER);
      expect(result.confidence).toBeGreaterThanOrEqual(0.95);
    });

    it('should detect "anuluj" as CANCEL_ORDER', () => {
      const result = detectFunctionalIntent('anuluj', {});
      expect(result.intent).toBe(FUNCTIONAL_INTENTS.CANCEL_ORDER);
    });

    it('should detect "odwołaj" as CANCEL_ORDER', () => {
      const result = detectFunctionalIntent('odwołaj', {});
      expect(result.intent).toBe(FUNCTIONAL_INTENTS.CANCEL_ORDER);
    });
  });

  describe('UNKNOWN_INTENT Fallback', () => {
    it('should return UNKNOWN_INTENT for unrecognized input', () => {
      const result = detectFunctionalIntent('jakieś losowe słowa', {});
      expect(result.intent).toBe(FUNCTIONAL_INTENTS.UNKNOWN_INTENT);
      expect(result.reason).toBe('no_functional_pattern_matched');
    });

    it('should return UNKNOWN_INTENT for empty input', () => {
      const result = detectFunctionalIntent('', {});
      expect(result.intent).toBe(FUNCTIONAL_INTENTS.UNKNOWN_INTENT);
      expect(result.reason).toBe('empty_input');
    });

    it('should return UNKNOWN_INTENT for null input', () => {
      const result = detectFunctionalIntent(null, {});
      expect(result.intent).toBe(FUNCTIONAL_INTENTS.UNKNOWN_INTENT);
      expect(result.reason).toBe('empty_input');
    });

    it('should always return some intent (never undefined)', () => {
      const inputs = ['', null, undefined, 'test', 'xyz', '123'];
      inputs.forEach(input => {
        const result = detectFunctionalIntent(input, {});
        expect(result).toBeDefined();
        expect(result.intent).toBeDefined();
        expect(typeof result.intent).toBe('string');
        expect(result.intent.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Safety and Determinism', () => {
    it('should never throw errors', () => {
      const problematicInputs = [null, undefined, '', 123, {}, [], true];
      problematicInputs.forEach(input => {
        expect(() => {
          detectFunctionalIntent(input, {});
        }).not.toThrow();
      });
    });

    it('should always return consistent structure', () => {
      const result = detectFunctionalIntent('test', {});
      expect(result).toHaveProperty('intent');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('reason');
      expect(result).toHaveProperty('rawText');
      expect(typeof result.intent).toBe('string');
      expect(typeof result.confidence).toBe('number');
      expect(typeof result.reason).toBe('string');
    });

    it('should be deterministic (same input = same output)', () => {
      const input = 'a jeszcze mogę';
      const result1 = detectFunctionalIntent(input, {});
      const result2 = detectFunctionalIntent(input, {});
      expect(result1.intent).toBe(result2.intent);
      expect(result1.confidence).toBe(result2.confidence);
      expect(result1.reason).toBe(result2.reason);
    });
  });

  describe('isFunctionalIntent helper', () => {
    it('should correctly identify functional intents', () => {
      expect(isFunctionalIntent(FUNCTIONAL_INTENTS.ADD_ITEM)).toBe(true);
      expect(isFunctionalIntent(FUNCTIONAL_INTENTS.CONTINUE_ORDER)).toBe(true);
      expect(isFunctionalIntent(FUNCTIONAL_INTENTS.CONFIRM_ORDER)).toBe(true);
      expect(isFunctionalIntent(FUNCTIONAL_INTENTS.CANCEL_ORDER)).toBe(true);
      expect(isFunctionalIntent(FUNCTIONAL_INTENTS.UNKNOWN_INTENT)).toBe(true);
    });

    it('should return false for non-functional intents', () => {
      expect(isFunctionalIntent('create_order')).toBe(false);
      expect(isFunctionalIntent('find_nearby')).toBe(false);
      expect(isFunctionalIntent('show_menu')).toBe(false);
      expect(isFunctionalIntent('unknown')).toBe(false);
    });
  });

  describe('Required Phrases (from requirements)', () => {
    it('should detect "a jeszcze mogę…" as ADD_ITEM', () => {
      const result = detectFunctionalIntent('a jeszcze mogę', {});
      expect(result.intent).toBe(FUNCTIONAL_INTENTS.ADD_ITEM);
    });

    it('should detect "a może by to dorzucić" as ADD_ITEM', () => {
      const result = detectFunctionalIntent('a może by to dorzucić', {});
      expect(result.intent).toBe(FUNCTIONAL_INTENTS.ADD_ITEM);
    });

    it('should detect "jeszcze coś" as CONTINUE_ORDER', () => {
      const result = detectFunctionalIntent('jeszcze coś', {});
      expect(result.intent).toBe(FUNCTIONAL_INTENTS.CONTINUE_ORDER);
    });

    it('should detect "jakbym chciał jeszcze" as CONTINUE_ORDER', () => {
      const result = detectFunctionalIntent('jakbym chciał jeszcze', {});
      expect(result.intent).toBe(FUNCTIONAL_INTENTS.CONTINUE_ORDER);
    });
  });
});

