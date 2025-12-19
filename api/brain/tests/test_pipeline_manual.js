
import handler from '../brainV2.js';

// Mock Response
const res = {
    status: (code) => ({
        json: (data) => console.log(`[${code}] Response:`, JSON.stringify(data, null, 2))
    })
};

// Test Case 1: Simple Discovery
async function runTest() {
    console.log("--- Test 1: Find Pizza in Zabrze ---");
    const req = {
        method: 'POST',
        body: {
            sessionId: 'test_user_v2',
            text: 'Znajdź pizzę w Zabrzu'
        }
    };

    await handler(req, res);
}

runTest();
