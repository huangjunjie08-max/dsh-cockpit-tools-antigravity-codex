import {
  ANTIGRAVITY_PROVIDER_ID,
  ANTIGRAVITY_PROVIDER_NAME,
  STATIC_ANTIGRAVITY_MODELS,
  buildDynamicModelEntry,
  getAntigravityRequestModelId,
} from "./models/antigravity.js";
import {
  CODEX_PROVIDER_ID,
  CODEX_PROVIDER_NAME,
  CODEX_MODELS,
  resolveCodexModelId,
  resolveCodexModelMetadata,
} from "./models/codex.js";
import { getValidCredentials } from "./auth/oauth.js";
import { getValidCodexCredentials } from "./auth/cockpit-codex.js";
import {
  fetchAllAvailableModels,
  fetchAvailableRuntimeModel,
  loadCodeAssist,
  resolveProjectId,
} from "./client/client.js";
import { streamAntigravity } from "./stream/stream.js";
import { streamCodex } from "./stream/codex.js";
import { visibleFailureChunks } from "./utils/failure.js";

let BaseLlmAdapter = class {
  providerInfo(provider) {
    return { id: provider, name: provider };
  }
  async listModels(provider) {
    return [];
  }
  async resolveModel(provider, model) {
    return { id: model, name: model };
  }
  async *stream(options) {
    throw new Error("stream not implemented");
  }
};

function firstPositiveNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return undefined;
}

export function normalizeAntigravityModelMetadata(found, runtime) {
  const nested = runtime?.metadata && typeof runtime.metadata === "object" ? runtime.metadata : {};
  const info = { ...runtime, ...nested };
  return {
    contextWindow:
      firstPositiveNumber(
        info.contextWindow,
        info.context_window,
        info.inputTokenLimit,
        info.input_token_limit,
        info.maxInputTokens,
        info.max_input_tokens,
        info.maxTokens,
        info.max_tokens,
        info.maxContextTokens,
        info.max_context_tokens,
        info.contextLength,
        info.context_length,
        found?.contextWindow,
      ) || found?.contextWindow || 1048576,
    maxTokens:
      firstPositiveNumber(
        info.outputTokenLimit,
        info.output_token_limit,
        info.maxOutputTokens,
        info.max_output_tokens,
        found?.maxTokens,
      ) || found?.maxTokens || 65536,
  };
}

async function resolveAntigravityModelMetadata(model, found, signal) {
  try {
    const credentials = await getValidCredentials();
    const token = credentials.access;
    const warmedProject = credentials.projectId ? null : await loadCodeAssist(token, signal);
    const projectId = resolveProjectId({
      token,
      warmedProject,
      credentialProjectId: credentials.projectId,
      seed: credentials.email || "antigravity-default",
    });
    const runtimeModel = getAntigravityRequestModelId(model, "off");
    const runtime = await fetchAvailableRuntimeModel(token, projectId, runtimeModel, signal);
    return normalizeAntigravityModelMetadata(found, runtime);
  } catch {
    return normalizeAntigravityModelMetadata(found);
  }
}

try {
  const dshLlm = await import("@deepseek-ai/dsh-llm");
  if (dshLlm?.LlmAdapter) {
    BaseLlmAdapter = dshLlm.LlmAdapter;
  }
} catch {
  // Use fallback base class
}

export class AntigravityAndCodexLlmAdapter extends BaseLlmAdapter {
  providerInfo(provider) {
    if (provider === CODEX_PROVIDER_ID || provider === "codex") {
      return {
        id: provider,
        name: CODEX_PROVIDER_NAME,
      };
    }
    return {
      id: ANTIGRAVITY_PROVIDER_ID,
      name: ANTIGRAVITY_PROVIDER_NAME,
    };
  }

  async listModels(provider) {
    if (provider === CODEX_PROVIDER_ID || provider === "codex") {
      return CODEX_MODELS.map((m) => ({
        provider: provider,
        id: m.id,
        name: m.name,
        inputModalities: ["text", "image"],
      }));
    }

    // 1. Antigravity Provider: Try Dynamic Cloud Discovery
    try {
      const credentials = await getValidCredentials();
      const token = credentials?.access;
      if (token) {
        const warmedProject = credentials.projectId ? null : await loadCodeAssist(token);
        const projectId = resolveProjectId({
          token,
          warmedProject,
          credentialProjectId: credentials.projectId,
          seed: credentials.email || "antigravity-default",
        });
        const cloudModels = await fetchAllAvailableModels(token, projectId);
        if (cloudModels && typeof cloudModels === "object") {
          const modelList = [];
          const seen = new Set();

          // Add clean curated primary models first
          for (const s of STATIC_ANTIGRAVITY_MODELS) {
            modelList.push({
              provider: provider,
              id: s.id,
              name: s.name,
              inputModalities: ["text", "image"],
            });
            seen.add(s.id);
          }

          // Add any newly discovered raw models from Google Antigravity backend
          for (const [rawId, rawMeta] of Object.entries(cloudModels)) {
            // Ignore placeholder / internal non-chat models
            if (rawId.startsWith("tab_") || rawId.startsWith("chat_") || seen.has(rawId)) {
              continue;
            }
            const built = buildDynamicModelEntry(rawId, rawMeta);
            modelList.push({
              provider: provider,
              id: built.id,
              name: built.name,
              inputModalities: built.inputModalities,
            });
            seen.add(rawId);
          }

          return modelList;
        }
      }
    } catch {
      // Fallback to static catalog on failure
    }

    // Fallback: Static Antigravity Models
    return STATIC_ANTIGRAVITY_MODELS.map((m) => ({
      provider: provider,
      id: m.id,
      name: m.name,
      inputModalities: ["text", "image"],
    }));
  }

  async resolveModel(provider, model, signal) {
    // 1. OpenAI Codex Provider
    if (provider === CODEX_PROVIDER_ID || provider === "codex") {
      const found =
        CODEX_MODELS.find((m) => m.id === model) ||
        CODEX_MODELS.find((m) => m.id === resolveCodexModelId(model)) ||
        CODEX_MODELS[0];
      const metadata = await resolveCodexModelMetadata(model, signal);

      return {
        provider: provider,
        id: model,
        name: found.name,
        context: {
          contextWindow: metadata.contextWindow,
        },
        inputModalities: ["text", "image"],
        reasoning: found.reasoning
          ? {
              efforts: found.reasoning.efforts.map((e) => ({
                id: e.id,
                name: e.name,
                ...(e.description ? { description: e.description } : {}),
              })),
              defaultEffort:
                found.reasoning.defaultEffort || found.reasoning.efforts[0].id,
            }
          : undefined,
      };
    }

    // 2. Antigravity Provider
    let found = STATIC_ANTIGRAVITY_MODELS.find((m) => m.id === model);

    // If not in static list, check dynamic discovery cache
    if (!found) {
      try {
        const credentials = await getValidCredentials();
        const token = credentials?.access;
        if (token) {
          const projectId = resolveProjectId({
            token,
            credentialProjectId: credentials.projectId,
            seed: credentials.email || "antigravity-default",
          });
          const cloudModels = await fetchAllAvailableModels(token, projectId, signal);
          if (cloudModels && cloudModels[model]) {
            found = buildDynamicModelEntry(model, cloudModels[model]);
          }
        }
      } catch {
        // ignore
      }
    }

    if (!found) {
      found = STATIC_ANTIGRAVITY_MODELS[0];
    }

    const metadata = await resolveAntigravityModelMetadata(found.id, found, signal);

    return {
      provider: provider,
      id: model,
      name: found.name,
      context: {
        contextWindow: metadata.contextWindow,
      },
      defaultMaxTokens: metadata.maxTokens,
      inputModalities: found.inputModalities || ["text", "image"],
      reasoning: found.reasoning
        ? {
            efforts: found.reasoning.efforts.map((e) => ({
              id: e.id,
              name: e.name,
              ...(e.description ? { description: e.description } : {}),
            })),
            defaultEffort:
              found.reasoning.defaultEffort || found.reasoning.efforts[0].id,
          }
        : undefined,
    };
  }

  async *stream(options) {
    const provider = options.provider;

    if (provider === CODEX_PROVIDER_ID || provider === "codex") {
      try {
        const credentials = await getValidCodexCredentials();
        yield* streamCodex(options, credentials);
      } catch (err) {
        yield* visibleFailureChunks(err);
      }
      return;
    }

    try {
      const credentials = await getValidCredentials();
      yield* streamAntigravity(options, credentials);
    } catch (err) {
      yield* visibleFailureChunks(err);
    }
  }
}