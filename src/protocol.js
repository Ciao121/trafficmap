export const ALLOWED_ACTIVITY_WINDOWS = new Set([5, 10, 30, 60]);
export const DEFAULT_ACTIVITY_WINDOW = 5;
export const DEFAULT_MONITORED_PORT = 443;

export function validateActivityWindow(value) {
  const seconds = Number(value);
  return ALLOWED_ACTIVITY_WINDOWS.has(seconds)
    ? seconds
    : DEFAULT_ACTIVITY_WINDOW;
}

export function validatePort(value, fallback = DEFAULT_MONITORED_PORT) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535
    ? port
    : fallback;
}

export function normalizeTimestamp(value) {
  if (value === null || value === undefined || value === '') return 0;
  const numericValue = Number(value);
  if (Number.isFinite(numericValue)) {
    return numericValue < 10_000_000_000 ? numericValue * 1000 : numericValue;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sendJson(socket, payload, openState = 1, onError = console.error) {
  if (socket.readyState !== openState) return false;
  try {
    socket.send(JSON.stringify(payload));
    return true;
  } catch (error) {
    onError(`[websocket] send failed: ${error.message}`);
    return false;
  }
}

export function shouldRecordIp(ip, privacy, isPrivateOrReserved) {
  if (!ip) return false;
  const excluded = new Set((privacy.excludedIps || []).map((value) => String(value).trim().toLowerCase()));
  if (excluded.has(ip)) return false;
  return !(privacy.excludePrivateIps && isPrivateOrReserved(ip));
}
