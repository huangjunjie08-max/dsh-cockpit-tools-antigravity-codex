export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function antigravityEnv(key) {
  return (
    process.env[`ANTIGRAVITY_${key}`] ||
    process.env[`PI_ANTIGRAVITY_${key}`] ||
    process.env[`DSH_ANTIGRAVITY_${key}`]
  );
}

export function nowRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function sanitizeText(text) {
  if (typeof text !== "string") return "";
  return text;
}

export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value) {
  return typeof value === "string" ? value : undefined;
}
