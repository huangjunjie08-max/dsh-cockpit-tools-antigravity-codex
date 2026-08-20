const EFFORT_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
const effortBySession = new Map();
let lastEffort;

function normalized(value) {
  const text = String(value || "").trim().toLowerCase();
  return text && text !== "auto" && text !== "off" ? text : "";
}

function chooseEffort(preferred, available, fallback) {
  if (available.includes(preferred)) return preferred;
  if (available.includes(fallback)) return fallback;

  const preferredIndex = EFFORT_ORDER.indexOf(preferred);
  if (preferredIndex >= 0) {
    return available
      .map((effort) => ({ effort, distance: Math.abs(EFFORT_ORDER.indexOf(effort) - preferredIndex) }))
      .sort((left, right) => left.distance - right.distance)[0]?.effort;
  }
  return available[0];
}

export function resolveFixedEffort({ modelId, requested, available, fallback = "medium", sessionId }) {
  const efforts = [...new Set((available || []).map(normalized).filter(Boolean))];
  if (efforts.length === 0) return undefined;

  const sessionKey = typeof sessionId === "string" ? sessionId.trim() : "";
  const requestedEffort = normalized(requested);
  const remembered = sessionKey ? effortBySession.get(sessionKey) : undefined;
  const preferred = requestedEffort || remembered || lastEffort || normalized(fallback) || efforts[0];
  const resolved = chooseEffort(preferred, efforts, normalized(fallback));

  if (sessionKey) effortBySession.set(sessionKey, resolved);
  lastEffort = resolved;
  return resolved;
}
