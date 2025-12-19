/**
 * Testy jednostkowe dla Smart Intent System (Classic NLU + LLM Fallback)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { smartResolveIntent } from '../../api/brain/ai/smartIntent.js';

// Mock detectIntent
vi.mock('../../api/brain/intents/intentRouterGlue.js', () => ({
  detectIntent: vi.fn()
}));

import { detectIntent } from '../../api/brain/intents/intentRouterGlue.js';

describe('Smart Intent Resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment
    delete process.env.USE_LLM_INTENT;
    delete process.env.OPENAI_API_KEY;
    delete process.env.FORCE_LLM_TEST;
  });

  describe('Empty Input Handling', () => {
    it('should return smalltalk intent for empty text', async () => {
      const result = await smartResolveIntent({
        text: '',
        session: {},
        restaurants: [],
        previousIntent: null
      });

      expect(result.intent).toBe('smalltalk');
      expect(result.confidence).toBe(0);
      expect(result.source).toBe('empty');
    });

    it('should return smalltalk intent for whitespace-only text', async () => {
      const result = await smartResolveIntent({
        text: '   ',
        session: {},
        restaurants: [],
        previousIntent: null
      });

      expect(result.intent).toBe('smalltalk');
      expect(result.source).toBe('empty');
    });
  });

  describe('Classic NLU Path', () => {
    it('should use classic NLU result when confidence is high', async () => {
      detectIntent.mockResolvedValueOnce({
        intent: 'find_nearby',
        confidence: 0.85,
        entities: { location: 'Warsaw' }
      });

      const result = await smartResolveIntent({
        text: 'co jest dostępne w pobliżu',
        session: {},
        restaurants: [],
        previousIntent: null
      });

      expect(result.intent).toBe('find_nearby');
      expect(result.confidence).toBe(0.85);
      expect(result.source).toBe('classic');
      expect(result.slots).toEqual({ location: 'Warsaw' });
    });

    it('should use classic NLU result when expectedContext exists', async () => {
      detectIntent.mockResolvedValueOnce({
        intent: 'none',
        confidence: 0.5,
        entities: {}
      });

      const result = await smartResolveIntent({
        text: 'pokaż więcej',
        session: { expectedContext: 'show_more_options' },
        restaurants: [],
        previousIntent: null
      });

      // Should skip LLM because of expectedContext
      expect(result.source).toBe('classic');
      expect(detectIntent).toHaveBeenCalled();
    });

    it('should handle classic NLU errors gracefully', async () => {
      detectIntent.mockRejectedValueOnce(new Error('NLU failed'));

      const result = await smartResolveIntent({
        text: 'test',
        session: {},
        restaurants: [],
        previousIntent: null
      });

      expect(result.intent).toBe('unknown');
      expect(result.confidence).toBe(0);
      expect(result.source).toBe('classic');
    });

    it('should skip LLM for high confidence non-none intents', async () => {
      detectIntent.mockResolvedValueOnce({
        intent: 'menu_request',
        confidence: 0.8,
        entities: {}
      });

      const result = await smartResolveIntent({
        text: 'pokaż menu',
        session: {},
        restaurants: [],
        previousIntent: null
      });

      expect(result.intent).toBe('menu_request');
      expect(result.source).toBe('classic');
    });

    it('should NOT skip LLM for high confidence "none" intent', async () => {
      detectIntent.mockResolvedValueOnce({
        intent: 'none',
        confidence: 0.9, // High but useless
        entities: {}
      });

      // Mock fetch for LLM call (but it won't be called if no API key)
      global.fetch = vi.fn();

      const result = await smartResolveIntent({
        text: 'niezrozumiały tekst',
        session: {},
        restaurants: [],
        previousIntent: null
      });

      // Should return classic result because no LLM API key
      expect(result.intent).toBe('none');
      expect(result.source).toBe('classic');
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('LLM Fallback Path', () => {
    beforeEach(() => {
      // Setup LLM environment
      process.env.OPENAI_API_KEY = 'test-key';
      global.fetch = vi.fn();
    });

    it('should call LLM when classic confidence is low', async () => {
      detectIntent.mockResolvedValueOnce({
        intent: 'none',
        confidence: 0.4,
        entities: {}
      });

      // Mock successful LLM response
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                intent: 'find_nearby',
                confidence: 0.9,
                slots: { cuisine: 'pizza' }
              })
            }
          }]
        })
      });

      const result = await smartResolveIntent({
        text: 'gdzie mogę zjeść pizzę',
        session: {},
        restaurants: [],
        previousIntent: null
      });

      expect(result.intent).toBe('find_nearby');
      expect(result.confidence).toBe(0.9);
      expect(result.source).toBe('llm');
      expect(result.slots).toMatchObject({ cuisine: 'pizza' });
      expect(global.fetch).toHaveBeenCalled();
    });

    it('should include context in LLM request', async () => {
      detectIntent.mockResolvedValueOnce({
        intent: 'none',
        confidence: 0.4,
        entities: {}
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                intent: 'show_menu',
                confidence: 0.85,
                slots: {}
              })
            }
          }]
        })
      });

      await smartResolveIntent({
        text: 'pokaż menu',
        session: {
          lastRestaurant: { name: 'Pizzeria Roma' },
          last_location: 'Warsaw'
        },
        restaurants: [],
        previousIntent: 'find_nearby'
      });

      const fetchCall = global.fetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      
      expect(body.messages[0].content).toContain('lastIntent');
      expect(body.messages[0].content).toContain('Pizzeria Roma');
      expect(body.messages[0].content).toContain('Warsaw');
    });

    it('should fallback to classic when LLM returns unknown', async () => {
      detectIntent.mockResolvedValueOnce({
        intent: 'none',
        confidence: 0.4,
        entities: {}
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                intent: 'unknown',
                confidence: 0.3,
                slots: {}
              })
            }
          }]
        })
      });

      const result = await smartResolveIntent({
        text: 'random gibberish',
        session: {},
        restaurants: [],
        previousIntent: null
      });

      // Should return classic result because LLM returned unknown
      expect(result.intent).toBe('none');
      expect(result.source).toBe('classic');
    });

    it('should handle LLM API errors gracefully', async () => {
      detectIntent.mockResolvedValueOnce({
        intent: 'none',
        confidence: 0.4,
        entities: {}
      });

      global.fetch.mockRejectedValueOnce(new Error('API error'));

      const result = await smartResolveIntent({
        text: 'test',
        session: {},
        restaurants: [],
        previousIntent: null
      });

      // Should fallback to classic
      expect(result.intent).toBe('none');
      expect(result.source).toBe('classic');
    });

    it('should handle LLM non-OK responses', async () => {
      detectIntent.mockResolvedValueOnce({
        intent: 'none',
        confidence: 0.4,
        entities: {}
      });

      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 429
      });

      const result = await smartResolveIntent({
        text: 'test',
        session: {},
        restaurants: [],
        previousIntent: null
      });

      expect(result.source).toBe('classic');
    });

    it('should merge classic slots with LLM slots', async () => {
      detectIntent.mockResolvedValueOnce({
        intent: 'none',
        confidence: 0.4,
        entities: { location: 'Warsaw' }
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                intent: 'find_nearby',
                confidence: 0.9,
                slots: { cuisine: 'pizza' }
              })
            }
          }]
        })
      });

      const result = await smartResolveIntent({
        text: 'gdzie pizza w Warszawie',
        session: {},
        restaurants: [],
        previousIntent: null
      });

      expect(result.slots).toMatchObject({
        location: 'Warsaw',
        cuisine: 'pizza'
      });
    });
  });

  describe('Environment Configuration', () => {
    it('should skip LLM when USE_LLM_INTENT is not set and no API key', async () => {
      delete process.env.USE_LLM_INTENT;
      delete process.env.OPENAI_API_KEY;
      
      detectIntent.mockResolvedValueOnce({
        intent: 'none',
        confidence: 0.4,
        entities: {}
      });

      global.fetch = vi.fn();

      const result = await smartResolveIntent({
        text: 'test',
        session: {},
        restaurants: [],
        previousIntent: null
      });

      expect(result.source).toBe('classic');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should use LLM when USE_LLM_INTENT is true', async () => {
      process.env.USE_LLM_INTENT = 'true';
      delete process.env.OPENAI_API_KEY;
      
      detectIntent.mockResolvedValueOnce({
        intent: 'none',
        confidence: 0.4,
        entities: {}
      });

      global.fetch = vi.fn().mockRejectedValueOnce(new Error('No API key'));

      await smartResolveIntent({
        text: 'test',
        session: {},
        restaurants: [],
        previousIntent: null
      });

      // Should attempt LLM call even without API key if USE_LLM_INTENT is set
      // (will fail but attempt was made)
      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe('Intent Mapping', () => {
    it('should map classic intents correctly', async () => {
      detectIntent.mockResolvedValueOnce({
        intent: 'menu_request',
        confidence: 0.8,
        entities: {}
      });

      const result = await smartResolveIntent({
        text: 'pokaż menu',
        session: {},
        restaurants: [],
        previousIntent: null
      });

      expect(result.intent).toBe('menu_request');
      expect(result.source).toBe('classic');
    });

    it('should handle missing confidence gracefully', async () => {
      detectIntent.mockResolvedValueOnce({
        intent: 'find_nearby',
        entities: {}
        // No confidence field
      });

      const result = await smartResolveIntent({
        text: 'co w pobliżu',
        session: {},
        restaurants: [],
        previousIntent: null
      });

      expect(result.confidence).toBe(0);
      expect(result.intent).toBe('find_nearby');
    });

    it('should handle missing entities gracefully', async () => {
      detectIntent.mockResolvedValueOnce({
        intent: 'create_order',
        confidence: 0.7
        // No entities field
      });

      const result = await smartResolveIntent({
        text: 'zamów pizzę',
        session: {},
        restaurants: [],
        previousIntent: null
      });

      expect(result.slots).toEqual({});
    });
  });
});





