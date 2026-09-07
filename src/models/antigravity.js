import { resolveFixedEffort } from "../utils/reasoning.js";

export const ANTIGRAVITY_PROVIDER_ID = "antigravity";
export const ANTIGRAVITY_PROVIDER_NAME = "Google Antigravity";

/**
 * Public selectable model IDs -> backend request model IDs by thinking effort.
 */
export const ANTIGRAVITY_ROUTING = {
  "claude-opus-4-6": {
    routing: {
      minimal: "claude-opus-4-6-thinking",
      low: "claude-opus-4-6-thinking",
      medium: "claude-opus-4-6-thinking",
      high: "claude-opus-4-6-thinking",
    },
    defaultRequestId: "claude-opus-4-6-thinking",
  },
  "claude-sonnet-4-6": {
    off: "claude-sonnet-4-6",
    routing: {
      minimal: "claude-sonnet-4-6",
      low: "claude-sonnet-4-6",
      medium: "claude-sonnet-4-6",
      high: "claude-sonnet-4-6",
      xhigh: "claude-sonnet-4-6",
    },
    defaultRequestId: "claude-sonnet-4-6",
  },
  "claude-3-7-sonnet": {
    off: "claude-sonnet-4-6",
    routing: {
      minimal: "claude-sonnet-4-6",
      low: "claude-sonnet-4-6",
      medium: "claude-sonnet-4-6",
      high: "claude-sonnet-4-6",
      xhigh: "claude-sonnet-4-6",
    },
    defaultRequestId: "claude-sonnet-4-6",
  },
  "gemini-3.1-pro": {
    off: "gemini-3.1-pro-low",
    routing: {
      minimal: "gemini-3.1-pro-low",
      low: "gemini-3.1-pro-low",
      medium: "gemini-3.1-pro-low",
      high: "gemini-pro-agent",
      xhigh: "gemini-pro-agent",
    },
    defaultRequestId: "gemini-3.1-pro-low",
  },
  "gemini-3.7-flash": {
    off: "gemini-3.7-flash-tiered",
    routing: {
      minimal: "gemini-3.7-flash-tiered",
      low: "gemini-3.7-flash-tiered",
      medium: "gemini-3.7-flash-tiered",
      high: "gemini-3.7-flash-tiered",
      xhigh: "gemini-3.7-flash-tiered",
    },
    defaultRequestId: "gemini-3.7-flash-tiered",
  },
  "gemini-3.6-flash": {
    off: "gemini-3.6-flash-low",
    routing: {
      minimal: "gemini-3.6-flash-low",
      low: "gemini-3.6-flash-low",
      medium: "gemini-3.6-flash-medium",
      high: "gemini-3.6-flash-high",
      xhigh: "gemini-3.6-flash-high",
    },
    defaultRequestId: "gemini-3.6-flash-low",
  },
  "gemini-3.5-flash": {
    off: "gemini-3.5-flash-extra-low",
    routing: {
      minimal: "gemini-3.5-flash-extra-low",
      low: "gemini-3.5-flash-low",
      medium: "gemini-3.5-flash-low",
      high: "gemini-3-flash-agent",
      xhigh: "gemini-3-flash-agent",
    },
    defaultRequestId: "gemini-3.5-flash-extra-low",
  },
  "gemini-3.1-flash-lite": {
    off: "gemini-3.1-flash-lite",
    defaultRequestId: "gemini-3.1-flash-lite",
  },
  "gpt-oss-120b": {
    off: "gpt-oss-120b-medium",
    routing: {
      minimal: "gpt-oss-120b-medium",
      low: "gpt-oss-120b-medium",
      medium: "gpt-oss-120b-medium",
      high: "gpt-oss-120b-medium",
    },
    defaultRequestId: "gpt-oss-120b-medium",
  },
};

export const RUNTIME_MAX_OUTPUT_TOKENS = {
  "gemini-3.7-flash": 65536,
  "gemini-3.7-flash-tiered": 65536,
  "gemini-3.6-flash": 65536,
  "gemini-3.6-flash-low": 65536,
  "gemini-3.6-flash-medium": 65536,
  "gemini-3.6-flash-high": 65536,
  "gemini-3.5-flash": 65536,
  "gemini-3.5-flash-extra-low": 65536,
  "gemini-3.5-flash-low": 65536,
  "gemini-3-flash-agent": 65536,
  "gemini-3.1-pro": 65535,
  "gemini-3.1-pro-low": 65535,
  "gemini-3.1-pro-high": 65535,
  "gemini-pro-agent": 65535,
  "gemini-3.1-flash-lite": 65535,
  "gemini-2.5-flash-lite": 65535,
  "claude-opus-4-6": 64000,
  "claude-opus-4-6-thinking": 64000,
  "claude-sonnet-4-6": 64000,
  "claude-3-7-sonnet": 64000,
  "gpt-oss-120b": 32768,
  "gpt-oss-120b-medium": 32768,
};

export const STATIC_ANTIGRAVITY_MODELS = [
  {
    id: "gemini-3.7-flash",
    name: "Gemini 3.7 Flash (Antigravity)",
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoning: {
      efforts: [
        { id: "low", name: "Low", description: "Minimal thinking overhead" },
        { id: "medium", name: "Medium", description: "Balanced thinking effort" },
        { id: "high", name: "High", description: "Deep reasoning effort" },
      ],
      defaultEffort: "medium",
    },
  },
  {
    id: "gemini-3.6-flash",
    name: "Gemini 3.6 Flash (Antigravity)",
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoning: {
      efforts: [
        { id: "low", name: "Low", description: "Fast concise thinking" },
        { id: "medium", name: "Medium", description: "Standard reasoning" },
        { id: "high", name: "High", description: "Deep reasoning" },
      ],
      defaultEffort: "medium",
    },
  },
  {
    id: "gemini-3.5-flash",
    name: "Gemini 3.5 Flash (Antigravity)",
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoning: {
      efforts: [
        { id: "low", name: "Low", description: "Fast concise thinking" },
        { id: "medium", name: "Medium", description: "Standard reasoning" },
        { id: "high", name: "High", description: "Deep reasoning" },
      ],
      defaultEffort: "medium",
    },
  },
  {
    id: "gemini-3.1-pro",
    name: "Gemini 3.1 Pro (Antigravity)",
    contextWindow: 1048576,
    maxTokens: 65535,
    reasoning: {
      efforts: [
        { id: "low", name: "Low", description: "Standard pro reasoning" },
        { id: "high", name: "High", description: "Pro agent deep reasoning" },
      ],
      defaultEffort: "low",
    },
  },
  {
    id: "gemini-3.1-flash-lite",
    name: "Gemini 3.1 Flash Lite (Antigravity)",
    contextWindow: 1048576,
    maxTokens: 65535,
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6 (Antigravity)",
    contextWindow: 200000,
    maxTokens: 64000,
    reasoning: {
      efforts: [
        { id: "low", name: "Low", description: "Short thinking budget" },
        { id: "medium", name: "Medium", description: "Balanced thinking" },
        { id: "high", name: "High", description: "Deep thinking" },
      ],
      defaultEffort: "high",
    },
  },
  {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6 (Antigravity)",
    contextWindow: 200000,
    maxTokens: 64000,
    reasoning: {
      efforts: [
        { id: "low", name: "Low", description: "Concise thinking" },
        { id: "medium", name: "Medium", description: "Standard thinking" },
        { id: "high", name: "High", description: "Deep thinking" },
      ],
      defaultEffort: "high",
    },
  },
  {
    id: "gpt-oss-120b",
    name: "GPT-OSS 120B (Antigravity)",
    contextWindow: 131072,
    maxTokens: 32768,
    reasoning: {
      efforts: [
        { id: "low", name: "Low", description: "Minimal thinking" },
        { id: "medium", name: "Medium", description: "Default medium reasoning" },
        { id: "high", name: "High", description: "Extended reasoning" },
      ],
      defaultEffort: "medium",
    },
  },
];

export const ANTIGRAVITY_MODELS = STATIC_ANTIGRAVITY_MODELS;

export function getAntigravityRequestModelId(model, reasoningEffort) {
  const config = ANTIGRAVITY_ROUTING[model];
  if (!config) return model;

  if (reasoningEffort === "off" || !reasoningEffort) {
    return config.off || config.defaultRequestId || model;
  }

  const resolved = resolveFixedEffort(reasoningEffort);
  if (config.routing && config.routing[resolved]) {
    return config.routing[resolved];
  }

  return config.defaultRequestId || model;
}

export function buildDynamicModelEntry(rawId, rawMeta) {
  const name = rawMeta?.displayName ? `${rawMeta.displayName} (Antigravity)` : `${rawId} (Antigravity)`;
  const contextWindow = Number(rawMeta?.maxTokens || rawMeta?.contextWindow || 1048576);
  const maxTokens = Number(rawMeta?.maxOutputTokens || rawMeta?.outputTokenLimit || 65536);
  const supportsImages = rawMeta?.supportsImages !== false;

  const supportsThinking = rawMeta?.supportsThinking === true;
  let reasoning;
  if (supportsThinking) {
    reasoning = {
      efforts: [
        { id: "low", name: "Low", description: "Fast concise thinking" },
        { id: "medium", name: "Medium", description: "Balanced thinking effort" },
        { id: "high", name: "High", description: "Deep reasoning effort" },
      ],
      defaultEffort: "medium",
    };
  }

  return {
    id: rawId,
    name,
    contextWindow,
    maxTokens,
    inputModalities: supportsImages ? ["text", "image"] : ["text"],
    ...(reasoning ? { reasoning } : {}),
  };
}
export function resolveAntigravityEffort(modelId, requested, sessionId) {
  const model = STATIC_ANTIGRAVITY_MODELS.find((m) => m.id === modelId);
  return resolveFixedEffort({
    modelId,
    requested,
    sessionId,
    available: model?.reasoning?.efforts?.map((effort) => effort.id),
    fallback: model?.reasoning?.defaultEffort || "medium",
  });
}

export function resolveAutoEffort(modelId, _messages = [], sessionId) {
  return resolveAntigravityEffort(modelId, "auto", sessionId);
}

export function getFallbackRuntimeModel(runtimeModel, effort = "off") {
  if (runtimeModel === "gemini-3.7-flash-tiered") {
    return getAntigravityRequestModelId("gemini-3.6-flash", effort);
  }
  if (runtimeModel.startsWith("gemini-3.7-flash-")) {
    return runtimeModel.replace("gemini-3.7-flash-", "gemini-3.6-flash-");
  }
  if (runtimeModel === "gemini-3.7-flash") {
    return "gemini-3.6-flash-low";
  }
  return undefined;
}

export function getMaxOutputTokens(modelId, runtimeModel) {
  if (runtimeModel && RUNTIME_MAX_OUTPUT_TOKENS[runtimeModel] !== undefined) {
    return RUNTIME_MAX_OUTPUT_TOKENS[runtimeModel];
  }
  if (RUNTIME_MAX_OUTPUT_TOKENS[modelId] !== undefined) {
    return RUNTIME_MAX_OUTPUT_TOKENS[modelId];
  }
  return 65536;
}
