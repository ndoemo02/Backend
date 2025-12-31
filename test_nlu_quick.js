import { NLURouter } from './api/brain/nlu/router.js';

const testCases = [
    { input: 'szukam fast food', expected: 'find_nearby' },
    { input: 'chcę coś zjeść', expected: 'find_nearby' },
    { input: 'pokaż menu', expected: 'menu_request' },
    { input: 'testy king', expected: 'find_nearby' },
    { input: 'casting kebab', expected: 'find_nearby' },
    { input: 'kfc chyba', expected: 'find_nearby' },
    { input: 'ten burger koło mnie', expected: 'find_nearby' },
    { input: 'chcę zamówić ale najpierw pokaż menu', expected: 'menu_request' }
];

import fs from 'fs';

const nlu = new NLURouter();

async function run() {
    const results = [];
    for (const tc of testCases) {
        const r = await nlu.detect({ text: tc.input, session: { id: 'test' } });
        const pass = r.intent === tc.expected;
        results.push({ input: tc.input, expected: tc.expected, actual: r.intent, source: r.source, pass });
    }

    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass).length;

    const output = {
        summary: `${passed} PASS, ${failed} FAIL`,
        results: results.map(r => `${r.pass ? 'PASS' : 'FAIL'}: "${r.input}" -> ${r.actual} (expected: ${r.expected})`)
    };

    fs.writeFileSync('nlu_quick_results.json', JSON.stringify(output, null, 2));
    console.log('Results written to nlu_quick_results.json');
    console.log(output.summary);
    output.results.forEach(r => console.log(r));
}

run().catch(console.error);
