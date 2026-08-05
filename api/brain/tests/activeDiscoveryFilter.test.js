import { describe, expect, it } from 'vitest';

import {
    applyActiveDiscoveryFilterToMenu,
    buildActiveDiscoveryFilter,
    resolveDiscoveryQueryForSession,
    shouldRoutePendingDiscoveryClarification,
} from '../discovery/activeDiscoveryFilter.js';
import { matchQueryToTaxonomy } from '../discovery/queryUnderstanding.js';

describe('active discovery filter', () => {
    it('merges a concise clarification answer with the original query', () => {
        const session = {
            awaiting: 'discovery_preference',
            pendingDiscoveryClarification: {
                rawText: 'szybko fit',
                source: 'text',
                clarification: { blocking: true },
            },
        };

        expect(shouldRoutePendingDiscoveryClarification(session, 'lekkie')).toBe(true);

        const resolved = resolveDiscoveryQueryForSession(session, 'lekkie', 'text');
        expect(resolved.resolvedPending).toBe(true);
        expect(resolved.parsed.tags).toContain('quick');
        expect(resolved.parsed.preferences).toContain('light');
        expect(resolved.parsed.clarification).toBeNull();
    });

    it('keeps asking instead of guessing when the clarification answer is unknown', () => {
        const session = {
            awaiting: 'discovery_preference',
            pendingDiscoveryClarification: {
                rawText: 'szybko fit',
                source: 'live',
                clarification: { blocking: true },
            },
        };

        const resolved = resolveDiscoveryQueryForSession(session, 'cos dobrego', 'live');
        expect(resolved.resolvedPending).toBe(false);
        expect(resolved.parsed.clarification?.blocking).toBe(true);
    });

    it('stable-partitions explicit matches without hiding the full menu', () => {
        const parsed = matchQueryToTaxonomy('szybko fit lekkie');
        const filter = buildActiveDiscoveryFilter(parsed, { queryId: 'q1' });
        const menu = [
            { id: 'other', name: 'Zwykle danie', item_tags: [] },
            { id: 'match', name: 'Lekki lunch', item_tags: ['quick', 'light'] },
            { id: 'quick-only', name: 'Szybka przekaska', item_tags: ['quick'] },
        ];

        const result = applyActiveDiscoveryFilterToMenu(menu, filter);
        expect(result.matchedMenuItemIds).toEqual(['match']);
        expect(result.menu.map(item => item.id)).toEqual(['match', 'other', 'quick-only']);
        expect(result.menu).toHaveLength(menu.length);
    });
});
