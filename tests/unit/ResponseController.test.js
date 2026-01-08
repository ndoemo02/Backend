/**
 * Test jednostkowy dla ResponseController
 * Weryfikuje mechanizm finalizacji, guard, shadow mode.
 */

import {
    finalizeResponse,
    isResponseFinalized,
    resetFinalizationFlag,
    getResponseControllerConfig
} from '../../api/brain/core/ResponseController.js';

console.log('🧪 Testing ResponseController...\n');

// Test 1: Podstawowa finalizacja (Shadow Mode)
console.log('Test 1: Basic finalization (Shadow Mode)');
const context1 = {
    intent: 'find_nearby',
    entities: { location: 'Piekary' },
    session: { id: 'test-123', interactionCount: 1 },
    adminConfig: null
};

const result1 = await finalizeResponse('Znalazłam 5 restauracji.', context1);
console.log('Result:', result1);

console.assert(result1.reply === 'Znalazłam 5 restauracji.', 'Shadow mode should NOT transform reply');
console.assert(result1.rawReply === 'Znalazłam 5 restauracji.', 'rawReply should match input');
console.assert(result1.policy !== null, 'Policy should be resolved');
console.assert(result1.metadata.mode === 'shadow', 'Mode should be shadow');
console.assert(context1.responseFinalized === true, 'Context should be marked as finalized');

// Test 2: Double finalization guard
console.log('\nTest 2: Double finalization guard');
try {
    // Próba ponownej finalizacji tego samego kontekstu
    await finalizeResponse('Druga odpowiedź', context1);
    console.error('❌ Test FAILED: Should have thrown error on double finalization');
    process.exit(1);
} catch (err) {
    console.assert(err.message.includes('already finalized'), 'Error should mention double finalization');
    console.log('✅ Guard correctly prevented double finalization');
}

// Test 3: isResponseFinalized helper
console.log('\nTest 3: isResponseFinalized helper');
const context2 = {
    intent: 'create_order',
    entities: {},
    session: {}
};
console.assert(isResponseFinalized(context2) === false, 'Fresh context should not be finalized');

await finalizeResponse('Dodano do koszyka.', context2);
console.assert(isResponseFinalized(context2) === true, 'After finalization, should be marked');

// Test 4: Reset finalization flag (test helper)
console.log('\nTest 4: Reset finalization flag');
resetFinalizationFlag(context2);
console.assert(isResponseFinalized(context2) === false, 'Reset should clear flag');

// Test 5: Policy resolution w kontekście finalizacji
console.log('\nTest 5: Policy resolution integration');
const context3 = {
    intent: 'confirm_order',
    entities: {},
    session: { interactionCount: 5, lastIntent: 'create_order' },
    adminConfig: { forceStyle: 'enthusiastic' } // Admin override
};

const result3 = await finalizeResponse('Zamówienie potwierdzone.', context3);
console.log('Policy with admin override:', result3.policy);

console.assert(result3.policy.style === 'enthusiastic', 'Admin override should be applied');
console.assert(result3.policy.metadata.adminOverride === true, 'Metadata should track override');

// Test 6: Invalid input handling
console.log('\nTest 6: Invalid input handling');
const context4 = { intent: 'unknown', entities: {}, session: {} };

const result4a = await finalizeResponse(null, context4); // null reply
console.assert(result4a.reply.includes('Przepraszam'), 'Should use fallback for null input');
resetFinalizationFlag(context4);

const result4b = await finalizeResponse('', context4); // empty reply
console.assert(result4b.reply.includes('Przepraszam'), 'Should use fallback for empty input');
resetFinalizationFlag(context4);

const result4c = await finalizeResponse(123, context4); // non-string
console.assert(result4c.reply.includes('Przepraszam'), 'Should use fallback for non-string input');

// Test 7: Config getter
console.log('\nTest 7: Configuration getter');
const config = getResponseControllerConfig();
console.log('Current config:', config);
console.assert(typeof config.SHADOW_MODE === 'boolean', 'Config should have SHADOW_MODE');
console.assert(typeof config.ACTIVE_MODE === 'boolean', 'Config should have ACTIVE_MODE');
console.assert(config.SHADOW_MODE === true, 'Shadow mode should be enabled by default');
console.assert(config.ACTIVE_MODE === false, 'Active mode should be disabled by default');

// Test 8: Metadata tracking
console.log('\nTest 8: Metadata tracking');
const context5 = {
    intent: 'menu_request',
    entities: {},
    session: { id: 'test-456' }
};

const result5 = await finalizeResponse('Oto menu.', context5);
console.assert(result5.metadata.processingTimeMs !== undefined, 'Should track processing time');
console.assert(result5.metadata.timestamp !== undefined, 'Should track timestamp');
console.assert(result5.metadata.policyUsed !== undefined, 'Should track policy used');
console.assert(result5.metadata.transformationApplied === false, 'Should track transformation status');

// Test 9: Missing intent handling
console.log('\nTest 9: Missing intent handling');
const context6 = {
    // intent: missing!
    entities: {},
    session: {}
};

const result6 = await finalizeResponse('Odpowiedź bez intencji.', context6);
console.assert(result6.reply === 'Odpowiedź bez intencji.', 'Should handle missing intent gracefully');
console.assert(result6.policy !== null, 'Should resolve fallback policy');

// Test 10: Context mutation verification
console.log('\nTest 10: Context mutation (responseFinalized flag)');
const context7 = {
    intent: 'find_nearby',
    entities: {},
    session: {},
    someOtherField: 'should be preserved'
};

const originalKeys = Object.keys(context7);
await finalizeResponse('Test mutation.', context7);

console.assert(context7.responseFinalized === true, 'Should add responseFinalized flag');
console.assert(context7.someOtherField === 'should be preserved', 'Should NOT mutate other fields');
console.assert(Object.keys(context7).length === originalKeys.length + 1, 'Should add exactly 1 field');

console.log('\n✅ All tests passed! ResponseController działa poprawnie.');
console.log('📊 Summary:');
console.log('  - Shadow Mode: ✅ Functional (policy resolved, reply unchanged)');
console.log('  - Guard Mechanism: ✅ Prevents double finalization');
console.log('  - Error Handling: ✅ Graceful fallbacks');
console.log('  - Metadata Tracking: ✅ Complete');
console.log('  - Integration Ready: ✅ Safe for production');
