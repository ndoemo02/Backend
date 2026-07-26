import { describe, it, expect } from 'vitest';
import { findRestaurantInText } from '../data/restaurantCatalog.js';

describe('restaurant catalog - Śląski Szynk demo tenant', () => {
    it.each([
        'pokaż menu Śląskiego Szynku',
        'chcę zamówić w śląskim szynku',
        'slaski szynk',
        'otwórz szynk'
    ])('matches supported name form: %s', (utterance) => {
        const match = findRestaurantInText(utterance);

        expect(match).toMatchObject({
            id: '4ad6b301-671b-4343-bf91-9bab7cda37b4',
            name: 'Śląski Szynk',
            demo: true
        });
    });

    it('does not hijack a generic request for Silesian food', () => {
        expect(findRestaurantInText('pokaż śląskie jedzenie w pobliżu')).toBeNull();
    });
});

