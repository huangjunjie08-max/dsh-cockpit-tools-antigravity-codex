import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getValidCodexCredentials } from "../auth/cockpit-codex.js";
import { resolveFixedEffort } from "../utils/reasoning.js";

export const CODEX_PROVIDER_ID = "openai-codex";
export const CODEX_PROVIDER_NAME = "OpenAI Codex";

export const CODEX_MODELS = [
  {
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol (Codex)",
    contextWindow: 272000,
    maxTokens: 64000,
    reasoning: {
      efforts: [
        { id: "none", name: "None", description: "No reasoning" },
        { id: "low", name: "Low", description: "Faster, concise reasoning" },
        { id: "medium", name: "Medium", description: "Balanced reasoning effort" },
        { id: "high", name: "High", description: "Comprehensive reasoning" },
        { id: "xhigh", name: "X-High", description: "Extra-deep reasoning" },
        { id: "max", name: "Max", description: "Maximum reasoning" },
      ],
      defaultEffort: "medium",
    },
  },
  {
    id: "gpt-5.6-terra",
    name: "GPT-5.6 Terra (Codex)",
    contextWindow: 272000,
    maxTokens: 64000,
    reasoning: {
      efforts: [
        { id: "none", name: "None", description: "No reasoning" },
        { id: "low", name: "Low", description: "Faster, concise reasoning" },
        { id: "medium", name: "Medium", description: "Balanced reasoning" },
        { id: "high", name: "High", description: "Deep reasoning" },
        { id: "xhigh", name: "X-High", description: "Maximum reasoning capacity" },
        { id: "max", name: "Max", description: "Maximum reasoning" },
      ],
      defaultEffort: "medium",
    },
  },
  {
    id: "gpt-5.6-luna",
    name: "GPT-5.6 Luna (Codex)",
    contextWindow: 272000,
    maxTokens: 32768,
    reasoning: {
      efforts: [
        { id: "none", name: "None", description: "No reasoning" },
        { id: "low", name: "Low", description: "Lightweight, fast reasoning" },
        { id: "medium", name: "Medium", description: "Balanced reasoning" },
        { id: "high", name: "High", description: "Deep reasoning" },
        { id: "xhigh", name: "X-High", description: "Extra-deep reasoning" },
        { id: "max", name: "Max", description: "Maximum reasoning" },
      ],
      defaultEffort: "medium",
    },
  },
  {
    id: "o3-mini",
    name: "o3-mini (Codex)",
    contextWindow: 200000,
    maxTokens: 65536,
    reasoning: {
      efforts: [
        { id: "low", name: "Low", description: "Fast reasoning" },
        { id: "medium", name: "Medium", description: "Balanced reasoning" },
        { id: "high", name: "High", description: "Deep reasoning" },
      ],
      defaultEffort: "medium",
    },
  },
  {
    id: "o1",
    name: "o1 (Codex)",
    contextWindow: 200000,
    maxTokens: 65536,
    reasoning: {
      efforts: [
        { id: "low", name: "Low", description: "Fast reasoning" },
        { id: "medium", name: "Medium", description: "Balanced reasoning" },
        { id: "high", name: "High", description: "Deep reasoning" },
      ],
      defaultEffort: "medium",
    },
  },
  {
    id: "gpt-4o",
    name: "GPT-4o (Codex)",
    contextWindow: 128000,
    maxTokens: 16384,
    reasoning: undefined,
  },
];

export function resolveCodexModelId(modelId) {
  if (modelId === "gpt-5.6") return "gpt-5.6-sol";
  return modelId;
}

const CODEX_MODELS_URL = "https://chatgpt.com/backend-api/models";
const CODEX_MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
const CODEX_EFFECTIVE_CONTEXT_PERCENT = 95;
let catalogCache = { expiresAt: 0, models: new Map(), pending: null };

function normalizeCatalogModels(data) {
  const rows = Array.isArray(data?.models) ? data.models : Array.isArray(data?.data) ? data.data : [];
  return new Map(
    rows
      .filter((row) => row && typeof row === "object")
      .map((row) => [row.slug || row.id, row])
      .filter(([id]) => typeof id === "string" && id.length > 0),
  );
}

function localCatalogPaths() {
  const paths = [];
  if (process.env.CODEX_HOME) paths.push(join(process.env.CODEX_HOME, "models_cache.json"));
  paths.push(join(homedir(), ".codex", "models_cache.json"));
  return [...new Set(paths)];
}

function readLocalCatalog() {
  for (const path of localCatalogPaths()) {
    try {
      const data = JSON.parse(readFileSync(path, "utf8"));
      const models = normalizeCatalogModels(data);
      const fetchedAt = Date.parse(data.fetched_at);
      if (models.size > 0) return { models, fetchedAt };
    } catch {
      // Try the next known Codex cache location.
    }
  }
  return undefined;
}

async function loadCodexCatalog(signal) {
  if (catalogCache.expiresAt > Date.now()) return catalogCache.models;
  if (catalogCache.pending) return catalogCache.pending;

  const local = readLocalCatalog();
  if (local && Number.isFinite(local.fetchedAt) && Date.now() - local.fetchedAt < CODEX_MODEL_CACHE_TTL_MS) {
    catalogCache = { expiresAt: Date.now() + CODEX_MODEL_CACHE_TTL_MS, models: local.models, pending: null };
    return local.models;
  }

  catalogCache.pending = (async () => {
    try {
      const credentials = await getValidCodexCredentials();
      const requestSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(4000)])
        : AbortSignal.timeout(4000);
      const response = await fetch(CODEX_MODELS_URL, {
        headers: {
          Authorization: `Bearer ${credentials.access}`,
          Accept: "application/json",
          Origin: "https://chatgpt.com",
          Referer: "https://chatgpt.com/",
          "User-Agent": "codex-cli/0.148.0",
          ...(credentials.accountId ? { "chatgpt-account-id": credentials.accountId } : {}),
        },
        signal: requestSignal,
      });
      if (!response.ok) throw new Error(`Codex model catalog returned ${response.status}`);
      const models = normalizeCatalogModels(await response.json());
      if (models.size > 0) return models;
    } catch {
      // Static metadata remains available when the account or catalog endpoint is unavailable.
    }
    return local?.models || new Map();
  })();

  try {
    catalogCache.models = await catalogCache.pending;
    catalogCache.expiresAt = Date.now() + CODEX_MODEL_CACHE_TTL_MS;
    return catalogCache.models;
  } finally {
    catalogCache.pending = null;
  }
}

export function getCodexContextWindow(modelId, metadata) {
  const fallback = CODEX_MODELS.find((model) => model.id === resolveCodexModelId(modelId));
  const raw = Number(metadata?.context_window ?? metadata?.contextWindow ?? fallback?.contextWindow);
  if (!Number.isFinite(raw) || raw <= 0) return fallback?.contextWindow;
  const percent = Number(metadata?.effective_context_window_percent);
  const effectivePercent = Number.isFinite(percent) && percent > 0 && percent <= 100
    ? percent
    : resolveCodexModelId(modelId).startsWith("gpt-5.6-")
      ? CODEX_EFFECTIVE_CONTEXT_PERCENT
      : 100;
  return Math.floor(raw * effectivePercent / 100);
}

export async function resolveCodexModelMetadata(modelId, signal) {
  const normalizedId = resolveCodexModelId(modelId);
  const catalog = await loadCodexCatalog(signal);
  const metadata = catalog.get(normalizedId) || catalog.get(modelId);
  return {
    contextWindow: getCodexContextWindow(normalizedId, metadata),
    rawContextWindow: Number(metadata?.context_window) || undefined,
  };
}
