import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NLURouter } from '../nlu/router.js';
import { checkRequiredState } from '../core/IntentCapabilityMap.js';
import { parseOrderItems } from '../order/parseOrderItems.js';
import { renderSurface } from '../dialog/SurfaceRenderer.js';
import { BrainPipeline } from '../core/pipeline.js';
import { InMemoryRestaurantRepository } from '../core/repository.js';

// Setup Mock for Supabase
vi.mock('../../_supabase.js', () => {
  const mockResult = {
    data: [
      { id: 'uuid-1', name: 'Pizza Margherita', price_pln: 25, category: 'pizza', available: true },
      { id: 'uuid-2', name: 'Carpaccio z kaczki marynowanej w grzańcu', price_pln: 45, category: 'starter', available: true }
    ],
    error: null
  };
  const queryBuilder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue(mockResult),
    ilike: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(mockResult),
    then: vi.fn().mockImplementation((onSuccess) => Promise.resolve(mockResult).then(onSuccess))
  };
  return { supabase: { from: vi.fn(() => queryBuilder) } };
});

describe('BRAINV2 VALIDATION SUITE (FINAL)', () => {
  const nlu = new NLURouter();

  it('01_NLU: find_nearby extraction', async () => {
    const result = await nlu.detect({
      text: 'Gdzie w Piekarach zjem kebaba',
      session: {}
    });
    expect(result.intent).toBe('find_nearby');
    expect(result.entities.location).toBe('Piekary');
  });

  it('02_ICM/FSM: Requirements', () => {
    expect(checkRequiredState('menu_request', {}).met).toBe(false);
    expect(checkRequiredState('menu_request', { currentRestaurant: { id: 'r1' } }).met).toBe(true);
  });

  it('03_Disambiguation: Parsing', async () => {
    const items = await parseOrderItems('Zamawiam carpaccio', 'rest-1');
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].name).toContain('Carpaccio');
  });

  it('04_Dialog Surface: Rendering', () => {
    const result = renderSurface({
      key: 'ASK_RESTAURANT_FOR_MENU',
      facts: { restaurants: [{ name: 'Testowa' }] }
    });
    expect(result.reply).toContain('Testowa');
  });

  it('05_FULL PIPELINE: Multi-match Flow', async () => {
    const repo = new InMemoryRestaurantRepository({
      restaurants: [
        { id: 'r1', name: 'Kebab u Aliego', city: 'Piekary', cuisine_type: 'Kebab' },
        { id: 'r2', name: 'Kebab Królewski', city: 'Piekary', cuisine_type: 'Kebab' }
      ]
    });
    const pipeline = new BrainPipeline({ nlu, repository: repo });
    
    const res = await pipeline.process('sess-1', 'Gdzie w Piekarach zjem kebaba');
    
    // NLU should detect find_nearby
    expect(res.intent).toBe('find_nearby');
    // Multiple results + expectedContext=select_restaurant should trigger CHOOSE_RESTAURANT surface
    expect(res.restaurants.length).toBe(2);
    expect(res.reply).toMatch(/wybierasz|którą/i);
  });
});
