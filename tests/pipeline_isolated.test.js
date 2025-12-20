
import dotenv from 'dotenv';
dotenv.config();

import { BrainPipeline } from '../api/brain/core/pipeline.js';
import { NLURouter } from '../api/brain/nlu/router.js';
import { getSession, updateSession } from '../api/brain/session/sessionStore.js';
import fs from 'fs';

// Setup environment
global.BRAIN_DEBUG = true;

// Mock handlers to avoid DB access
class MockHandler {
    constructor(domain, intent) {
        this.domain = domain;
        this.intent = intent;
    }
    async execute(ctx) {
        return {
            ok: true,
            reply: `Mock reply for ${this.domain}.${this.intent}`,
            data: { mocked: true },
            meta: { source: 'mock_handler' }
        };
    }
}

// Prepare mock map
const mockHandlers = {
    food: {
        find_nearby: new MockHandler('food', 'find_nearby'),
        show_menu: new MockHandler('food', 'show_menu'),
        create_order: new MockHandler('food', 'create_order'),
        confirm_order: new MockHandler('food', 'confirm_order'),
        // Test 2.1 requires checking if pipeline doesn't guess,
        // so we only provide what is expected to be found.
    },
    ordering: {
        // NLU might map to 'ordering' domain for some intents
        create_order: new MockHandler('ordering', 'create_order'),
        confirm_order: new MockHandler('ordering', 'confirm_order'),
        cancel_order: new MockHandler('ordering', 'cancel_order'),
    },
    system: {
        fallback: { execute: async () => ({ reply: 'Fallback', fallback: true }) }
    }
};

const nlu = new NLURouter();
const pipeline = new BrainPipeline({ nlu, handlers: mockHandlers });
const sessionId = 'test-pipeline-1';

async function runTests() {
    console.log('🧪 Starting ETAP 2 - Pipeline Orchestration Tests\n');
    let passed = 0;
    let failed = 0;
    const failureDetails = [];

    // Reset session
    updateSession(sessionId, {});

    // --- Test 2.1: Mapowanie intent -> handler ---
    console.log('🔹 Test 2.1: Mapping Intent -> Handler (Mocked)');

    const t21_cases = [
        { input: "co polecisz", intent: 'find_nearby', domain: 'food' },
        { input: "pokaż menu", intent: 'menu_request', domain: 'food', mapIntent: 'menu_request' }
    ];

    // Pipeline.js defines handlers[food][menu_request] ?
    // pipeline.js defaultHandlers uses 'show_menu'.
    // NLU Router returns 'menu_request'.
    // If keys mismatch, pipeline fails.
    // NOTE: NLU 'menu_request' -> Pipeline must have 'menu_request' OR we map it.
    // pipeline.js code doesn't map it. It relies on direct key match.
    // Standardizing keys is important!
    // NLU Router returns: find_nearby, menu_request, select_restaurant
    // Mock Handlers need to match these keys.
    // Let's update Mock Handlers to match NLU outputs in `mockHandlers`.
    mockHandlers.food.menu_request = new MockHandler('food', 'menu_request');


    for (const tc of t21_cases) {
        try {
            const res = await pipeline.process(sessionId, tc.input);

            // Check if fallback happened unnecesssary
            if (res.fallback) {
                throw new Error(`Pipeline fell back to system fallback unexpectedly.`);
            }

            // Check if correct handler was called (we can check reply text from MockHandler)
            // Mock reply: `Mock reply for ${domain}.${intent}`
            const expectedIntent = tc.mapIntent || tc.intent;
            if (!res.reply.includes(expectedIntent)) {
                throw new Error(`Handler mismatch? Got reply: "${res.reply}", expected to contain "${expectedIntent}"`);
            }

            console.log(`✅ PASS: "${tc.input}" -> ${res.intent} => Handler executed.`);
            passed++;
        } catch (e) {
            console.error(`❌ FAIL: "${tc.input}" -> ${e.message}`);
            failureDetails.push({ test: '2.1', input: tc.input, error: e.message });
            failed++;
        }
    }

    // --- Test 2.2: Stan Sesji ---
    console.log('\n🔹 Test 2.2: Session State Preservation');

    const seq = ['znajdź restaurację', 'pokaż menu', 'zamawiam burgera'];
    // We expect: find_nearby -> menu_request -> create_order
    updateSession(sessionId, {}); // Clear

    for (const text of seq) {
        const res = await pipeline.process(sessionId, text);
        const session = getSession(sessionId);

        console.log(`   Step "${text}" -> Intent: ${res.intent}`);

        if (!session.lastIntent) {
            console.error(`❌ FAIL: Session lost lastIntent after "${text}"`);
            failureDetails.push({ test: '2.2', step: text, error: 'Session lost lastIntent' });
            failed++;
        } else {
            // Check if it persists between turns (implicit in loop)
            if (session.lastIntent !== res.intent) {
                console.warn(`⚠️ Warning: Session lastIntent (${session.lastIntent}) != Result intent (${res.intent}). Could be async issue?`);
            }
        }
    }

    // Verify final state
    const finalSession = getSession(sessionId);
    if (finalSession.lastIntent === 'create_order') {
        console.log(`✅ PASS: Session flow preserved correctly.`);
        passed++;
    } else {
        console.error(`❌ FAIL: Final session state incorrect. Expected 'create_order', got '${finalSession.lastIntent}'`);
        failureDetails.push({ test: '2.2', error: 'Final state mismatch' });
        failed++;
    }


    console.log(`\nResults: ${passed} Passed, ${failed} Failed.`);
    fs.writeFileSync('pipeline_test_results.json', JSON.stringify({ passed, failed, failureDetails }, null, 2));

    if (failed > 0) process.exit(1);
}

runTests();
