/**
 * Brain V2 - Modular Pipeline Entry Point
 * Zastępuje monolityczny brainRouter.js
 */

import { BrainPipeline } from './core/pipeline.js';
import { NLURouter } from './nlu/router.js';
// Singleton Initialization (Warm Start)
const nlu = new NLURouter();
export const pipeline = new BrainPipeline({ nlu });

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    try {
        const body = req.body || {};
        const { sessionId = 'default', text } = body;

        console.log(`[BrainV2] Request: ${sessionId} -> "${text}"`);

        const result = await pipeline.process(sessionId, text);

        return res.status(200).json(result);

    } catch (error) {
        console.error('[BrainV2] Generic Error:', error);
        return res.status(500).json({ ok: false, error: 'internal_server_error' });
    }
}
