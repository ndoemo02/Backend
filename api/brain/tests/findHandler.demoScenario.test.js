import { describe, expect, it, vi } from 'vitest';

import { FindRestaurantHandler } from '../domains/food/findHandler.js';

function buildRepository(rows = []) {
    return {
        searchRestaurants: vi.fn().mockResolvedValue(rows),
        searchNearby: vi.fn().mockResolvedValue([]),
    };
}

describe('FindRestaurantHandler demo scenario boundary', () => {
    it('routes the tourist scenario to Kraków without relying on device GPS', async () => {
        const repo = buildRepository([
            {
                id: 'fad7a624-619f-468e-86d7-6c6859e9f094',
                name: 'Smok i Piec',
                city: 'Kraków',
                cuisine_type: 'Nowoczesna kuchnia małopolska',
            },
            {
                id: 'acced74f-ddac-43a0-9f78-016c397f4b8e',
                name: 'Silesiana Italiana',
                city: 'Piekary Śląskie',
                cuisine_type: 'Włoska / Śląska fusion',
            },
        ]);
        const handler = new FindRestaurantHandler(repo);

        const result = await handler.execute({
            text: 'pokaż miejsca w pobliżu',
            entities: {},
            session: {
                demoScenarioId: 'krakow-tourist',
                demoDatasetId: 'krakow-v1',
            },
            body: {
                lat: 50.39,
                lng: 18.95,
            },
        });

        expect(repo.searchNearby).not.toHaveBeenCalled();
        expect(repo.searchRestaurants).toHaveBeenCalledWith('Kraków', null);
        expect(result.restaurants?.map((restaurant) => restaurant.name))
            .toEqual(['Smok i Piec']);
        expect(result.contextUpdates?.last_location).toBe('Kraków');
    });

    it('does not let an explicit Piekary request cross the Kraków scenario boundary', async () => {
        const repo = buildRepository();
        const handler = new FindRestaurantHandler(repo);

        const result = await handler.execute({
            text: 'pokaż restauracje w Piekarach',
            entities: { location: 'Piekary Śląskie' },
            session: {
                demoScenarioId: 'krakow-tourist',
                demoDatasetId: 'krakow-v1',
            },
            body: {},
        });

        expect(result.reply).toMatch(/tylko w Kraków/i);
        expect(repo.searchRestaurants).not.toHaveBeenCalled();
        expect(repo.searchNearby).not.toHaveBeenCalled();
    });

    it('keeps Piekary as the backward-compatible default scenario', async () => {
        const repo = buildRepository([
            {
                id: 'acced74f-ddac-43a0-9f78-016c397f4b8e',
                name: 'Silesiana Italiana',
                city: 'Piekary Śląskie',
                cuisine_type: 'Włoska / Śląska fusion',
            },
        ]);
        const handler = new FindRestaurantHandler(repo);

        const result = await handler.execute({
            text: 'pokaż restauracje',
            entities: {},
            session: {},
            body: {},
        });

        expect(repo.searchRestaurants).toHaveBeenCalledWith('Piekary Śląskie', null);
        expect(result.restaurants?.map((restaurant) => restaurant.name))
            .toEqual(['Silesiana Italiana']);
    });

    it('shows only fictional Piekary venues when DemoContext is explicit', async () => {
        const repo = buildRepository([
            {
                id: 'acced74f-ddac-43a0-9f78-016c397f4b8e',
                name: 'Silesiana Italiana',
                city: 'Piekary Śląskie',
                cuisine_type: 'Włoska / Śląska fusion',
            },
            {
                id: '4d27fbe3-20d0-4eb4-b003-1935be53af25',
                name: 'Rezydencja Luxury Hotel',
                city: 'Piekary Śląskie',
                cuisine_type: 'Międzynarodowa',
            },
        ]);
        const handler = new FindRestaurantHandler(repo);

        const result = await handler.execute({
            text: 'pokaż restauracje',
            entities: {},
            session: {
                demoScenarioId: 'piekary-local',
                demoDatasetId: 'piekary-v1',
            },
            body: {},
        });

        expect(result.restaurants?.map((restaurant) => restaurant.name))
            .toEqual(['Silesiana Italiana']);
    });
});
