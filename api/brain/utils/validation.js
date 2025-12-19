export function validateInput(text) {
  if (!text || typeof text !== 'string') {
    return { valid: false, error: 'Invalid input: text must be non-empty string' };
  }

  if (text.length > 1000) {
    return { valid: false, error: 'Input too long: max 1000 characters' };
  }

  if (text.trim().length === 0) {
    return { valid: false, error: 'Input cannot be empty or whitespace only' };
  }

  // Sprawdź czy nie zawiera potencjalnie szkodliwych znaków
  if (/[<>{}[\]\\|`~]/.test(text)) {
    return { valid: false, error: 'Input contains potentially harmful characters' };
  }

  return { valid: true };
}

export function validateSession(session) {
  if (!session) {
    return { valid: false, error: 'No session provided' };
  }

  // Sprawdź czy sesja nie jest za stara (1 godzina)
  if (session.lastUpdated && Date.now() - session.lastUpdated > 3600000) {
    console.log('🕐 Session expired (older than 1 hour), clearing...');
    return { valid: false, error: 'Session expired' };
  }

  // Sprawdź czy sessionId jest prawidłowy
  if (session.sessionId && typeof session.sessionId !== 'string') {
    return { valid: false, error: 'Invalid sessionId type' };
  }

  return { valid: true, session };
}

export function validateRestaurant(restaurant) {
  if (!restaurant || typeof restaurant !== 'object') {
    return false;
  }

  if (!restaurant.id || !restaurant.name) {
    return false;
  }

  if (typeof restaurant.id !== 'string' || typeof restaurant.name !== 'string') {
    return false;
  }

  return true;
}
