import { sanitizeText, isRecord, nowRequestId } from "../utils/util.js";
import { safeError, redactSecrets } from "../utils/security.js";
import { CODEX_MODELS, resolveCodexModelId } from "../models/codex.js";

const DEFAULT_CODEX_URL = "https://chatgpt.com/backend-api/codex/responses";

/**
 * Resolve "auto" reasoning effort for Codex models.
 * "auto" is a UI-only convenience; the API receives a concrete model effort.
 */
function resolveCodexAutoEffort(modelId, messages = []) {
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

  const allText = (messages || [])
    .flatMap((m) => m.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text || "")
    .join(" ");

  const totalChars = allText.length;
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const lastText = (lastUser?.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text || "")
    .join(" ");

  const highSignals = [
    /\b(architect|design|refactor|implement|debug|analyze|explain|compare|optimize|migrate|review)\b/i,
    /\b(step[- ]by[- ]step|in[- ]depth|comprehensive|detailed|complex|algorithm|system)\b/i,
    /```[\s\S]{200,}```/,
    /\n.*\n.*\n.*\n.*\n/,
  ];
  const lowSignals = [
    /^(what|who|when|where|how much|how many|is |are |does |do |can |will )/i,
    /\?$/,
  ];

  const isHigh =
    totalChars > 3000 ||
    highSignals.some((re) => re.test(lastText)) ||
    (messages || []).some((m) =>
      (m.content || []).some((c) => c.type === "tool-result")
    );
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
    if (msg.role === "system") {
      const text = msg.content
        ?.map((c) => (c.type === "text" ? c.text : ""))
        .filter(Boolean)
        .join("\n");
      if (text) {
        input.push({
          role: "user",
          content: [{ type: "input_text", text: `[System Instruction]\n${text}` }],
        });
      }
    } else if (msg.role === "user") {
      const contents = [];
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
          contents.push({
            type: "input_text",
            text: `[Tool Result for ${block.name || block.toolCallId || "tool"}]:\n${resultText}`,
          });
        }
      }
      if (contents.length > 0) {
        input.push({ role: "user", content: contents });
      }
    } else if (msg.role === "assistant") {
      const contents = [];
      for (const block of msg.content || []) {
        if (block.type === "text" && block.text) {
          contents.push({ type: "output_text", text: sanitizeText(block.text) });
        }
      }
      if (contents.length > 0) {
        input.push({ role: "assistant", content: contents });
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

export function buildCodexRequestBody(options) {
  const modelId = resolveCodexModelId(options.model || "gpt-5.6-sol");
  const input = convertDshMessagesToCodex(options.messages || []);
  const model = CODEX_MODELS.find((item) => item.id === modelId);

  // Resolve "auto" to a concrete effort — OpenAI API doesn't accept "auto"
  const rawEffort = options.reasoningEffort || "auto";
  const effort =
    rawEffort === "auto" || rawEffort === "off"
      ? resolveCodexAutoEffort(modelId, options.messages)
      : rawEffort;

  const body = {
    model: modelId,
    input,
    stream: true,
    store: false,
  };

  if (model?.reasoning && effort && effort !== "off") {
    body.reasoning = {
      effort,
    };
    if (effort !== "none") {
      body.reasoning.summary = "auto";
      body.include = ["reasoning.encrypted_content"];
    }
  }

  if (options.maxTokens) {
    body.max_output_tokens = options.maxTokens;
  }

  if (options.temperature !== undefined) {
    body.temperature = options.temperature;
  }

  const tools = convertDshToolsToCodex(options.tools);
  if (tools) {
    body.tools = tools;
  }

  return body;
}

export async function* streamCodex(options, credentials) {
  const token = credentials.access;
  const body = buildCodexRequestBody(options);

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "User-Agent": "codex-cli/1.0",
    ...(credentials.accountId ? { "chatgpt-account-id": credentials.accountId } : {}),
  };

  const endpoint = process.env.CODEX_BASE_URL || DEFAULT_CODEX_URL;
  let response;

  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: options.signal,
    });
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
          const usage = data.response?.usage || data.usage;
          if (usage) {
            const inputTokens = usage.input_tokens || usage.prompt_tokens || 0;
            const outputTokens = usage.output_tokens || usage.completion_tokens || 0;
            const cacheReadTokens = usage.input_tokens_details?.cached_tokens || 0;
            const reasoningTokens = usage.output_tokens_details?.reasoning_tokens || 0;

            yield {
              type: "usage",
              usage: {
                inputTokens: inputTokens - cacheReadTokens,
                outputTokens,
                cacheReadTokens,
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
