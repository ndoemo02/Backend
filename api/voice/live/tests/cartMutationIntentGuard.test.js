import { describe, expect, it } from 'vitest';
import {
    isInformationalCartQuestion,
    verifyCartMutationIntent,
} from '../CartMutationIntentGuard.js';

describe('CartMutationIntentGuard', () => {
    it.each([
        'Kołocz to je tako drożdżówka?',
        'Czy kołocz to drożdżówka?',
        'Co to jest kołocz?',
        'Z czego to jest?',
        'Czy mogę zamówić kołocz?',
    ])('blocks informational question: %s', (text) => {
        const result = verifyCartMutationIntent({ text });

        expect(result.allowed).toBe(false);
        expect(result.informationalQuestion).toBe(true);
    });

    it('blocks a hallucinated cart tool when STT text has no purchase evidence', () => {
        const result = verifyCartMutationIntent({ text: 'Beijo, tá chegando.' });

        expect(result).toMatchObject({
            allowed: false,
            reason: 'cart_mutation_without_explicit_action',
        });
    });

    it.each([
        'Dodaj kołocz',
        'Poproszę kołocz',
        'Zamów mi kołocz',
        'Dodaj kołocz, to jest ten z makiem',
        '2x małą wersję',
        'dwie małe',
    ])('allows explicit purchase evidence: %s', (text) => {
        expect(verifyCartMutationIntent({ text }).allowed).toBe(true);
    });

    it('allows a short confirmation only in an expected cart context', () => {
        expect(verifyCartMutationIntent({
            text: 'ja',
            session: { expectedContext: 'confirm_add_to_cart' },
        }).allowed).toBe(true);
        expect(verifyCartMutationIntent({ text: 'ja', session: {} }).allowed).toBe(false);
    });

    it('treats conditional mutation as a question requiring another turn', () => {
        const text = 'Jeśli to drożdżówka, dodaj ją';

        expect(isInformationalCartQuestion(text)).toBe(true);
        expect(verifyCartMutationIntent({ text }).allowed).toBe(false);
    });
});
