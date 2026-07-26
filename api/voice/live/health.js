// Serverless handler for Vercel — GET /api/voice/live/health
// Mirror of the Express route in index.js :: registerLiveRoutes()

import { applyCORS } from '../../_cors.js';
import { getOpenAIRealtimeFallbackConfig } from './openai-session.js';

function isLiveModeEnabled() {
  return String(process.env.LIVE_MODE || '').toLowerCase() === 'true';
}

export default function handler(req, res) {
  if (applyCORS(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const openAI = getOpenAIRealtimeFallbackConfig();

  res.status(200).json({
    ok: true,
    live_mode: isLiveModeEnabled(),
    fallback: '/api/brain/v2',
    openai_available: openAI.available,
    openai_model: openAI.model,
    openai_voice: openAI.voice,
  });
}
