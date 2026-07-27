import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';

import {
    buildChips,
    matchQueryToTaxonomy,
    runDiscovery,
} from '../discovery/queryUnderstanding.js';
import {
    matchQueryToTaxonomy as matchQueryToTaxonomySource,
} from '../discovery/queryUnderstanding.ts';
import {
    buildDiscoveryRawText,
    resolveDiscoverySource,
} from '../discovery/queryContext.js';

describe('food discovery taxonomy contract', () => {
    it('parses a structured cuisine, category and delivery request deterministically', () => {
        const parsed = matchQueryToTaxonomy('ostre sushi z dostawą');

        expect(parsed).toMatchObject({
            topGroups: ['asian'],
            categories: ['sushi'],
            tags: ['spicy', 'delivery'],
            confidence: 'deterministic',
            rawText: 'ostre sushi z dostawą',
        });
    });

    it('keeps vegetarian intent separate from the broad vege tag', () => {
        const parsed = matchQueryToTaxonomy('desery wege');

        expect(parsed.topGroups).toEqual(['desserts_cafe']);
        expect(parsed.tags).toContain('vege');
        expect(parsed.dietarys).toContain('vegetarian');
        expect(parsed.confidence).toBe('deterministic');
    });

    it('signals the language fallback without fabricating results', () => {
        const parsed = matchQueryToTaxonomy('coś lekkiego na kolację');
        const result = runDiscovery(parsed, [
            { id: 'r-1', name: 'Restauracja testowa' },
        ]);

        expect(parsed.confidence).toBe('empty');
        expect(result).toMatchObject({
            items: [],
            fallback: 'llm',
            totalBeforeFilter: 1,
            totalAfterFilter: 0,
        });
    });

    it('builds display chips for recognized dimensions and omits open_now', () => {
        const parsed = matchQueryToTaxonomy('ostre sushi z dostawą otwarte teraz');
        const chips = buildChips(parsed);

        expect(chips).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'asian', dimension: 'topGroup' }),
            expect.objectContaining({ id: 'sushi', dimension: 'category' }),
            expect.objectContaining({ id: 'spicy', dimension: 'tag' }),
            expect.objectContaining({ id: 'delivery', dimension: 'tag' }),
        ]));
        expect(chips.some((chip) => chip.id === 'open_now')).toBe(false);
    });

    it('keeps the deterministic parser below the 10 ms p95 contract', () => {
        const samples = [];
        const queries = [
            'ostre sushi z dostawą',
            'desery wege',
            'rodzinny obiad bez glutenu',
            'coś lekkiego na kolację',
        ];

        for (let sample = 0; sample < 200; sample += 1) {
            const start = performance.now();
            for (let iteration = 0; iteration < 25; iteration += 1) {
                matchQueryToTaxonomy(queries[iteration % queries.length]);
            }
            samples.push((performance.now() - start) / 25);
        }

        samples.sort((a, b) => a - b);
        const p95 = samples[Math.floor(samples.length * 0.95)];
        expect(p95).toBeLessThan(10);
    });

    it('maps nearby language to proximity and distance sorting', () => {
        const parsed = matchQueryToTaxonomy('desery wege blisko');

        expect(parsed).toMatchObject({
            proximity: 'near',
            sort: 'distance',
            priceBand: null,
            source: 'text',
            confidence: 'deterministic',
        });
    });

    it('requires an explicit price phrase and leaves informal mid unresolved', () => {
        const parsed = matchQueryToTaxonomy('steki w średniej półce');
        const informal = matchQueryToTaxonomy('steki mid');
        const unrelated = matchQueryToTaxonomy('sushi midori');

        expect(parsed.priceBand).toBe('mid');
        expect(parsed.categories).toContain('steak');
        expect(informal.priceBand).toBeNull();
        expect(informal.unresolved).toContain('variant:mid');
        expect(unrelated.priceBand).toBeNull();
        expect(unrelated.unresolved).toEqual([]);
    });

    it('recognizes price and rating sort requests', () => {
        expect(matchQueryToTaxonomy('najtańsze burgery').sort).toBe('price');
        expect(matchQueryToTaxonomy('najlepiej oceniane sushi').sort).toBe('rating');
    });

    it('preserves the full query when a cuisine entity is also present', () => {
        const rawText = buildDiscoveryRawText({
            text: 'ostre sushi blisko z dostawą',
            entities: { cuisine: 'Sushi' },
        }, 'Sushi');

        expect(rawText).toBe('ostre sushi blisko z dostawą');
        const parsed = matchQueryToTaxonomy(rawText);
        expect(parsed).toMatchObject({
            categories: ['sushi'],
            proximity: 'near',
            sort: 'distance',
        });
        expect(parsed.tags).toEqual(expect.arrayContaining(['spicy', 'delivery']));
    });

    it('marks Live and text sources without changing parsing semantics', () => {
        const liveContext = {
            source: 'live_tool:find_nearby',
            body: { meta: { channel: 'live_tools' } },
        };

        expect(resolveDiscoverySource(liveContext)).toBe('live');
        expect(resolveDiscoverySource({ source: 'brain' })).toBe('text');
        expect(matchQueryToTaxonomy('sushi', 'live').source).toBe('live');
    });

    it('keeps the TypeScript source and runtime JavaScript artifact in sync', () => {
        const query = 'steki mid blisko';

        expect(matchQueryToTaxonomy(query, 'live')).toEqual(
            matchQueryToTaxonomySource(query, 'live')
        );
    });
});
