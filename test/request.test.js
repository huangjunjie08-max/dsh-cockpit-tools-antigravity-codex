import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAntigravityRequestBody,
  convertDshMessagesToGemini,
  friendlyAntigravityError,
  normalizeAntigravityUsage,
  streamAntigravity,
} from "../src/stream/stream.js";
import { buildCodexRequestBody, resolveCodexAutoEffort } from "../src/stream/codex.js";
import { filterRequestTools, getLastUserText, getRequestToolProfile } from "../src/utils/request.js";
import { ANTIGRAVITY_MODELS, resolveAutoEffort } from "../src/models/antigravity.js";
import { CODEX_MODELS, getCodexContextWindow } from "../src/models/codex.js";
import { streamCodex } from "../src/stream/codex.js";
import { visibleFailureChunks } from "../src/utils/failure.js";
import { normalizeAntigravityModelMetadata } from "../src/adapter.js";

const messages = [
  { role: "system", content: [{ type: "text", text: "Follow repository rules." }] },
  { role: "user", content: [{ type: "text", text: "Implement a small fix." }] },
];

test("Codex keeps system instructions out of user history", () => {
  const body = buildCodexRequestBody({
    model: "gpt-5.6-sol",
    reasoningEffort: "auto",
    system: "Use concise answers.",
    messages,
    tools: [{ name: "pwsh", description: "Run PowerShell", parameters: { type: "object" } }],
  });

  assert.equal(body.instructions, undefined);
  const stableDeveloper = body.input.find((item) => item.role === "developer");
  assert.match(stableDeveloper.content[0].text, /You are a disciplined coding assistant\./);
  assert.deepEqual(stableDeveloper.content[0].prompt_cache_breakpoint, { mode: "explicit" });
  assert.match(body.input.find((item) => item.role === "developer" && item !== stableDeveloper).content[0].text, /Use concise answers\.\n\nFollow repository rules\./);
  const userInput = body.input.find((item) => item.role === "user");
  assert.equal(userInput.content[0].text, "Implement a small fix.");
  assert.equal(body.reasoning.effort, "medium");
  assert.equal(body.reasoning.context, "all_turns");
  assert.equal(body.text.verbosity, "low");
  assert.equal(body.input.some((item) => item.content?.[0]?.text?.includes("System Instruction")), false);
});

test("legacy Auto values resolve to the last fixed effort", () => {
  const history = [
    { role: "user", content: [{ type: "text", text: "Fix the project." }] },
    { role: "assistant", content: [{ type: "tool-call", id: "call_1", name: "pwsh", arguments: "{}" }] },
    { role: "user", content: [{ type: "tool-result", toolCallId: "call_1", content: [{ type: "text", text: "ok" }] }] },
    { role: "user", content: [{ type: "text", text: "Is it fixed?" }] },
  ];

  assert.equal(resolveCodexAutoEffort("gpt-5.6-sol", history, "fixed-effort-session"), "medium");
  assert.equal(resolveCodexAutoEffort("gpt-5.6-sol", history, "fixed-effort-session"), "medium");
  assert.equal(resolveAutoEffort("gemini-3.6-flash", history, "fixed-effort-session"), "medium");
  assert.equal(resolveAutoEffort("gemini-3.6-flash", history, "fixed-effort-session"), "medium");

  const high = buildCodexRequestBody({
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    sessionId: "remembered-effort-session",
    messages: history,
  });
  const remembered = buildCodexRequestBody({
    model: "gpt-5.6-sol",
    reasoningEffort: "auto",
    sessionId: "remembered-effort-session",
    messages: history,
  });
  assert.equal(high.reasoning.effort, "high");
  assert.equal(remembered.reasoning.effort, "high");
  assert.equal(resolveCodexAutoEffort("gpt-5.6-sol", [], "fixed-effort-session"), "medium");
});

test("Codex uses the model catalog effective context window", () => {
  assert.equal(CODEX_MODELS.find((model) => model.id === "gpt-5.6-luna").contextWindow, 272000);
  assert.equal(
    getCodexContextWindow("gpt-5.6-luna", {
      context_window: 272000,
      effective_context_window_percent: 95,
    }),
    258400,
  );
});

test("Antigravity uses runtime context and output limits for every model family", () => {
  const fallback = { contextWindow: 1048576, maxTokens: 65536 };
  assert.deepEqual(
    normalizeAntigravityModelMetadata(fallback, {
      maxTokens: 3145728,
      outputTokenLimit: 131072,
    }),
    { contextWindow: 3145728, maxTokens: 131072 },
  );
  assert.deepEqual(
    normalizeAntigravityModelMetadata({ contextWindow: 250000, maxTokens: 64000 }),
    { contextWindow: 250000, maxTokens: 64000 },
  );
});

test("cache usage keeps the largest compatible read/write counters", () => {
  assert.deepEqual(
    normalizeAntigravityUsage({
      usageMetadata: {
        promptTokenCount: 1200,
        cachedContentTokenCount: 0,
        cacheTokensDetails: { cached_tokens: 900, cache_write_tokens: 40 },
        candidatesTokenCount: 12,
      },
    }),
    {
      inputTokens: 260,
      outputTokens: 12,
      cacheReadTokens: 900,
      cacheWriteTokens: 40,
      reasoningTokens: 0,
    },
  );
});

test("all providers preserve stable tools by default for cache-first hits", () => {
  const tools = [
    { name: "pwsh" },
    { name: "web_search" },
    { name: "viking_search" },
    { name: "modlens_read_image" },
  ];
  // Default mode ("all") keeps all tools stable across turns
  assert.deepEqual(
    filterRequestTools(tools, [{ role: "user", content: [{ type: "text", text: "Fix the bug." }] }]).map((tool) => tool.name),
    ["pwsh", "web_search", "viking_search", "modlens_read_image"],
  );
  assert.equal(getRequestToolProfile(tools, [{ role: "user", content: [{ type: "text", text: "Fix the bug." }] }]), "all");

  // Explicit "coding" mode dynamically filters optional tools
  const originalMode = process.env.DSH_ANTIGRAVITY_TOOL_MODE;
  try {
    process.env.DSH_ANTIGRAVITY_TOOL_MODE = "coding";
    assert.deepEqual(
      filterRequestTools(tools, [{ role: "user", content: [{ type: "text", text: "Fix the bug." }] }]).map((tool) => tool.name),
      ["pwsh"],
    );
    assert.deepEqual(
      filterRequestTools(tools, [{ role: "user", content: [{ type: "text", text: "Search the latest docs online." }] }]).map((tool) => tool.name),
      ["pwsh", "web_search"],
    );
  } finally {
    if (originalMode === undefined) delete process.env.DSH_ANTIGRAVITY_TOOL_MODE;
    else process.env.DSH_ANTIGRAVITY_TOOL_MODE = originalMode;
  }
});

test("tool profiles ignore DSH context and preserve intent after tool results in coding mode", () => {
  const tools = [
    { name: "pwsh" },
    { name: "web_search" },
    { name: "viking_search" },
  ];
  const messages = [
    {
      role: "user",
      source: { kind: "user" },
      content: [{ type: "text", text: "Search the latest docs online." }],
    },
    {
      role: "user",
      source: { kind: "plugin", plugin: "@deepseek-ai/dsh-system-prompt", form: "snapshot", sections: [] },
      content: [{ type: "text", text: "Current runtime context. GitHub is available." }],
    },
    {
      role: "user",
      source: { kind: "plugin", plugin: "skill-catalog", form: "catalog", entries: [] },
      content: [{ type: "text", text: "Search and GitHub skills." }],
    },
    {
      role: "user",
      source: { kind: "tool", callId: "call_1" },
      content: [{ type: "tool-result", toolCallId: "call_1", content: [{ type: "text", text: "Search result" }] }],
    },
  ];

  const originalMode = process.env.DSH_ANTIGRAVITY_TOOL_MODE;
  try {
    process.env.DSH_ANTIGRAVITY_TOOL_MODE = "coding";
    assert.equal(getLastUserText(messages), "Search the latest docs online.");
    assert.equal(getRequestToolProfile(tools, messages), "web");
    assert.deepEqual(filterRequestTools(tools, messages).map((tool) => tool.name), ["pwsh", "web_search"]);
  } finally {
    if (originalMode === undefined) delete process.env.DSH_ANTIGRAVITY_TOOL_MODE;
    else process.env.DSH_ANTIGRAVITY_TOOL_MODE = originalMode;
  }
});

test("Codex keeps stable cache key across turns in default cache-first mode", () => {
  const tools = [
    { name: "pwsh" },
    { name: "web_search" },
  ];
  const codingMessages = [{ role: "user", content: [{ type: "text", text: "Fix the bug." }] }];
  const researchMessages = [{ role: "user", content: [{ type: "text", text: "Search the latest docs online." }] }];

  // Default mode: Cache Key remains stable for the session
  const coding = buildCodexRequestBody({ model: "gpt-5.6-luna", sessionId: "cache-test", messages: codingMessages, tools });
  const research = buildCodexRequestBody({ model: "gpt-5.6-luna", sessionId: "cache-test", messages: researchMessages, tools });
  assert.equal(coding.prompt_cache_key, "dsh-codex:gpt-5.6-luna:cache-test");
  assert.equal(research.prompt_cache_key, "dsh-codex:gpt-5.6-luna:cache-test");
  assert.equal(coding.prompt_cache_key.length <= 64, true);

  // In explicit coding mode, profiles isolate cache entries when tool sets change
  const originalMode = process.env.DSH_ANTIGRAVITY_TOOL_MODE;
  try {
    process.env.DSH_ANTIGRAVITY_TOOL_MODE = "coding";
    const codingDynamic = buildCodexRequestBody({ model: "gpt-5.6-luna", sessionId: "cache-test", messages: codingMessages, tools });
    const researchDynamic = buildCodexRequestBody({ model: "gpt-5.6-luna", sessionId: "cache-test", messages: researchMessages, tools });
    assert.notEqual(codingDynamic.prompt_cache_key, researchDynamic.prompt_cache_key);
  } finally {
    if (originalMode === undefined) delete process.env.DSH_ANTIGRAVITY_TOOL_MODE;
    else process.env.DSH_ANTIGRAVITY_TOOL_MODE = originalMode;
  }
});

test("Codex compacts long cache keys without changing their session scope", () => {
  const body = buildCodexRequestBody({
    model: "gpt-5.6-luna",
    sessionId: "session-".repeat(30),
    messages,
  });

  assert.equal(body.prompt_cache_key.length, 64);
  assert.equal(body.prompt_cache_key.startsWith("dsh:"), true);
});

test("Antigravity keeps DSH system instructions in systemInstruction", () => {
  const body = buildAntigravityRequestBody(
    { model: "gemini-3.7-flash", reasoningEffort: "medium", system: "Keep changes minimal.", messages },
    "project",
    "gemini-3.7-flash-tiered",
  );
  const text = body.request.systemInstruction.parts.map((part) => part.text).join("\n");
  assert.match(text, /Keep changes minimal/);
  assert.equal(body.request.contents.some((content) => content.parts?.some((part) => part.text?.includes("System Instruction"))), false);
});

test("Antigravity drops reasoning from a different model after model switching", () => {
  const messages = [
    { role: "user", content: [{ type: "text", text: "Analyze this." }] },
    {
      role: "assistant",
      source: { kind: "model", provider: "antigravity", model: "gemini-3.6-flash" },
      content: [
        { type: "reasoning", text: "Old Gemini reasoning" },
        { type: "text", text: "Old answer" },
      ],
    },
    { role: "user", content: [{ type: "text", text: "Continue." }] },
  ];

  const switched = buildAntigravityRequestBody(
    { model: "claude-sonnet-4-6", messages },
    "project",
    "claude-sonnet-4-6",
  );
  const switchedParts = switched.request.contents.flatMap((content) => content.parts || []);
  assert.equal(switchedParts.some((part) => part.thought === true), false);
  assert.equal(switchedParts.some((part) => part.text === "Old answer"), true);

  const sameModel = buildAntigravityRequestBody(
    { model: "gemini-3.6-flash", messages },
    "project",
    "gemini-3.6-flash",
  );
  const sameModelParts = sameModel.request.contents.flatMap((content) => content.parts || []);
  assert.equal(sameModelParts.some((part) => part.thought === true && part.text === "Old Gemini reasoning"), true);
});

test("Gemini preserves function-call thought signatures across tool turns", () => {
  const contents = convertDshMessagesToGemini(
    [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            id: "call_1",
            name: "default_api:skill",
            arguments: '{"name":"search"}',
            thoughtSignature: "signature-A",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_1",
            name: "default_api:skill",
            content: [{ type: "text", text: "done" }],
          },
        ],
      },
    ],
    "gemini-3.7-flash",
    "gemini-3.7-flash-tiered",
  );

  assert.equal(contents[0].role, "model");
  assert.equal(contents[0].parts[0].thoughtSignature, "signature-A");
  assert.equal(contents[0].parts[0].functionCall.name, "default_api:skill");
  assert.equal(contents[1].parts[0].functionResponse.name, "default_api:skill");
});

test("Gemini adds the documented legacy signature only for Gemini targets", () => {
  const contents = convertDshMessagesToGemini(
    [
      {
        role: "assistant",
        source: { kind: "model", provider: "antigravity", model: "claude-sonnet-4-6" },
        content: [{ type: "tool-call", id: "call_1", name: "skill", arguments: "{}" }],
      },
    ],
    "gemini-3.7-flash",
    "gemini-3.7-flash-tiered",
  );

  assert.equal(contents[0].parts[0].thoughtSignature, "skip_thought_signature_validator");

  const claudeContents = convertDshMessagesToGemini(
    [
      {
        role: "assistant",
        content: [{ type: "tool-call", id: "call_1", name: "skill", arguments: "{}" }],
      },
    ],
    "claude-sonnet-4-6",
    "claude-sonnet-4-6",
  );
  assert.equal("thoughtSignature" in claudeContents[0].parts[0], false);
});

test("Gemini parses signed function calls as tool calls", async () => {
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.ANTIGRAVITY_BASE_URL;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    if (calls === 1) {
      return { ok: true, json: async () => ({ models: { "gemini-3.7-flash-tiered": {} } }) };
    }

    const payload = [
      `data: ${JSON.stringify({
        response: {
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: { name: "default_api:skill", args: { name: "search" } },
                    thoughtSignature: "signature-A",
                  },
                ],
              },
            },
          ],
        },
      })}`,
      "",
    ].join("\n");
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload));
        controller.close();
      },
    });
    return { ok: true, status: 200, body };
  };
  process.env.ANTIGRAVITY_BASE_URL = "https://signature-test.invalid";

  try {
    const events = [];
    for await (const event of streamAntigravity(
      { model: "gemini-3.7-flash", messages: [] },
      { access: "signature-test", projectId: "signature-project" },
    )) {
      events.push(event);
    }

    const toolCall = events.find((event) => event.type === "block-end" && event.block?.type === "tool-call");
    assert.equal(calls, 2);
    assert.equal(toolCall.block.name, "default_api:skill");
    assert.equal(toolCall.block.thoughtSignature, "signature-A");
    assert.equal(events.at(-1).reason.kind, "tool-calls");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.ANTIGRAVITY_BASE_URL;
    else process.env.ANTIGRAVITY_BASE_URL = originalBaseUrl;
  }
});

test("all selectable thinking levels are fixed", () => {
  const sonnet = ANTIGRAVITY_MODELS.find((model) => model.id === "claude-sonnet-4-6");
  assert.deepEqual(sonnet.reasoning.efforts.map((effort) => effort.id), ["high"]);
  for (const model of [...ANTIGRAVITY_MODELS, ...CODEX_MODELS]) {
    assert.equal(Boolean(model.reasoning?.efforts?.some((effort) => effort.id === "auto")), false, model.id);
  }
});

test("Codex uses previous response continuation when the history prefix is stable", async () => {
  const originalFetch = globalThis.fetch;
  const originalContinuation = process.env.DSH_CODEX_CONTINUATION;
  const requests = [];
  const requestHeaders = [];
  let call = 0;
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    requestHeaders.push(init.headers);
    call += 1;
    const responseId = `resp_${call}`;
    const payload = [
      `data: ${JSON.stringify({ type: "response.created", response: { id: responseId } })}`,
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "ok" })}`,
      `data: ${JSON.stringify({
        type: "response.completed",
        response: {
          id: responseId,
          output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] }],
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      })}`,
      "data: [DONE]",
      "",
    ].join("\n");
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload));
        controller.close();
      },
    });
    return { ok: true, status: 200, body };
  };

  try {
    delete process.env.DSH_CODEX_CONTINUATION;
    const base = {
      provider: "openai-codex",
      model: "gpt-5.6-luna",
      reasoningEffort: "low",
      sessionId: "continuation-test",
      system: "Be concise.",
      signal: undefined,
    };
    for await (const _event of streamCodex({
      ...base,
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    }, { access: "test" })) {}
    for await (const _event of streamCodex({
      ...base,
      messages: [
        { role: "user", content: [{ type: "text", text: "hello" }] },
        { role: "assistant", content: [{ type: "text", text: "ok" }] },
        { role: "user", content: [{ type: "text", text: "next" }] },
      ],
    }, { access: "test" })) {}

    assert.equal(requests.length, 2);
    assert.equal(requestHeaders[0]["OpenAI-Beta"], "responses=experimental");
    assert.equal(requestHeaders[0]["session-id"], "continuation-test");
    assert.notEqual(requestHeaders[0]["x-client-request-id"], requestHeaders[1]["x-client-request-id"]);
    assert.equal(requests[1].previous_response_id, "resp_1");
    assert.deepEqual(requests[1].input, [
      { role: "user", content: [{ type: "input_text", text: "next" }] },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalContinuation === undefined) delete process.env.DSH_CODEX_CONTINUATION;
    else process.env.DSH_CODEX_CONTINUATION = originalContinuation;
  }
});

test("Codex retries with the legacy instruction shape when explicit cache is unsupported", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    if (calls.length === 1) {
      return { ok: false, status: 400, text: async () => "Unsupported parameter: prompt_cache_options" };
    }
    const payload = [
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "ok" })}`,
      `data: ${JSON.stringify({ type: "response.completed", response: { id: "cache-fallback", usage: { input_tokens: 1, output_tokens: 1 } } })}`,
      "data: [DONE]",
      "",
    ].join("\n");
    return {
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(payload));
          controller.close();
        },
      }),
    };
  };

  try {
    for await (const _event of streamCodex({
      model: "gpt-5.6-luna",
      reasoningEffort: "medium",
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    }, { access: "test" })) {}

    assert.equal(calls.length, 2);
    assert.equal(calls[0].prompt_cache_options.mode, "explicit");
    assert.equal(calls[1].prompt_cache_options, undefined);
    assert.match(calls[1].instructions, /You are a disciplined coding assistant\./);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider failures emit visible chat text without exposing secrets", () => {
  const chunks = [...visibleFailureChunks("401 Bearer secret-token")];

  assert.equal(chunks[0].type, "block-start");
  assert.equal(chunks[1].type, "text-delta");
  assert.match(chunks[1].text, /模型请求失败/);
  assert.doesNotMatch(chunks[1].text, /secret-token/);
  assert.equal(chunks[2].block.type, "text");
  assert.equal(chunks[2].block.text, chunks[1].text);
});

test("Gemini API failures emit visible chat text before the terminal error", async () => {
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.ANTIGRAVITY_BASE_URL;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return {
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: { message: "unauthorized" } }),
    };
  };
  process.env.ANTIGRAVITY_BASE_URL = "https://test.invalid";

  try {
    const events = [];
    for await (const event of streamAntigravity(
      { model: "gemini-3.1-flash-lite", messages: [] },
      { access: "test", projectId: "project" },
    )) {
      events.push(event);
    }

    const visible = events.find((event) => event.type === "text-delta");
    const finish = events.at(-1);
    assert.ok(calls > 0);
    assert.match(visible.text, /模型请求失败/);
    assert.match(visible.text, /authentication failed/);
    assert.equal(finish.type, "finish");
    assert.equal(finish.reason.kind, "error");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.ANTIGRAVITY_BASE_URL;
    else process.env.ANTIGRAVITY_BASE_URL = originalBaseUrl;
  }
});

test("Gemini network failures have a useful visible fallback", () => {
  assert.match(friendlyAntigravityError(undefined, ""), /no response from Google/);
});
