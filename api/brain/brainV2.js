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

        // ETAP 4 Contract: { session_id, input, meta }
        const { session_id, input, meta = {} } = body;

        const text = input || body.text;
        const sessionId = session_id || body.sessionId || 'default';

        if (!text && !body.text) {
            return res.status(400).json({ ok: false, error: 'missing_input' });
        }

        console.log(`[BrainV2] Request: ${sessionId} -> "${text}" (Channel: ${meta.channel || 'unknown'})`);

        // Options from request, will be guarded by EXPERT_MODE in pipeline
        const options = {
            includeTTS: body.includeTTS || false,
            stylize: body.stylize || false,
            ttsOptions: body.ttsOptions || {}
        };

        const result = await pipeline.process(sessionId, text, options);

        // ETAP 4 Response contract: result already contains session_id, reply, should_reply, actions
        return res.status(200).json(result);

    } catch (error) {
        console.error('[BrainV2] Generic Error:', error);
        return res.status(500).json({ ok: false, error: 'internal_server_error' });
    }
}
