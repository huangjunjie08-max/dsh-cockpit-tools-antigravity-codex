import assert from "node:assert/strict";
import test from "node:test";
import { buildAntigravityRequestBody } from "../src/stream/stream.js";
import { buildCodexRequestBody, resolveCodexAutoEffort } from "../src/stream/codex.js";
import { filterRequestTools } from "../src/utils/request.js";
import { ANTIGRAVITY_MODELS, resolveAutoEffort } from "../src/models/antigravity.js";
import { streamCodex } from "../src/stream/codex.js";

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

  assert.equal(body.instructions, "Use concise answers.\n\nFollow repository rules.");
  assert.equal(body.input[0].role, "user");
  assert.equal(body.input[0].content[0].text, "Implement a small fix.");
  assert.equal(body.reasoning.effort, "medium");
  assert.equal(body.reasoning.context, "all_turns");
  assert.equal(body.text.verbosity, "low");
  assert.equal(body.input.some((item) => item.content?.[0]?.text?.includes("System Instruction")), false);
});

test("Codex Auto does not stay high after an old tool result", () => {
  const history = [
    { role: "user", content: [{ type: "text", text: "Fix the project." }] },
    { role: "assistant", content: [{ type: "tool-call", id: "call_1", name: "pwsh", arguments: "{}" }] },
    { role: "user", content: [{ type: "tool-result", toolCallId: "call_1", content: [{ type: "text", text: "ok" }] }] },
    { role: "user", content: [{ type: "text", text: "Is it fixed?" }] },
  ];

  assert.equal(resolveCodexAutoEffort("gpt-5.6-sol", history), "low");
  assert.equal(resolveAutoEffort("gemini-3.6-flash", history), "low");
});

test("all providers hide optional tools during coding turns", () => {
  const tools = [
    { name: "pwsh" },
    { name: "web_search" },
    { name: "viking_search" },
    { name: "modlens_read_image" },
  ];
  assert.deepEqual(
    filterRequestTools(tools, [{ role: "user", content: [{ type: "text", text: "Fix the bug." }] }]).map((tool) => tool.name),
    ["pwsh"],
  );
  assert.deepEqual(
    filterRequestTools(tools, [{ role: "user", content: [{ type: "text", text: "Search the latest docs online." }] }]).map((tool) => tool.name),
    ["pwsh", "web_search"],
  );
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

test("Claude Sonnet exposes only Auto and High thinking levels", () => {
  const sonnet = ANTIGRAVITY_MODELS.find((model) => model.id === "claude-sonnet-4-6");
  assert.deepEqual(sonnet.reasoning.efforts.map((effort) => effort.id), ["auto", "high"]);
});

test("Codex uses previous response continuation when the history prefix is stable", async () => {
  const originalFetch = globalThis.fetch;
  const originalContinuation = process.env.DSH_CODEX_CONTINUATION;
  const requests = [];
  let call = 0;
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
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
