import {
  antigravityHeaders,
  endpointCandidates,
  fetchAvailableRuntimeModel,
  jsonOrTextError,
  loadCodeAssist,
  resolveProjectId,
} from "../client/client.js";
import {
  AntigravityRequestType,
  AntigravityUserAgent,
  GeminiRole,
  GeminiToolCallingMode,
} from "../types/enums.js";
import {
  getAntigravityRequestModelId,
  getFallbackRuntimeModel,
  getMaxOutputTokens,
  resolveAutoEffort,
} from "../models/antigravity.js";
import { redactSecrets, safeError } from "../utils/security.js";
import { antigravityEnv, isRecord, nowRequestId, sanitizeText } from "../utils/util.js";

const ANTIGRAVITY_SYSTEM_INSTRUCTION =
  "You are Antigravity, a powerful agentic AI coding assistant designed by Google DeepMind. " +
  "You are pair programming with a user to solve coding tasks. Be concise, practical, and tool-aware.";

const ANTIGRAVITY_NO_PREAMBLE_INSTRUCTION =
  'CRITICAL: NEVER output rule checks, formatting guidelines, constraint checklists (e.g. "No emdashes"), or your thinking/personality preambles in the final response. Output only the final response.';

let toolCallCounter = 0;

function firstUsageNumber(...values) {
  return values.find((value) => typeof value === "number" && Number.isFinite(value)) ?? 0;
}

export function normalizeAntigravityUsage(data) {
  const usage =
    data.response?.usageMetadata || data.usageMetadata || data.response?.usage || data.usage;
  if (!usage || typeof usage !== "object") return undefined;

  const inputDetails = usage.input_tokens_details || usage.inputTokensDetails || {};
  const outputDetails = usage.output_tokens_details || usage.outputTokensDetails || {};
  const isAnthropicUsage =
    usage.cache_read_input_tokens !== undefined ||
    usage.cache_creation_input_tokens !== undefined ||
    usage.uncached_input_tokens !== undefined;
  const cacheReadTokens = firstUsageNumber(
    usage.cachedContentTokenCount,
    usage.total_cached_tokens,
    usage.totalCachedTokens,
    usage.cacheReadTokens,
    usage.cache_read_tokens,
    usage.cache_read_input_tokens,
    usage.cached_tokens,
    inputDetails.cached_tokens,
    inputDetails.cache_read_tokens,
  );
  const cacheWriteTokens = firstUsageNumber(
    usage.cacheWriteTokens,
    usage.cache_write_tokens,
    usage.cache_creation_input_tokens,
    usage.cache_creation_tokens,
    usage.cacheCreationInputTokens,
    usage.cacheCreationTokens,
    inputDetails.cache_write_tokens,
  );
  const inputTokenCount = firstUsageNumber(
    usage.uncached_input_tokens,
    usage.promptTokenCount,
    usage.prompt_tokens,
    usage.inputTokens,
    usage.input_tokens,
    usage.total_input_tokens,
    usage.totalInputTokens,
  );
  const reasoningTokens = firstUsageNumber(
    usage.thoughtsTokenCount,
    usage.reasoning_tokens,
    usage.reasoningTokens,
    usage.thinking_tokens,
    outputDetails.reasoning_tokens,
    outputDetails.reasoningTokens,
  );
  const outputTokens = isAnthropicUsage
    ? firstUsageNumber(usage.output_tokens, usage.outputTokens, usage.completion_tokens)
    : firstUsageNumber(
          usage.candidatesTokenCount,
          usage.output_tokens,
          usage.outputTokens,
          usage.completion_tokens,
        ) + reasoningTokens;

  return {
    inputTokens: isAnthropicUsage
      ? inputTokenCount
      : Math.max(0, inputTokenCount - cacheReadTokens - cacheWriteTokens),
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
  };
}

function sanitizeToolCallId(id, fallbackName) {
  const cleaned = (id || "").replace(/[^a-zA-Z0-9_-]/g, "_");
  const capped = cleaned.slice(0, 64);
  return capped || `${fallbackName || "tool"}_${Date.now()}_${++toolCallCounter}`;
}

function toolCallIdNeeded(modelId, runtimeModel) {
  return (
    modelId.startsWith("claude-") ||
    modelId.startsWith("gpt-oss-") ||
    runtimeModel.startsWith("claude-") ||
    runtimeModel.startsWith("gpt-oss-")
  );
}

const CUSTOM_TOOL_SCHEMA_ALLOW = new Set([
  "type",
  "description",
  "properties",
  "required",
  "items",
  "enum",
]);

function normalizeCustomToolType(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return undefined;
  const scalar = value.find((entry) => typeof entry === "string" && entry !== "null");
  return scalar;
}

function normalizeCustomToolSchema(schema) {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(normalizeCustomToolSchema);

  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!CUSTOM_TOOL_SCHEMA_ALLOW.has(key)) continue;
    if (key === "type") {
      const normalizedType = normalizeCustomToolType(value);
      if (normalizedType !== undefined) out.type = normalizedType;
      continue;
    }
    if (key === "properties" && value && typeof value === "object" && !Array.isArray(value)) {
      const props = {};
      for (const [propName, propSchema] of Object.entries(value)) {
        props[propName] = normalizeCustomToolSchema(propSchema);
      }
      out.properties = props;
      continue;
    }
    if (key === "items" && value && typeof value === "object") {
      out.items = normalizeCustomToolSchema(value);
      continue;
    }
    out[key] = value;
  }

  // Ensure required only contains keys present in properties
  if (Array.isArray(out.required) && out.properties && typeof out.properties === "object") {
    const propKeys = new Set(Object.keys(out.properties));
    out.required = out.required.filter((k) => propKeys.has(k));
  }

  return out;
}

function stripMetaSchema(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema;
  const omit = new Set([
    "$schema",
    "$id",
    "$anchor",
    "$dynamicAnchor",
    "$vocabulary",
    "$comment",
    "$defs",
    "definitions",
  ]);
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!omit.has(key)) out[key] = stripMetaSchema(value);
  }

  // Ensure required only contains keys present in properties
  if (Array.isArray(out.required) && out.properties && typeof out.properties === "object") {
    const propKeys = new Set(Object.keys(out.properties));
    out.required = out.required.filter((k) => propKeys.has(k));
  }

  return out;
}

export function convertDshToolsToGemini(tools, useLegacyParameters = false) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  const functionDeclarations = tools.map((tool) => {
    const schema = stripMetaSchema(tool.parameters || { type: "object", properties: {} });
    return {
      name: tool.name,
      description: tool.description || "",
      ...(useLegacyParameters
        ? { parameters: normalizeCustomToolSchema(schema) }
        : { parametersJsonSchema: schema }),
    };
  });
  return [{ functionDeclarations }];
}

export function convertDshMessagesToGemini(messages, modelId, runtimeModel) {
  // 1. Build map of toolCallId -> toolName from assistant messages for robust correlation
  const toolCallNameMap = new Map();
  for (const msg of messages) {
    if (msg.role === "assistant") {
      for (const block of msg.content || []) {
        if (block.type === "tool-call" && block.id && block.name) {
          toolCallNameMap.set(block.id, block.name);
        }
      }
    }
  }

  const contents = [];

  // Helper to ensure Gemini alternating role rules are strictly preserved
  const appendParts = (role, parts) => {
    if (!parts || parts.length === 0) return;
    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts.push(...parts);
    } else {
      contents.push({ role, parts });
    }
  };

  for (const msg of messages) {
    if (msg.role === "system") {
      const text = msg.content
        ?.map((c) => (c.type === "text" ? c.text : ""))
        .filter(Boolean)
        .join("\n");
      if (text) {
        appendParts(GeminiRole.User, [{ text: `[System Instruction]\n${text}` }]);
      }
    } else if (msg.role === "user") {
      const parts = [];
      for (const block of msg.content || []) {
        if (block.type === "text" && block.text) {
          parts.push({ text: sanitizeText(block.text) });
        } else if (block.type === "image" && block.attachment?.data) {
          parts.push({
            inlineData: {
              mimeType: block.attachment.mimeType || "image/png",
              data: block.attachment.data,
            },
          });
        } else if (block.type === "tool-result") {
          const resultText =
            block.content
              ?.map((c) => (c.type === "text" ? c.text : JSON.stringify(c)))
              .join("\n") || (block.isError ? "Tool execution failed" : "Success");

          const resolvedName =
            block.name || toolCallNameMap.get(block.toolCallId) || "tool";

          parts.push({
            functionResponse: {
              name: resolvedName,
              response: block.isError ? { error: resultText } : { output: resultText },
              ...(toolCallIdNeeded(modelId, runtimeModel)
                ? { id: sanitizeToolCallId(block.toolCallId || "", resolvedName) }
                : {}),
            },
          });
        }
      }
      appendParts(GeminiRole.User, parts);
    } else if (msg.role === "assistant") {
      const parts = [];
      for (const block of msg.content || []) {
        if (block.type === "text" && block.text?.trim()) {
          parts.push({ text: sanitizeText(block.text) });
        } else if (block.type === "reasoning" && block.text?.trim()) {
          parts.push({ thought: true, text: sanitizeText(block.text) });
        } else if (block.type === "tool-call") {
          let argsObj = {};
          try {
            argsObj =
              typeof block.arguments === "string"
                ? JSON.parse(block.arguments)
                : block.arguments || {};
          } catch {
            argsObj = {};
          }
          parts.push({
            functionCall: {
              name: block.name,
              args: argsObj,
              ...(toolCallIdNeeded(modelId, runtimeModel)
                ? { id: sanitizeToolCallId(block.id || "", block.name) }
                : {}),
            },
          });
        }
      }
      appendParts(GeminiRole.Model, parts);
    }
  }

  return contents;
}

export function buildAntigravityRequestBody(options, projectId, runtimeModel) {
  const modelId = options.model || "gemini-3.7-flash";
  const effort = options.reasoningEffort || "off";
  const contents = convertDshMessagesToGemini(options.messages || [], modelId, runtimeModel);

  const generationConfig = {
    maxOutputTokens: options.maxTokens || getMaxOutputTokens(modelId, runtimeModel),
    temperature: options.temperature ?? 0.2,
  };

  if (runtimeModel === "gemini-3.7-flash-tiered") {
    generationConfig.thinkingConfig = {
      thinkingLevel:
        effort === "high" || effort === "max" ? "HIGH" : effort === "medium" ? "MEDIUM" : "LOW",
    };
  }

  const systemInstructions = [
    ANTIGRAVITY_SYSTEM_INSTRUCTION,
    ANTIGRAVITY_NO_PREAMBLE_INSTRUCTION,
  ];

  const request = {
    contents,
    systemInstruction: {
      role: GeminiRole.User,
      parts: systemInstructions.map((text) => ({ text })),
    },
    generationConfig,
  };

  const isCustomEngine = modelId.startsWith("claude-") || modelId.startsWith("gpt-oss-");
  const tools = convertDshToolsToGemini(options.tools, isCustomEngine);
  if (tools) {
    request.tools = tools;
    if (modelId.startsWith("claude-")) {
      request.toolConfig = {
        functionCallingConfig: {
          mode: GeminiToolCallingMode.Auto,
        },
      };
    }
  }

  if (options.sessionId) {
    request.sessionId = String(options.sessionId);
  }

  return {
    project: projectId,
    model: runtimeModel,
    request,
    requestType: AntigravityRequestType.Agent,
    userAgent: AntigravityUserAgent.Antigravity,
    requestId: nowRequestId(),
  };
}

export function friendlyAntigravityError(status, text) {
  const msg = redactSecrets(jsonOrTextError(text)).slice(0, 500);
  if (status === 400) {
    return `Antigravity rejected request: ${msg}`;
  }
  if (status === 401) {
    return "Antigravity authentication failed. Please sign in again.";
  }
  if (status === 403) {
    return `Antigravity access denied (${msg}). Please check your Google account permissions.`;
  }
  if (status === 404) {
    return `Model unavailable (${msg}). Try another model like gemini-3.7-flash.`;
  }
  if (status === 429) {
    return `Antigravity quota limit reached (Google Cloud Code Assist 429): ${msg}. Please wait a few moments or switch accounts in Cockpit Tools.`;
  }
  if (status >= 500) {
    return `Antigravity server error (${status}): ${msg}`;
  }
  return msg;
}

export async function* streamAntigravity(options, credentials) {
  const token = credentials.access;
  const warmedProject = credentials.projectId ? null : await loadCodeAssist(token);
  const projectId = resolveProjectId({
    token,
    warmedProject,
    credentialProjectId: credentials.projectId,
    seed: credentials.email || "antigravity-default",
  });

  // Resolve "auto" effort to a concrete level before routing
  const rawEffort = options.reasoningEffort || "off";
  const effort =
    rawEffort === "auto"
      ? resolveAutoEffort(options.model, options.messages)
      : rawEffort;

  const baseRuntimeModel =
    antigravityEnv("RUNTIME_MODEL")?.trim() ||
    getAntigravityRequestModelId(options.model, effort);

  const dynamic = await fetchAvailableRuntimeModel(token, projectId, baseRuntimeModel);
  const initialRuntimeModel =
    dynamic?.id && /^(gemini-|claude-|gpt-oss-)/i.test(dynamic.id)
      ? dynamic.id
      : baseRuntimeModel;

  const runtimeCandidates = [initialRuntimeModel];
  const fallback = getFallbackRuntimeModel(initialRuntimeModel, effort);
  if (fallback && fallback !== initialRuntimeModel) {
    runtimeCandidates.push(fallback);
  }

  const isClaudeReasoning = options.model?.startsWith("claude-") && effort !== "off";
  const headers = {
    ...antigravityHeaders(token),
    ...(isClaudeReasoning ? { "anthropic-beta": "interleaved-thinking-2025-05-14" } : {}),
  };

  // Use resolved effort for request body building
  const resolvedOptions = { ...options, reasoningEffort: effort };

  let response;
  let lastText = "";
  let runtimeModel = initialRuntimeModel;

  for (let attempt = 0; attempt <= 2; attempt++) {
    if (options.signal?.aborted) {
      yield { type: "finish", reason: { kind: "aborted" } };
      return;
    }

    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
    }

    for (let i = 0; i < runtimeCandidates.length; i++) {
      runtimeModel = runtimeCandidates[i];
      const body = JSON.stringify(buildAntigravityRequestBody(resolvedOptions, projectId, runtimeModel));

      for (const endpoint of endpointCandidates()) {
        try {
          response = await fetch(`${endpoint}/v1internal:streamGenerateContent?alt=sse`, {
            method: "POST",
            headers,
            body,
            signal: options.signal,
          });
          if (response.ok) break;
          lastText = await response.text();
          if (![403, 404, 429, 500, 502, 503, 504].includes(response.status)) break;
        } catch (err) {
          if (options.signal?.aborted) {
            yield { type: "finish", reason: { kind: "aborted" } };
            return;
          }
        }
      }

      if (response?.ok) break;
      if (response?.status === 404 && i + 1 < runtimeCandidates.length) continue;
      break;
    }

    if (response?.ok) break;
  }

  if (!response || !response.ok) {
    const errorMsg = friendlyAntigravityError(response?.status, lastText);
    yield {
      type: "finish",
      reason: {
        kind: "error",
        failure: {
          message: errorMsg,
          code: "ANTIGRAVITY_API_ERROR",
          status: response?.status,
        },
      },
    };
    return;
  }

  // ── SSE streaming with stall-detection ──────────────────────────────────────
  // Gemini streams can silently stall (no data, no error, no done).
  // We use a per-chunk deadline: if no chunk arrives within CHUNK_TIMEOUT_MS,
  // we abort the reader and surface a recoverable error so DSH can retry.
  const CHUNK_TIMEOUT_MS = 30_000; // 30 s without any chunk → stall

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentBlockType = null;
  let currentBlockIndex = 0;
  let currentText = "";
  let currentReasoning = "";
  let toolCallId = "";
  let toolCallName = "";
  let toolCallArgs = "";
  let hasEmittedFinish = false;
  let finishReason = "stop";

  // Wrap reader.read() with a per-call timeout so a stalled Gemini stream
  // doesn't hang the agent indefinitely.
  async function readWithTimeout() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reader.cancel("stream stall timeout").catch(() => {});
        reject(new Error("Gemini stream stalled: no data received for 30 seconds"));
      }, CHUNK_TIMEOUT_MS);

      reader.read().then(
        (result) => { clearTimeout(timer); resolve(result); },
        (err)    => { clearTimeout(timer); reject(err); },
      );
    });
  }

  try {
    while (true) {
      const { done, value } = await readWithTimeout();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const dataStr = line.slice(5).trim();
        if (!dataStr || dataStr === "[DONE]") continue;

        let data;
        try {
          data = JSON.parse(dataStr);
        } catch {
          continue;
        }

        const candidate = data.response?.candidates?.[0] || data.candidates?.[0];
        if (candidate?.finishReason) {
          if (candidate.finishReason === "STOP") finishReason = "stop";
          else if (candidate.finishReason === "MAX_TOKENS") finishReason = "max-tokens";
          else finishReason = "stop";
        }

        const parts = candidate?.content?.parts || [];
        for (const part of parts) {
          // 1. Thinking / Reasoning
          if (part.thought === true || part.thoughtSignature) {
            const thoughtText = part.text || "";
            if (thoughtText) {
              if (currentBlockType !== "reasoning") {
                if (currentBlockType === "text") {
                  yield {
                    type: "block-end",
                    index: currentBlockIndex,
                    block: { type: "text", text: currentText },
                  };
                  currentBlockIndex++;
                }
                currentBlockType = "reasoning";
                currentReasoning = "";
                yield { type: "block-start", index: currentBlockIndex, blockType: "reasoning" };
              }
              currentReasoning += thoughtText;
              yield { type: "reasoning-delta", index: currentBlockIndex, text: thoughtText };
            }
          }
          // 2. Tool Calls / Function Calls
          else if (part.functionCall) {
            if (currentBlockType === "text") {
              yield {
                type: "block-end",
                index: currentBlockIndex,
                block: { type: "text", text: currentText },
              };
              currentBlockIndex++;
            } else if (currentBlockType === "reasoning") {
              yield {
                type: "block-end",
                index: currentBlockIndex,
                block: { type: "reasoning", text: currentReasoning },
              };
              currentBlockIndex++;
            }

            currentBlockType = "tool-call";
            toolCallName = part.functionCall.name || "tool";
            toolCallId = part.functionCall.id || sanitizeToolCallId("", toolCallName);
            const argsStr = JSON.stringify(part.functionCall.args || {});
            toolCallArgs = argsStr;
            finishReason = "tool-calls";

            yield { type: "block-start", index: currentBlockIndex, blockType: "tool-call" };
            yield {
              type: "tool-call-delta",
              index: currentBlockIndex,
              id: toolCallId,
              name: toolCallName,
              argumentsDelta: argsStr,
            };
            yield {
              type: "block-end",
              index: currentBlockIndex,
              block: {
                type: "tool-call",
                id: toolCallId,
                name: toolCallName,
                arguments: argsStr,
              },
            };
            currentBlockIndex++;
            currentBlockType = null;
          }
          // 3. Visible text
          else if (part.text) {
            if (currentBlockType !== "text") {
              if (currentBlockType === "reasoning") {
                yield {
                  type: "block-end",
                  index: currentBlockIndex,
                  block: { type: "reasoning", text: currentReasoning },
                };
                currentBlockIndex++;
              }
              currentBlockType = "text";
              currentText = "";
              yield { type: "block-start", index: currentBlockIndex, blockType: "text" };
            }
            currentText += part.text;
            yield { type: "text-delta", index: currentBlockIndex, text: part.text };
          }
        }

        const usage = normalizeAntigravityUsage(data);
        if (usage) {
          yield {
            type: "usage",
            usage: {
              ...usage,
            },
          };
        }
      }
    }

    // Close remaining open block
    if (currentBlockType === "text") {
      yield {
        type: "block-end",
        index: currentBlockIndex,
        block: { type: "text", text: currentText },
      };
    } else if (currentBlockType === "reasoning") {
      yield {
        type: "block-end",
        index: currentBlockIndex,
        block: { type: "reasoning", text: currentReasoning },
      };
    }

    yield {
      type: "finish",
      reason: { kind: finishReason },
    };
    hasEmittedFinish = true;
  } catch (err) {
    if (!hasEmittedFinish) {
      const isAborted = options.signal?.aborted;
      yield {
        type: "finish",
        reason: isAborted
          ? { kind: "aborted" }
          : {
              kind: "error",
              failure: { message: safeError(err), code: "STREAM_ERROR" },
            },
      };
    }
  }
}
