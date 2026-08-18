import {
  ANTIGRAVITY_PROVIDER_ID,
  ANTIGRAVITY_PROVIDER_NAME,
  ANTIGRAVITY_MODELS,
} from "./models/antigravity.js";
import {
  CODEX_PROVIDER_ID,
  CODEX_PROVIDER_NAME,
  CODEX_MODELS,
  resolveCodexModelId,
} from "./models/codex.js";
import { getValidCredentials } from "./auth/oauth.js";
import { getValidCodexCredentials } from "./auth/cockpit-codex.js";
import { streamAntigravity } from "./stream/stream.js";
import { streamCodex } from "./stream/codex.js";

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

    return ANTIGRAVITY_MODELS.map((m) => ({
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

      return {
        provider: provider,
        id: model,
        name: found.name,
        context: {
          contextWindow: found.contextWindow,
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
    const found =
      ANTIGRAVITY_MODELS.find((m) => m.id === model) ||
      ANTIGRAVITY_MODELS[0];

    return {
      provider: provider,
      id: model,
      name: found.name,
      context: {
        contextWindow: found.contextWindow,
      },
      defaultMaxTokens: found.maxTokens,
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

  async *stream(options) {
    const provider = options.provider;

    // Dispatch to Codex
    if (provider === CODEX_PROVIDER_ID || provider === "codex") {
      let credentials;
      try {
        credentials = await getValidCodexCredentials();
      } catch (err) {
        yield {
          type: "finish",
          reason: {
            kind: "error",
            failure: {
              message: `OpenAI Codex credentials missing: ${err.message}. Please login in Cockpit Tools.`,
              code: "NO_CODEX_CREDENTIALS",
            },
          },
        };
        return;
      }

      yield* streamCodex(options, credentials);
      return;
    }

    // Dispatch to Antigravity
    let credentials;
    try {
      credentials = await getValidCredentials();
    } catch (err) {
      yield {
        type: "finish",
        reason: {
          kind: "error",
          failure: {
            message: `Antigravity credentials missing: ${err.message}. Please login via 'node bin/login.js' or Cockpit Tools.`,
            code: "NO_CREDENTIALS",
          },
        },
      };
      return;
    }

    yield* streamAntigravity(options, credentials);
  }
}
