import { describe, expect, it } from 'vitest';
import {
    buildDemoSessionPatch,
    DEFAULT_DEMO_SCENARIO_ID,
    resolveDemoContext,
    resolveDemoContextFromRequest,
} from '../../api/demo/demoContext.js';

describe('demo context contract', () => {
    it('keeps Piekary as the backward-compatible default', () => {
        expect(DEFAULT_DEMO_SCENARIO_ID).toBe('piekary-local');
        expect(resolveDemoContext()).toEqual({
            scenarioId: 'piekary-local',
            preferredLocale: 'pl',
            source: 'default',
            city: 'Piekary Śląskie',
            audience: 'local',
            datasetId: 'piekary-v1',
            isDemoExperience: true,
        });
    });

    it('resolves Krakow as an isolated tourist scenario', () => {
        expect(resolveDemoContext({
            scenarioId: 'krakow-tourist',
            source: 'launch',
        })).toMatchObject({
            scenarioId: 'krakow-tourist',
            city: 'Kraków',
            audience: 'tourist',
            datasetId: 'krakow-v1',
            preferredLocale: 'pl',
        });
    });

    it('allows English without coupling language to the tourist scenario', () => {
        expect(resolveDemoContext({
            scenarioId: 'piekary-local',
            preferredLocale: 'en',
        }).preferredLocale).toBe('en');
    });

    it('rejects an explicit unknown scenario instead of falling back to another city', () => {
        expect(() => resolveDemoContext({
            scenarioId: 'warsaw-tourist',
        })).toThrow('Unsupported demo scenario');
    });

    it('rejects unsupported locale and source values', () => {
        expect(() => resolveDemoContext({ preferredLocale: 'de' }))
            .toThrow('Unsupported demo locale');
        expect(() => resolveDemoContext({ source: 'model-inference' }))
            .toThrow('Unsupported demo context source');
    });

    it('accepts the public snake_case frontend payload', () => {
        const context = resolveDemoContextFromRequest({
            demo_context: {
                scenario_id: 'krakow-tourist',
                preferred_locale: 'en',
                source: 'query',
            },
        });

        expect(context).toMatchObject({
            scenarioId: 'krakow-tourist',
            preferredLocale: 'en',
            datasetId: 'krakow-v1',
        });
        expect(buildDemoSessionPatch(context)).toMatchObject({
            demoScenarioId: 'krakow-tourist',
            demoDatasetId: 'krakow-v1',
            preferredLocale: 'en',
        });
    });

    it('reads context nested in classic request metadata', () => {
        expect(resolveDemoContextFromRequest({
            meta: {
                demo_context: {
                    scenario_id: 'piekary-local',
                    preferred_locale: 'pl',
                    source: 'default',
                },
            },
        }).city).toBe('Piekary Śląskie');
    });
});
