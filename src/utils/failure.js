import { redactSecrets } from "./security.js";

const MAX_VISIBLE_FAILURE_CHARS = 1200;

export function* visibleFailureChunks(message, index = 0) {
  const detail = redactSecrets(String(message || "Unknown model request failure"))
    .trim()
    .slice(0, MAX_VISIBLE_FAILURE_CHARS);
  const text = `⚠️ 模型请求失败：${detail}`;

  yield { type: "block-start", index, blockType: "text" };
  yield { type: "text-delta", index, text };
  yield {
    type: "block-end",
    index,
    block: { type: "text", text },
  };
}
