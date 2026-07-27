import { describe, expect, it } from 'vitest';

import {
    resolveContextualVariant,
    verifyMenuItemAgainstQuery,
} from '../discovery/itemTaxonomyVerification.js';

describe('menu item taxonomy verification', () => {
    it('verifies spicy and vegetarian metadata at item level', () => {
        const result = verifyMenuItemAgainstQuery({
            spicy: true,
            is_vege: true,
            item_tags: ['spicy'],
        }, {
            tags: ['spicy', 'vege'],
            dietarys: ['vegetarian'],
        });

        expect(result.passes).toBe(true);
        expect(result.feedback).toEqual(expect.arrayContaining([
            { id: 'spicy', dimension: 'tag', state: 'verified' },
            { id: 'vegetarian', dimension: 'dietary', state: 'verified' },
        ]));
    });

    it('treats missing safety metadata as unknown, never as a match', () => {
        const result = verifyMenuItemAgainstQuery({}, {
            tags: [],
            dietarys: ['gluten_free'],
        });

        expect(result.passes).toBe(false);
        expect(result.feedback).toContainEqual({
            id: 'gluten_free',
            dimension: 'dietary',
            state: 'unknown',
        });
    });

    it('does not infer vegan from the broad is_vege flag', () => {
        const result = verifyMenuItemAgainstQuery({
            is_vege: true,
            dietary_flags: [],
        }, {
            tags: ['vege'],
            dietarys: ['vegan'],
        });

        expect(result.passes).toBe(false);
        expect(result.feedback).toContainEqual({
            id: 'vegan',
            dimension: 'dietary',
            state: 'unknown',
        });
    });

    it('accepts a vegan dessert only with explicit vegan metadata', () => {
        const result = verifyMenuItemAgainstQuery({
            name: 'Truskawki w gorzkiej czekoladzie z pistacjami',
            dietary_flags: ['vegan'],
            safety_data: { allergens: ['nuts'] },
        }, {
            tags: [],
            dietarys: ['vegan'],
        });

        expect(result.passes).toBe(true);
        expect(result.feedback[0].state).toBe('verified');
    });

    it('resolves informal size aliases only against available variants', () => {
        expect(resolveContextualVariant('pizza mid', {
            availableVariants: ['S', 'M', 'L'],
            itemFamily: 'pizza',
        })).toMatchObject({
            dimension: 'size',
            value: 'medium',
            matchedVariant: 'M',
            state: 'verified',
        });

        expect(resolveContextualVariant('pizza maks', {
            availableVariants: ['M', 'XL'],
            itemFamily: 'pizza',
        })).toMatchObject({
            dimension: 'size',
            value: 'xl',
            matchedVariant: 'XL',
            state: 'verified',
        });
    });

    it('keeps a bare alias unresolved when the menu does not confirm it', () => {
        expect(resolveContextualVariant('steki mid')).toEqual({
            dimension: 'variant',
            value: 'medium',
            state: 'unresolved',
        });
    });

    it('uses medium as doneness only when the steak contract supports it', () => {
        expect(resolveContextualVariant('stek medium', {
            itemFamily: 'steak',
            supportsDoneness: true,
        })).toEqual({
            dimension: 'doneness',
            value: 'medium',
            state: 'verified',
        });
    });
});
