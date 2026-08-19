import { getLastUserText } from "../utils/request.js";

export const ANTIGRAVITY_PROVIDER_ID = "antigravity";
export const ANTIGRAVITY_PROVIDER_NAME = "Google Antigravity";

/**
 * Public selectable model IDs -> backend request model IDs by thinking effort.
 *
 * Catalog mirrors Antigravity CLI (`agy models`) and Pi Coding Agent:
 * - Gemini 3.7 Flash
 * - Gemini 3.6 Flash
 * - Gemini 3.5 Flash
 * - Gemini 3.1 Pro
 * - Gemini 3.1 Flash Lite
 * - Claude Sonnet 4.6 (Thinking)
 * - Claude Opus 4.6 (Thinking)
 * - GPT-OSS 120B (Medium)
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
      high: "claude-sonnet-4-6",
    },
    defaultRequestId: "claude-sonnet-4-6",
  },
  "claude-3-7-sonnet": {
    off: "claude-sonnet-4-6",
    routing: {
      high: "claude-sonnet-4-6",
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

export const ANTIGRAVITY_MODELS = [
  {
    id: "gemini-3.7-flash",
    name: "Gemini 3.7 Flash (Antigravity)",
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoning: {
      efforts: [
        { id: "auto", name: "Auto", description: "Automatically select effort based on task complexity" },
        { id: "low", name: "Low", description: "Minimal thinking overhead" },
        { id: "medium", name: "Medium", description: "Balanced thinking effort" },
        { id: "high", name: "High", description: "Deep reasoning effort" },
      ],
      defaultEffort: "auto",
    },
  },
  {
    id: "gemini-3.6-flash",
    name: "Gemini 3.6 Flash (Antigravity)",
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoning: {
      efforts: [
        { id: "auto", name: "Auto", description: "Automatically select effort based on task complexity" },
        { id: "low", name: "Low", description: "Fast concise thinking" },
        { id: "medium", name: "Medium", description: "Standard reasoning" },
        { id: "high", name: "High", description: "Deep reasoning" },
      ],
      defaultEffort: "auto",
    },
  },
  {
    id: "gemini-3.5-flash",
    name: "Gemini 3.5 Flash (Antigravity)",
    contextWindow: 1048576,
    maxTokens: 65536,
    reasoning: {
      efforts: [
        { id: "auto", name: "Auto", description: "Automatically select effort based on task complexity" },
        { id: "low", name: "Low", description: "Fast concise thinking" },
        { id: "medium", name: "Medium", description: "Standard reasoning" },
        { id: "high", name: "High", description: "Deep reasoning" },
      ],
      defaultEffort: "auto",
    },
  },
  {
    id: "gemini-3.1-pro",
    name: "Gemini 3.1 Pro (Antigravity)",
    contextWindow: 1048576,
    maxTokens: 65535,
    reasoning: {
      efforts: [
        { id: "auto", name: "Auto", description: "Automatically select effort based on task complexity" },
        { id: "low", name: "Low", description: "Standard pro reasoning" },
        { id: "high", name: "High", description: "Pro agent deep reasoning" },
      ],
      defaultEffort: "auto",
    },
  },
  {
    id: "gemini-3.1-flash-lite",
    name: "Gemini 3.1 Flash Lite (Antigravity)",
    contextWindow: 1048576,
    maxTokens: 65535,
    reasoning: undefined, // Non-reasoning model
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6 (Antigravity Thinking)",
    contextWindow: 250000,
    maxTokens: 64000,
    reasoning: {
      efforts: [
        { id: "auto", name: "Auto", description: "Automatically select effort based on task complexity" },
        { id: "high", name: "High", description: "Full thinking mode" },
      ],
      defaultEffort: "auto",
    },
  },
  {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6 (Antigravity Thinking)",
    contextWindow: 250000,
    maxTokens: 64000,
    reasoning: {
      efforts: [
        { id: "auto", name: "Auto", description: "Automatically select effort based on task complexity" },
        { id: "high", name: "High", description: "Opus thinking mode" },
      ],
      defaultEffort: "auto",
    },
  },
  {
    id: "gpt-oss-120b",
    name: "GPT-OSS 120B (Antigravity)",
    contextWindow: 131072,
    maxTokens: 32768,
    reasoning: {
      efforts: [
        { id: "auto", name: "Auto", description: "Automatically select effort based on task complexity" },
        { id: "medium", name: "Medium", description: "Standard medium reasoning" },
      ],
      defaultEffort: "auto",
    },
  },
];

export function getAntigravityRequestModelId(modelId, effort = "off") {
  const r = ANTIGRAVITY_ROUTING[modelId];
  if (!r) return modelId;

  // "auto" is resolved upstream before reaching here; treat as "off" fallback
  if (!effort || effort === "off" || effort === "auto") {
    return r.off || r.routing?.minimal || r.routing?.low || r.defaultRequestId || modelId;
  }

  return (
    r.routing?.[effort] ||
    r.routing?.high ||
    r.routing?.low ||
    r.off ||
    r.defaultRequestId ||
    modelId
  );
}

/**
 * Resolve "auto" reasoning effort to a concrete level based on message complexity.
 * Heuristics (no plugin needed — pure local analysis):
 *   - Has tool calls / multi-step instructions → high
 *   - Long context or code-heavy → medium
 *   - Simple Q&A / short message → low
 *
 * Falls back to the model's defaultEffort (excluding "auto") if nothing matches.
 */
export function resolveAutoEffort(modelId, messages = []) {
  const model = ANTIGRAVITY_MODELS.find((m) => m.id === modelId);
  const availableEfforts = (model?.reasoning?.efforts || [])
    .map((e) => e.id)
    .filter((id) => id !== "auto");

  // Helper: pick the closest available effort
  const pick = (preferred) => {
    if (availableEfforts.includes(preferred)) return preferred;
    // fallback chain: high → medium → low → first available
    for (const f of ["high", "medium", "low"]) {
      if (availableEfforts.includes(f)) return f;
    }
    return availableEfforts[0] || "medium";
  };

  // Analyse the last user message (most recent intent)
  const lastText = getLastUserText(messages);
  const totalChars = lastText.length;

  // Signals for HIGH effort
  const highSignals = [
    /\b(architect|migrate|security|concurrency|algorithm|complex|comprehensive|in[- ]depth)\b/i,
    /```[\s\S]{200,}```/, // large code block
    /\n.*\n.*\n.*\n.*\n/, // multi-line structured content
  ];

  // Signals for LOW effort
  const lowSignals = [
    /^(what|who|when|where|how much|how many|is |are |does |do |can |will |什么|谁|何时|哪里|是否|能否)/i,
    /[?？]$/, // ends with question mark
  ];

  const isHigh =
    totalChars > 3000 ||
    highSignals.some((re) => re.test(lastText));

  const isLow =
    totalChars < 300 &&
    lastText.length < 150 &&
    lowSignals.some((re) => re.test(lastText.trim()));

  if (isHigh) return pick("high");
  if (isLow) return pick("low");
  return pick("medium");
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
  return 8192;
}
