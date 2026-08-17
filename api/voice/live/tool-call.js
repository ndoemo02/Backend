// Serverless handler for Vercel — POST /api/voice/live/tool-call
// Mirror of the Express route in index.js :: registerLiveRoutes()

import { applyCORS } from '../../_cors.js';
import { ToolRouter } from './ToolRouter.js';
import { validateLiveInternalKey, validateLiveOrigin } from './liveSecurity.js';
import { buildInitialTurnTrace } from './liveTurnLedger.js';
import { validateSessionId } from '../../brain/session/sessionIdContract.js';

function isLiveModeEnabled() {
  return String(process.env.LIVE_MODE || '').toLowerCase() === 'true';
}

const toolRouter = new ToolRouter();

export default async function handler(req, res) {
  if (applyCORS(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = req.body || {};
  const sessionId = body.session_id || body.sessionId;
  const toolName = body.tool || body.tool_name;
  const args = body.args || {};
  const requestId = body.request_id || null;
  const turnId = body.turn_id || requestId || null;
  const transcript = body.transcript || body.transcript_text || null;
  const userText = body.user_text || body.userText || null;
  const originCheck = validateLiveOrigin(req.headers?.origin);
  if (!originCheck.ok) {
    return res.status(403).json({
      ok: false,
      error: 'origin_not_allowed',
      reason: originCheck.reason,
    });
  }
  const internalKeyCheck = validateLiveInternalKey(req.headers || {});
  if (!internalKeyCheck.ok) {
    return res.status(403).json({
      ok: false,
      error: 'forbidden',
      reason: internalKeyCheck.reason,
    });
  }

  if (!isLiveModeEnabled()) {
    return res.status(409).json({
      ok: false,
      error: 'live_mode_disabled',
      fallback: '/api/brain/v2',
      message: 'LIVE_MODE=false. Use classic /api/brain/v2 pipeline.',
    });
  }

  const sessionIdVerdict = validateSessionId(sessionId);
  if (!sessionIdVerdict.ok || !toolName) {
    console.log(`[TOOL_CALL_HTTP] 400 missing_session_or_tool — sessionId=${JSON.stringify(sessionId)} toolName=${JSON.stringify(toolName)} bodyKeys=${Object.keys(body).join(',')}`);
    return res.status(400).json({
      ok: false,
      error: !sessionIdVerdict.ok ? sessionIdVerdict.error : 'missing_tool',
      detail: { sessionId: !!sessionId, toolName: !!toolName },
    });
  }

  const normalizedSessionId = sessionIdVerdict.sessionId;

  try {
    console.log(`[InteractionBridge] toolcall_received turn_id=${turnId || '?'} session_id=${normalizedSessionId} tool=${toolName} source=http`);
    const t0 = Date.now();
    const turnTrace = buildInitialTurnTrace({
      sessionId: normalizedSessionId,
      turnId,
      requestId,
      toolName: String(toolName),
      rawArgs: args,
      rawTranscript: body.raw_transcript || body.transcript_raw || null,
      finalTranscript: transcript || userText || null,
      source: 'live_tool_http',
    });
    const result = await toolRouter.executeToolCall({
      sessionId: normalizedSessionId,
      toolName: String(toolName),
      args,
      requestId,
      turnId,
      debugLiveFlow: {
        turnTrace,
        rawArgs: args,
        finalTranscript: transcript || userText || null,
        userText,
        sttSource: transcript ? 'transcript' : (userText ? 'user_text' : null),
      },
    });

    result.backend_ms = result.backend_ms || (Date.now() - t0);

    const status = result.ok ? 200 : 400;
    return res.status(status).json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'live_tool_router_error',
      message: error?.message || 'unknown_error',
    });
  }
}
