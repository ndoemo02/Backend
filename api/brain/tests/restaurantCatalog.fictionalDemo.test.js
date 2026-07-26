import { describe, expect, it } from 'vitest';

import {
    filterRestaurantsForPublicDemo,
    findRestaurantInText,
    RESTAURANT_CATALOG
} from '../data/restaurantCatalog.js';

const EXPECTED = [
    ['Silesiana Italiana', 'acced74f-ddac-43a0-9f78-016c397f4b8e'],
    ['Ruszt i Ogień', '6cce66fb-4d2d-402f-abe5-22e9784d559c'],
    ['Syto po Naszymu', 'a2be7ddb-d1dd-49d6-9026-57ecd4c94d60'],
    ['Kebs & Roll', '72c76694-f533-46b8-b831-1965210a0cb4']
];

describe('fictional demo restaurant catalog', () => {
    it.each(EXPECTED)('contains %s with its stable database id', (name, id) => {
        expect(RESTAURANT_CATALOG.find((restaurant) => restaurant.name === name)).toMatchObject({
            id,
            demo: true
        });
    });

    it.each([
        ['pokaż menu Silesiana Italiana', 'Silesiana Italiana'],
        ['co polecasz w Silesianie Italianie?', 'Silesiana Italiana'],
        ['chcę zjeść w Ruszcie i Ogniu', 'Ruszt i Ogień'],
        ['pokaż menu Ruszt i Ogien', 'Ruszt i Ogień'],
        ['menu Syto po Naszymu', 'Syto po Naszymu'],
        ['co macie po naszymu?', 'Syto po Naszymu'],
        ['pokaż Kebs and Roll', 'Kebs & Roll'],
        ['pokaż menu Cups and Roll', 'Kebs & Roll'],
        ['otwórz Keps and Roll', 'Kebs & Roll'],
        ['menu kebs', 'Kebs & Roll']
    ])('matches "%s" to %s', (utterance, expectedName) => {
        expect(findRestaurantInText(utterance)?.name).toBe(expectedName);
    });

    it.each([
        'pokaż restauracje włoskie',
        'chcę coś z grilla',
        'pokaż wszystkie kebaby',
        'mam ochotę na rollo'
    ])('does not hijack a generic discovery query: "%s"', (utterance) => {
        expect(findRestaurantInText(utterance)).toBeNull();
    });

    it('keeps only fictional tenants when public demo mode is enabled', () => {
        const filtered = filterRestaurantsForPublicDemo(RESTAURANT_CATALOG, true);

        expect(filtered).toHaveLength(5);
        expect(filtered.every((restaurant) => restaurant.demo === true)).toBe(true);
        expect(findRestaurantInText('pokaż menu Bar Praha', { demoOnly: true })).toBeNull();
        expect(findRestaurantInText('pokaż menu Śląski Szynk', { demoOnly: true })?.name)
            .toBe('Śląski Szynk');
    });
});
