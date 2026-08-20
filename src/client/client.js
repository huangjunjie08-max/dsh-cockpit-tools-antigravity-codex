import { createHash } from "node:crypto";
import { Platform } from "../types/enums.js";
import { assertSafeApiBaseUrl } from "../utils/security.js";
import { antigravityEnv, asString, isRecord } from "../utils/util.js";

export const DEFAULT_ENDPOINT = "https://cloudcode-pa.googleapis.com";
export const ENDPOINT_FALLBACKS = [
  DEFAULT_ENDPOINT,
  "https://daily-cloudcode-pa.sandbox.googleapis.com",
];

const projectCache = new Map();
const modelCache = new Map();
const inFlightModelLookups = new Map();

const PROJECT_CACHE_TTL_MS = 30 * 60 * 1000;
const MODEL_CACHE_TTL_MS = 30 * 60 * 1000;
const DISCOVERY_TIMEOUT_MS = 8000;

function discoverySignal(parentSignal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  const abort = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) controller.abort(parentSignal.reason);
  parentSignal?.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abort);
    },
  };
}

export function stableProjectId(seed) {
  const bytes = createHash("sha1").update(`antigravity:${seed}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function defaultProjectId(seed = "antigravity-default") {
  return antigravityEnv("PROJECT_ID")?.trim() || stableProjectId(seed);
}

export function endpointCandidates() {
  const explicit = antigravityEnv("BASE_URL")?.trim();
  return explicit ? [assertSafeApiBaseUrl(explicit)] : ENDPOINT_FALLBACKS;
}

function defaultUserAgent() {
  const os =
    process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux";
  const arch = process.arch === "x64" ? "amd64" : process.arch;
  return `antigravity/1.15.8 ${os}/${arch}`;
}

export function antigravityHeaders(token) {
  const platform =
    process.platform === "darwin"
      ? Platform.Macos
      : process.platform === "win32"
        ? Platform.Windows
        : Platform.Linux;
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "User-Agent": antigravityEnv("USER_AGENT") || defaultUserAgent(),
    "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    "Client-Metadata": JSON.stringify({
      ideType: "ANTIGRAVITY",
      platform,
      pluginType: "GEMINI",
    }),
  };
}

export function jsonOrTextError(text) {
  try {
    const parsed = JSON.parse(text);
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // not JSON
  }
  return text;
}

export function extractProjectId(data) {
  if (!isRecord(data)) return undefined;
  const direct =
    data.antigravityProjectId ??
    data.projectId ??
    data.cloudaicompanionProjectId ??
    data.project;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  return undefined;
}

export async function loadCodeAssist(token, parentSignal) {
  const cached = projectCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.projectId;

  const endpoints = endpointCandidates();
  for (const endpoint of endpoints) {
    try {
      const request = discoverySignal(parentSignal);
      const res = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
        method: "POST",
        headers: antigravityHeaders(token),
        body: JSON.stringify({
          metadata: {
            ideType: "ANTIGRAVITY",
            platform: process.platform === "win32" ? "windows" : "linux",
            pluginType: "GEMINI",
          },
        }),
        signal: request.signal,
      }).finally(request.cleanup);

      if (!res.ok) continue;
      const data = await res.json();
      const discovered = extractProjectId(data);
      if (discovered) {
        projectCache.set(token, {
          projectId: discovered,
          expiresAt: Date.now() + PROJECT_CACHE_TTL_MS,
        });
        return discovered;
      }
    } catch {
      // try next endpoint
    }
  }

  return undefined;
}

export function resolveProjectId({ token, warmedProject, credentialProjectId, seed = "antigravity-default" }) {
  if (credentialProjectId && credentialProjectId.trim()) {
    return credentialProjectId.trim();
  }
  if (warmedProject && warmedProject.trim()) {
    return warmedProject.trim();
  }
  const cached = token ? projectCache.get(token) : undefined;
  if (cached && cached.expiresAt > Date.now() && cached.projectId) {
    return cached.projectId;
  }
  return defaultProjectId(seed);
}

export async function fetchAvailableRuntimeModel(token, projectId, baseModel, parentSignal) {
  const cacheKey = `${token}:${projectId}:${baseModel}`;
  const cached = modelCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  if (inFlightModelLookups.has(cacheKey)) {
    return inFlightModelLookups.get(cacheKey);
  }

  const lookupPromise = (async () => {
    try {
      const endpoints = endpointCandidates();
      for (const endpoint of endpoints) {
        try {
          const request = discoverySignal(parentSignal);
          const res = await fetch(`${endpoint}/v1internal:fetchAvailableModels`, {
            method: "POST",
            headers: antigravityHeaders(token),
            body: JSON.stringify({ project: projectId }),
            signal: request.signal,
          }).finally(request.cleanup);

          if (!res.ok) continue;
          const data = await res.json();
          if (data && isRecord(data.models)) {
            const models = data.models;
            if (models[baseModel]) {
              const info = { id: baseModel, ...models[baseModel] };
              modelCache.set(cacheKey, { result: info, expiresAt: Date.now() + MODEL_CACHE_TTL_MS });
              return info;
            }
          }
        } catch {
          // ignore
        }
      }
    } finally {
      inFlightModelLookups.delete(cacheKey);
    }
    return undefined;
  })();

  inFlightModelLookups.set(cacheKey, lookupPromise);
  return lookupPromise;
}
