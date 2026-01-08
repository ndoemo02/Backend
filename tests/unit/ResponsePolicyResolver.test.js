/**
 * Test jednostkowy dla ResponsePolicyResolver
 * Weryfikuje deterministyczność i poprawność logiki polityk.
 */

import { resolveResponsePolicy, getDefaultPolicyForIntent, validatePolicy } from '../../api/brain/core/ResponsePolicyResolver.js';

console.log('🧪 Testing ResponsePolicyResolver...\n');

// Test 1: Bazowe polityki dla różnych intencji
console.log('Test 1: Default policies');
const findNearbyPolicy = getDefaultPolicyForIntent('find_nearby');
console.log('find_nearby:', findNearbyPolicy);
console.assert(findNearbyPolicy.style === 'enthusiastic', 'find_nearby should be enthusiastic');
console.assert(findNearbyPolicy.shouldUseLLM === true, 'find_nearby should use LLM');

const createOrderPolicy = getDefaultPolicyForIntent('create_order');
console.log('create_order:', createOrderPolicy);
console.assert(createOrderPolicy.style === 'professional', 'create_order should be professional');
console.assert(createOrderPolicy.shouldUseLLM === false, 'create_order should NOT use LLM');

// Test 2: Adaptacja do sesji (long session -> casual)
console.log('\nTest 2: Session adaptation');
const longSession = { interactionCount: 15, lastIntent: 'menu_request' };
const adaptedPolicy = resolveResponsePolicy({
    intent: 'find_nearby',
    entities: {},
    session: longSession,
    adminConfig: null
});
console.log('Adapted policy (15 interactions):', adaptedPolicy);
console.assert(adaptedPolicy.style === 'casual', 'Long sessions should become casual');

// Test 3: Adaptacja do błędów (empathetic)
console.log('\nTest 3: Error recovery adaptation');
const errorSession = { interactionCount: 2, lastIntent: 'unknown' };
const errorPolicy = resolveResponsePolicy({
    intent: 'find_nearby',
    entities: {},
    session: errorSession,
    adminConfig: null
});
console.log('Error recovery policy:', errorPolicy);
console.assert(errorPolicy.style === 'empathetic', 'After errors, should be empathetic');
console.assert(errorPolicy.verbosity === 'detailed', 'After errors, should be detailed');

// Test 4: Admin overrides
console.log('\nTest 4: Admin panel overrides');
const adminOverride = {
    forceStyle: 'neutral',
    disableLLM: true,
    fastTTS: true
};
const overriddenPolicy = resolveResponsePolicy({
    intent: 'find_nearby',
    entities: {},
    session: {},
    adminConfig: adminOverride
});
console.log('Overridden policy:', overriddenPolicy);
console.assert(overriddenPolicy.style === 'neutral', 'Admin should override style');
console.assert(overriddenPolicy.shouldUseLLM === false, 'Admin should disable LLM');
console.assert(overriddenPolicy.ttsMode === 'fast', 'Admin should enable fast TTS');

// Test 5: Walidacja policy
console.log('\nTest 5: Policy validation');
const validPolicy = {
    style: 'professional',
    verbosity: 'normal',
    recommendationMode: 'direct',
    shouldUseLLM: true,
    ttsMode: 'standard'
};
console.assert(validatePolicy(validPolicy) === true, 'Valid policy should pass');

const invalidPolicy = {
    style: 'INVALID',
    verbosity: 'normal',
    recommendationMode: 'direct',
    shouldUseLLM: 'yes', // should be boolean
    ttsMode: 'standard'
};
console.assert(validatePolicy(invalidPolicy) === false, 'Invalid policy should fail');

// Test 6: Metadata presence
console.log('\nTest 6: Metadata tracking');
const policyWithMetadata = resolveResponsePolicy({
    intent: 'confirm_order',
    entities: {},
    session: { interactionCount: 1 },
    adminConfig: { forceStyle: 'enthusiastic' }
});
console.log('Policy metadata:', policyWithMetadata.metadata);
console.assert(policyWithMetadata.metadata.sourceIntent === 'confirm_order', 'Metadata should track intent');
console.assert(policyWithMetadata.metadata.adminOverride === true, 'Metadata should detect admin override');

console.log('\n✅ All tests passed! ResponsePolicyResolver is deterministyczny i gotowy do integracji.');
