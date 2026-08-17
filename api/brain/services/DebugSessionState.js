let debugSessionState = {
  intent: 'none',
  restaurant: null,
  sessionId: null,
  confidence: 0,
  lastUpdate: new Date().toISOString()
};

export function updateDebugSession(newState) {
  debugSessionState = {
    ...debugSessionState,
    ...newState,
    lastUpdate: new Date().toISOString()
  };
}
