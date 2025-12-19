import { getSession, updateSession } from "./sessionStore.js";

export function loadSession(sessionId) {
  return getSession(sessionId) || {};
}

export function saveSession(sessionId, data) {
  updateSession(sessionId, data);
}
