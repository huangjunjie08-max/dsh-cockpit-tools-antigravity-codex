const WEB_TOOLS = new Set(["web_search", "web_fetch", "fetch_content", "get_search_content"]);

function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

export function getLastUserText(messages = []) {
  const lastUser = [...messages].reverse().find((message) => message?.role === "user");
  return contentText(lastUser?.content).trim();
}

export function getSystemInstruction(system, messages = []) {
  const parts = [contentText(system).trim()];
  for (const message of messages) {
    if (message?.role === "system") {
      const text = contentText(message.content).trim();
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

export function filterRequestTools(tools, messages = []) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;

  const mode = (process.env.DSH_ANTIGRAVITY_TOOL_MODE || "coding").trim().toLowerCase();
  if (mode === "all") return tools;

  const lastText = getLastUserText(messages);
  const allowWeb = mode === "research" || wantsWeb(lastText);
  const allowMemory = mode === "memory" || wantsMemory(lastText);
  const allowImage = mode === "vision" || hasImage(messages);

  return tools.filter((tool) => {
    const name = String(tool?.name || "").toLowerCase();
    if (name.startsWith("viking_") || name.startsWith("hindsight_")) return allowMemory;
    if (WEB_TOOLS.has(name)) return allowWeb;
    if (name === "modlens_read_image") return allowImage;
    return true;
  });
}
