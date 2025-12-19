// api/debug.js
import express from 'express';
import supabase from './brain/supabaseClient.js';
const router = express.Router();

// Global session state for debugging
let debugSessionState = {
  intent: "none",
  restaurant: null,
  sessionId: null,
  confidence: 0.0,
  lastUpdate: new Date().toISOString()
};

router.get('/debug/menu', async (req, res) => {
  const rid = req.query.restaurant_id || null;
  let q = supabase.from('menu_items').select('id,name,restaurant_id').limit(200);
  if (rid) q = q.eq('restaurant_id', rid);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error });
  res.json({ count: data?.length || 0, sample: data?.slice(0, 15) });
});

// GET /api/debug/session - Returns current Amber session state
router.get('/debug/session', async (req, res) => {
  try {
    // Update timestamp
    debugSessionState.lastUpdate = new Date().toISOString();
    
    res.json({
      ...debugSessionState,
      timestamp: debugSessionState.lastUpdate,
      status: "ok"
    });
  } catch (error) {
    console.error("Debug session error:", error);
    res.status(500).json({ 
      error: "Failed to get session state",
      intent: "error",
      restaurant: null,
      sessionId: null,
      confidence: 0.0
    });
  }
});

// POST /api/debug/log - Logs current session snapshot to database
router.post('/debug/log', async (req, res) => {
  try {
    const logData = {
      session_id: req.body.sessionId || debugSessionState.sessionId || `debug-${Date.now()}`,
      intent: req.body.intent || debugSessionState.intent,
      restaurant: req.body.restaurant || debugSessionState.restaurant,
      confidence: req.body.confidence || debugSessionState.confidence,
      timestamp: req.body.timestamp || new Date().toISOString(),
      payload: JSON.stringify(req.body),
      user_agent: req.body.userAgent || req.headers['user-agent'] || 'unknown'
    };

    // Try to insert into debug_logs table
    const { data, error } = await supabase
      .from('debug_logs')
      .insert([logData])
      .select();

    if (error) {
      console.warn("Failed to save debug log to DB:", error);
      // Still return success, just log to console
    }

    console.log("📋 Debug log saved:", {
      sessionId: logData.session_id,
      intent: logData.intent,
      timestamp: logData.timestamp
    });

    res.json({ 
      success: true, 
      logged: logData,
      message: "Session snapshot logged successfully"
    });
  } catch (error) {
    console.error("Debug log error:", error);
    res.status(500).json({ 
      error: "Failed to log session",
      message: error.message
    });
  }
});

// POST /api/tts-mode - Updates TTS engine preference
router.post('/tts-mode', async (req, res) => {
  try {
    const { engine } = req.body;
    
    if (!engine || !['classic', 'chirp'].includes(engine)) {
      return res.status(400).json({ 
        error: "Invalid engine. Must be 'classic' or 'chirp'" 
      });
    }

    console.log(`🎧 TTS mode switched to: ${engine}`);
    
    res.json({ 
      success: true, 
      engine,
      message: `TTS engine set to ${engine}`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("TTS mode error:", error);
    res.status(500).json({ 
      error: "Failed to update TTS mode",
      message: error.message
    });
  }
});

// Function to update debug session state (can be called from other modules)
export function updateDebugSession(newState) {
  debugSessionState = {
    ...debugSessionState,
    ...newState,
    lastUpdate: new Date().toISOString()
  };
  console.log("🔍 Debug session updated:", newState);
}

export default router;
