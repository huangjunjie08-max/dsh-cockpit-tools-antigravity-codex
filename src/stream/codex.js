import { createHash } from "node:crypto";
import { sanitizeText, isRecord, nowRequestId } from "../utils/util.js";
import { safeError, redactSecrets } from "../utils/security.js";
import {
  filterRequestTools,
  getLastUserText,
  getRequestToolProfile,
  getSystemInstruction,
} from "../utils/request.js";
import { CODEX_MODELS, resolveCodexModelId } from "../models/codex.js";

const DEFAULT_CODEX_URL = "https://chatgpt.com/backend-api/codex/responses";
const CODEX_CACHE_KEY_MAX_LENGTH = 64;

function compactCacheKey(value) {
  const chars = Array.from(value);
  if (chars.length <= CODEX_CACHE_KEY_MAX_LENGTH) return value;
  return `dsh:${createHash("sha256").update(value).digest("hex").slice(0, 60)}`;
}

function buildCodexPromptCacheKey(modelId, sessionId, toolProfile) {
  if (!sessionId) return undefined;
  const raw =
    toolProfile === "coding"
      ? `dsh-codex:${modelId}:${sessionId}`
      : `dsh-codex:${modelId}:${toolProfile}:${sessionId}`;
  return compactCacheKey(raw);
}

/**
 * Resolve "auto" reasoning effort for Codex models.
 * "auto" is a UI-only convenience; the API receives a concrete model effort.
 */
export function resolveCodexAutoEffort(modelId, messages = []) {
  const model = CODEX_MODELS.find((item) => item.id === resolveCodexModelId(modelId));
  const availableEfforts = (model?.reasoning?.efforts || [])
    .map((effort) => effort.id)
    .filter((effort) => effort !== "auto");
  const pick = (preferred) => {
    if (availableEfforts.includes(preferred)) return preferred;
    for (const effort of ["max", "xhigh", "high", "medium", "low", "none"]) {
      if (availableEfforts.includes(effort)) return effort;
    }
    return availableEfforts[0];
  };

  const lastText = getLastUserText(messages);
  const totalChars = lastText.length;

  const highSignals = [
    /\b(architect|migrate|security|concurrency|algorithm|complex|comprehensive|in[- ]depth)\b/i,
    /```[\s\S]{200,}```/,
    /\n.*\n.*\n.*\n.*\n/,
  ];
  const lowSignals = [
    /^(what|who|when|where|how much|how many|is |are |does |do |can |will |什么|谁|何时|哪里|是否|能否)/i,
    /[?？]$/,
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

function convertDshMessagesToCodex(messages) {
  const input = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      const contents = [];
      const toolResults = [];
      for (const block of msg.content || []) {
        if (block.type === "text" && block.text) {
          contents.push({ type: "input_text", text: sanitizeText(block.text) });
        } else if (block.type === "image" && block.attachment?.data) {
          contents.push({
            type: "input_image",
            image_url: `data:${block.attachment.mimeType || "image/png"};base64,${block.attachment.data}`,
          });
        } else if (block.type === "tool-result") {
          const resultText =
            block.content?.map((c) => (c.type === "text" ? c.text : JSON.stringify(c))).join("\n") ||
            (block.isError ? "Error" : "Success");
          toolResults.push({
            type: "function_call_output",
            call_id: block.toolCallId || block.id || block.name || "tool",
            output: resultText,
          });
        }
      }
      if (contents.length > 0) {
        input.push({ role: "user", content: contents });
      }
      input.push(...toolResults);
    } else if (msg.role === "tool" || msg.role === "toolResult") {
      const resultText =
        msg.content?.map((c) => (c.type === "text" ? c.text : JSON.stringify(c))).join("\n") ||
        "Success";
      input.push({
        type: "function_call_output",
        call_id: msg.toolCallId || msg.id || msg.name || "tool",
        output: resultText,
      });
    } else if (msg.role === "assistant") {
      for (const block of msg.content || []) {
        if (block.type === "text" && block.text) {
          input.push({
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: sanitizeText(block.text) }],
            status: "completed",
          });
        } else if (block.type === "tool-call") {
          let argumentsValue = block.arguments || {};
          if (typeof argumentsValue === "string") {
            try {
              argumentsValue = JSON.parse(argumentsValue);
            } catch {
              argumentsValue = {};
            }
          }
          input.push({
            type: "function_call",
            call_id: block.id || block.toolCallId || block.name || "tool",
            name: block.name || "tool",
            arguments: JSON.stringify(argumentsValue),
          });
        }
      }
    }
  }

  return input;
}

function convertDshToolsToCodex(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description || "",
    parameters: tool.parameters || { type: "object", properties: {} },
  }));
}

const codexContinuations = new Map();

function continuationKey(sessionId, modelId) {
  return `${sessionId}:${modelId}`;
}

function requestFingerprint(body) {
  const { input: _input, previous_response_id: _previousResponseId, ...stable } = body;
  return JSON.stringify(stable);
}

function comparableItem(item) {
  if (!item || typeof item !== "object") return item;
  if (item.type === "function_call") {
    return { type: item.type, call_id: item.call_id, name: item.name, arguments: item.arguments };
  }
  if (item.type === "message") {
    return {
      type: item.type,
      role: item.role,
      text: (item.content || [])
        .map((part) => part?.text || part?.refusal || "")
        .join(""),
    };
  }
  return { type: item.type, call_id: item.call_id, output: item.output };
}

function hasPrefix(input, prefix) {
  if (input.length < prefix.length) return false;
  return prefix.every((item, index) =>
    JSON.stringify(comparableItem(input[index])) === JSON.stringify(comparableItem(item)),
  );
}

function applyCodexContinuation(body, sessionId, modelId) {
  if (!sessionId || process.env.DSH_CODEX_CONTINUATION === "0") return body;
  const state = codexContinuations.get(continuationKey(sessionId, modelId));
  if (!state || state.fingerprint !== requestFingerprint(body)) return body;

  const baseline = [...state.input, ...state.output.filter((item) => item.type !== "reasoning")];
  if (!hasPrefix(body.input || [], baseline) || body.input.length <= baseline.length) return body;

  return {
    ...body,
    previous_response_id: state.responseId,
    input: body.input.slice(baseline.length),
  };
}

function rememberCodexContinuation(sessionId, modelId, body, response) {
  if (!sessionId || !response?.id) return;
  codexContinuations.set(continuationKey(sessionId, modelId), {
    responseId: response.id,
    input: body.input || [],
    output: Array.isArray(response.output) ? response.output : [],
    fingerprint: requestFingerprint(body),
  });
}

export function buildCodexRequestBody(options) {
  const modelId = resolveCodexModelId(options.model || "gpt-5.6-sol");
  const input = convertDshMessagesToCodex(options.messages || []);
  const model = CODEX_MODELS.find((item) => item.id === modelId);
  const sessionId = typeof options.sessionId === "string" ? options.sessionId.trim() : "";
  const instructions = getSystemInstruction(options.system, options.messages || []);
  const filteredTools = filterRequestTools(options.tools, options.messages || []);
  const tools = convertDshToolsToCodex(filteredTools);
  const toolProfile = getRequestToolProfile(options.tools, options.messages || []);
  const promptCacheKey = buildCodexPromptCacheKey(modelId, sessionId, toolProfile);

  // Resolve "auto" to a concrete effort — OpenAI API doesn't accept "auto"
  const rawEffort = options.reasoningEffort || "auto";
  const effort =
    rawEffort === "auto" || rawEffort === "off"
      ? resolveCodexAutoEffort(modelId, options.messages)
      : rawEffort;

  const body = {
    model: modelId,
    instructions: instructions || "You are a helpful coding assistant.",
    input,
    stream: true,
    store: false,
    ...(modelId.startsWith("gpt-5.6-")
      ? { text: { verbosity: process.env.DSH_CODEX_TEXT_VERBOSITY || "low" } }
      : {}),
    ...(promptCacheKey ? { prompt_cache_key: promptCacheKey } : {}),
  };

  if (model?.reasoning && effort && effort !== "off") {
    body.reasoning = {
      effort,
      ...(modelId.startsWith("gpt-5.6-") ? { context: "all_turns" } : {}),
    };
    if (effort !== "none") {
      body.reasoning.summary = "auto";
      body.include = ["reasoning.encrypted_content"];
    }
  }

  if (options.temperature !== undefined) {
    body.temperature = options.temperature;
  }

  if (tools) {
    body.tools = tools;
  }

  return body;
}

export async function* streamCodex(options, credentials) {
  const token = credentials.access;
  const body = buildCodexRequestBody(options);
  const fullInput = body.input;
  const modelId = body.model;
  const sessionId = typeof options.sessionId === "string" ? options.sessionId.trim() : "";
  let requestBody = applyCodexContinuation(body, sessionId, modelId);

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "OpenAI-Beta": "responses=experimental",
    "User-Agent": "codex-cli/1.0",
    ...(credentials.accountId ? { "chatgpt-account-id": credentials.accountId } : {}),
    ...(sessionId && body.prompt_cache_key
      ? {
          "session-id": compactCacheKey(sessionId),
          "x-client-request-id": nowRequestId(),
        }
      : {}),
  };

  const endpoint = process.env.CODEX_BASE_URL || DEFAULT_CODEX_URL;
  let response;

  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: options.signal,
      });
      if (response.ok || !requestBody.previous_response_id || ![400, 404].includes(response.status)) break;
      const retryText = await response.text();
      if (!/previous_response_id|continuation|response not found|not found/i.test(retryText)) break;
      codexContinuations.delete(continuationKey(sessionId, modelId));
      requestBody = { ...body, input: fullInput };
    }
  } catch (err) {
    if (options.signal?.aborted) {
      yield { type: "finish", reason: { kind: "aborted" } };
      return;
    }
    yield {
      type: "finish",
      reason: {
        kind: "error",
        failure: { message: safeError(err), code: "CODEX_NETWORK_ERROR" },
      },
    };
    return;
  }

  if (!response.ok) {
    const text = await response.text();
    let msg = text;
    try {
      const parsed = JSON.parse(text);
      if (parsed.error?.message) msg = parsed.error.message;
      else if (parsed.detail) msg = parsed.detail;
    } catch {}

    yield {
      type: "finish",
      reason: {
        kind: "error",
        failure: {
          message: `OpenAI Codex error (${response.status}): ${redactSecrets(msg)}`,
          code: "CODEX_API_ERROR",
          status: response.status,
        },
      },
    };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentBlockType = null;
  let currentBlockIndex = 0;
  let currentText = "";
  let currentReasoning = "";
  let finishReason = "stop";
  let hasEmittedFinish = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
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

        const type = data.type;

        // 1. Text delta
        if (type === "response.output_text.delta" || type === "response.text.delta" || data.delta?.text) {
          const delta = typeof data.delta === "string" ? data.delta : data.delta?.text ?? data.delta;
          if (typeof delta === "string" && delta.length > 0) {
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
            currentText += delta;
            yield { type: "text-delta", index: currentBlockIndex, text: delta };
          }
        }
        // 2. Reasoning / Thinking delta
        else if (
          type === "response.reasoning.delta" ||
          type === "response.reasoning_summary_text.delta" ||
          type === "response.reasoning_text.delta" ||
          type === "response.thought.delta" ||
          data.delta?.thought
        ) {
          const delta = data.delta?.thought ?? data.delta?.text ?? data.delta;
          if (typeof delta === "string" && delta.length > 0) {
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
            currentReasoning += delta;
            yield { type: "reasoning-delta", index: currentBlockIndex, text: delta };
          }
        }
        // 3. Tool call / Function call
        else if (type === "response.function_call_arguments.delta" || data.delta?.arguments) {
          const delta = data.delta?.arguments ?? data.delta;
          const callId = data.call_id || data.id || `call_${currentBlockIndex}`;
          const name = data.name;

          if (currentBlockType !== "tool-call") {
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
            yield { type: "block-start", index: currentBlockIndex, blockType: "tool-call" };
          }

          yield {
            type: "tool-call-delta",
            index: currentBlockIndex,
            id: callId,
            ...(name ? { name } : {}),
            argumentsDelta: String(delta),
          };
        }
        // 4. Output item done
        else if (type === "response.output_item.done") {
          if (data.item?.type === "function_call") {
            finishReason = "tool-calls";
            yield {
              type: "block-end",
              index: currentBlockIndex,
              block: {
                type: "tool-call",
                id: data.item.call_id || data.item.id,
                name: data.item.name,
                arguments: data.item.arguments || "{}",
              },
            };
            currentBlockIndex++;
            currentBlockType = null;
          }
        }
        // 5. Response completed with usage
        else if (type === "response.completed" || type === "response.done") {
          const completedResponse = data.response || data;
          rememberCodexContinuation(sessionId, modelId, {
            ...body,
            input: fullInput,
          }, completedResponse);
          const usage = completedResponse.usage;
          if (usage) {
            const inputTokens = usage.input_tokens || usage.prompt_tokens || 0;
            const outputTokens = usage.output_tokens || usage.completion_tokens || 0;
            const cacheReadTokens = usage.input_tokens_details?.cached_tokens || 0;
            const cacheWriteTokens = usage.input_tokens_details?.cache_write_tokens || 0;
            const reasoningTokens = usage.output_tokens_details?.reasoning_tokens || 0;

            yield {
              type: "usage",
              usage: {
                inputTokens: Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens),
                outputTokens,
                cacheReadTokens,
                cacheWriteTokens,
                reasoningTokens,
              },
            };
          }
        }
      }
    }

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
              failure: { message: safeError(err), code: "CODEX_STREAM_ERROR" },
            },
      };
    }
  }
}
