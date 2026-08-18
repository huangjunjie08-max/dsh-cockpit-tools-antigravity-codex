export function redactSecrets(text) {
  if (typeof text !== "string") return String(text ?? "");
  return text
    .replace(/(ya29\.[a-zA-Z0-9_-]{20,})/g, "[REDACTED_ACCESS_TOKEN]")
    .replace(/(1\/\/[a-zA-Z0-9_-]{20,})/g, "[REDACTED_REFRESH_TOKEN]")
    .replace(/("access_token"\s*:\s*")[^"]+(")/gi, '$1[REDACTED]$2')
    .replace(/("refresh_token"\s*:\s*")[^"]+(")/gi, '$1[REDACTED]$2')
    .replace(/(Bearer\s+)[a-zA-Z0-9._-]+/gi, "$1[REDACTED]");
}

export function safeError(error) {
  if (error instanceof Error) {
    return redactSecrets(error.message);
  }
  return redactSecrets(String(error));
}

export function resolveCallbackHost() {
  const envHost = process.env.ANTIGRAVITY_CALLBACK_HOST?.trim();
  if (envHost) return envHost;
  return "127.0.0.1";
}

export function assertSafeApiBaseUrl(url) {
  try {
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol)) {
      throw new Error(`Invalid protocol ${parsed.protocol}`);
    }
    return parsed.origin;
  } catch (err) {
    throw new Error(`Invalid Antigravity base URL: ${safeError(err)}`);
  }
}
