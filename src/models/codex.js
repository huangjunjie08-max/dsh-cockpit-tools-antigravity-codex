export const CODEX_PROVIDER_ID = "openai-codex";
export const CODEX_PROVIDER_NAME = "OpenAI Codex";

export const CODEX_MODELS = [
  {
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol (Codex)",
    contextWindow: 200000,
    maxTokens: 64000,
    reasoning: {
      efforts: [
        { id: "auto", name: "Auto", description: "Automatically select effort based on task complexity" },
        { id: "low", name: "Low", description: "Faster, concise reasoning" },
        { id: "medium", name: "Medium", description: "Balanced reasoning effort" },
        { id: "high", name: "High", description: "Comprehensive reasoning" },
      ],
      defaultEffort: "auto",
    },
  },
  {
    id: "gpt-5.6-terra",
    name: "GPT-5.6 Terra (Codex)",
    contextWindow: 200000,
    maxTokens: 64000,
    reasoning: {
      efforts: [
        { id: "auto", name: "Auto", description: "Automatically select effort based on task complexity" },
        { id: "medium", name: "Medium", description: "Balanced reasoning" },
        { id: "high", name: "High", description: "Deep reasoning" },
        { id: "xhigh", name: "X-High", description: "Maximum reasoning capacity" },
      ],
      defaultEffort: "auto",
    },
  },
  {
    id: "gpt-5.6-luna",
    name: "GPT-5.6 Luna (Codex)",
    contextWindow: 128000,
    maxTokens: 32768,
    reasoning: {
      efforts: [
        { id: "auto", name: "Auto", description: "Automatically select effort based on task complexity" },
        { id: "low", name: "Low", description: "Lightweight, fast reasoning" },
        { id: "medium", name: "Medium", description: "Balanced reasoning" },
      ],
      defaultEffort: "auto",
    },
  },
  {
    id: "o3-mini",
    name: "o3-mini (Codex)",
    contextWindow: 200000,
    maxTokens: 65536,
    reasoning: {
      efforts: [
        { id: "auto", name: "Auto", description: "Automatically select effort based on task complexity" },
        { id: "low", name: "Low", description: "Fast reasoning" },
        { id: "medium", name: "Medium", description: "Balanced reasoning" },
        { id: "high", name: "High", description: "Deep reasoning" },
      ],
      defaultEffort: "auto",
    },
  },
  {
    id: "o1",
    name: "o1 (Codex)",
    contextWindow: 200000,
    maxTokens: 65536,
    reasoning: {
      efforts: [
        { id: "auto", name: "Auto", description: "Automatically select effort based on task complexity" },
        { id: "low", name: "Low", description: "Fast reasoning" },
        { id: "medium", name: "Medium", description: "Balanced reasoning" },
        { id: "high", name: "High", description: "Deep reasoning" },
      ],
      defaultEffort: "auto",
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
