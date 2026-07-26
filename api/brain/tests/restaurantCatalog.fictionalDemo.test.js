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

const KRAKOW_EXPECTED = [
    ['Smok i Piec', 'fad7a624-619f-468e-86d7-6c6859e9f094'],
    ['Zaułek Kazimierza', 'd02e89f6-c35b-4ca7-ad2a-3d79eab21d5f'],
    ['Okrąglak 12', 'f5a05b98-eda6-47f3-84bd-b470b02f2558'],
    ['Obwarzanek i Spółka', '27313088-c278-4bd5-a1da-27192c15f53d']
];

describe('fictional demo restaurant catalog', () => {
    it.each(EXPECTED)('contains %s with its stable database id', (name, id) => {
        expect(RESTAURANT_CATALOG.find((restaurant) => restaurant.name === name)).toMatchObject({
            id,
            demo: true
        });
    });

    it.each(KRAKOW_EXPECTED)('contains Kraków venue %s with its stable database id', (name, id) => {
        expect(RESTAURANT_CATALOG.find((restaurant) => restaurant.name === name)).toMatchObject({
            id,
            datasetId: 'krakow-v1',
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
        const filtered = filterRestaurantsForPublicDemo(
            RESTAURANT_CATALOG,
            true,
            'piekary-v1'
        );

        expect(filtered).toHaveLength(5);
        expect(filtered.every((restaurant) => restaurant.demo === true)).toBe(true);
        expect(findRestaurantInText('pokaż menu Bar Praha', { demoOnly: true })).toBeNull();
        expect(findRestaurantInText('pokaż menu Śląski Szynk', { demoOnly: true })?.name)
            .toBe('Śląski Szynk');
    });

    it('isolates Kraków and Piekary catalogs by dataset id', () => {
        const krakow = filterRestaurantsForPublicDemo(
            RESTAURANT_CATALOG,
            true,
            'krakow-v1'
        );
        const piekary = filterRestaurantsForPublicDemo(
            RESTAURANT_CATALOG,
            true,
            'piekary-v1'
        );

        expect(krakow).toHaveLength(4);
        expect(krakow.every((restaurant) => restaurant.city === 'Kraków')).toBe(true);
        expect(piekary).toHaveLength(5);
        expect(piekary.every((restaurant) => restaurant.city === 'Piekary Śląskie')).toBe(true);
        expect(findRestaurantInText('pokaż Smok i Piec', {
            demoOnly: true,
            datasetId: 'krakow-v1'
        })?.name).toBe('Smok i Piec');
        expect(findRestaurantInText('pokaż Smok i Piec', {
            demoOnly: true,
            datasetId: 'piekary-v1'
        })).toBeNull();
    });
});
