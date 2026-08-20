const WEB_TOOLS = new Set(["web_search", "web_fetch", "fetch_content", "get_search_content"]);

export const CODING_INSTRUCTION =
  "You are a disciplined coding assistant. Before editing, clarify ambiguity instead of guessing. " +
  "Stay within the requested scope; preserve exact names and text; reuse existing project components; " +
  "never invent APIs, UI libraries, or speculative changes. Keep responses concise and tool-aware.";

export function normalizePromptText(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

export function canonicalizeJson(value, key) {
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalizeJson(item));
    return key === "required" ? items.slice().sort() : items;
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([entryKey, entryValue]) => [entryKey, canonicalizeJson(entryValue, entryKey)]),
  );
}

function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

export function getLastUserText(messages = []) {
  for (const message of [...messages].reverse()) {
    if (message?.role !== "user") continue;
    if (message.source?.kind && message.source.kind !== "user") continue;
    const text = contentText(message.content).trim();
    if (text) return text;
  }
  return "";
}

export function getSystemInstruction(system, messages = []) {
  const parts = [normalizePromptText(contentText(system))];
  for (const message of messages) {
    if (message?.role === "system") {
      const text = normalizePromptText(contentText(message.content));
      if (text) parts.push(text);
    }
  }
  return [...new Set(parts.filter(Boolean))].join("\n\n");
}

function hasImage(messages = []) {
  return messages.some((message) =>
    (message?.content || []).some((block) => block?.type === "image"),
  );
}

function wantsWeb(text) {
  return /\b(search|browse|lookup|look up|latest|current|news|online|internet|url|website|github|联网|搜索|查找|最新|当前|网页|网址|GitHub)\b/i.test(
    text,
  );
}

function wantsMemory(text) {
  return /\b(memory|remember|recall|forget|decision|记忆|记住|回忆|忘记|历史决策)\b/i.test(text);
}

export function getRequestToolProfile(tools, messages = []) {
  if (!Array.isArray(tools) || tools.length === 0) return "none";

  const mode = (process.env.DSH_ANTIGRAVITY_TOOL_MODE || "coding").trim().toLowerCase();
  if (mode === "all") return "all";

  const lastText = getLastUserText(messages);
  const profiles = [];
  if (mode === "research" || wantsWeb(lastText)) profiles.push("web");
  if (mode === "memory" || wantsMemory(lastText)) profiles.push("memory");
  if (mode === "vision" || hasImage(messages)) profiles.push("vision");
  return profiles.length > 0 ? profiles.join("+") : "coding";
}

export function filterRequestTools(tools, messages = []) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;

  const mode = (process.env.DSH_ANTIGRAVITY_TOOL_MODE || "coding").trim().toLowerCase();
  if (mode === "all") return tools;

  const profile = new Set(getRequestToolProfile(tools, messages).split("+"));

  return tools.filter((tool) => {
    const name = String(tool?.name || "").toLowerCase();
    if (name.startsWith("viking_") || name.startsWith("hindsight_")) return profile.has("memory");
    if (WEB_TOOLS.has(name)) return profile.has("web");
    if (name === "modlens_read_image") return profile.has("vision");
    return true;
  });
}
