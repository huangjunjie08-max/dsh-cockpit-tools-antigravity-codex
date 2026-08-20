export class AntigravityWebFetchProvider {
  id = "antigravity-fetch";

  available() {
    return true;
  }

  async fetch(request, signal) {
    const url = request.url;
    try {
      const response = await fetch(url, {
        signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept":
            "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,application/json;q=0.5,*/*;q=0.3",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
        redirect: "follow",
      });

      const contentType = response.headers.get("content-type") || "";
      const text = await response.text();
      const isHtml =
        contentType.includes("html") ||
        contentType.includes("xhtml") ||
        text.trim().startsWith("<!DOCTYPE") ||
        text.trim().startsWith("<html");

      return {
        url: response.url || url,
        statusCode: response.status,
        body: {
          kind: isHtml ? "html" : "text",
          content: text,
        },
        truncated: false,
      };
    } catch (err) {
      if (err.name === "AbortError" || signal?.aborted) {
        throw err;
      }
      return {
        url,
        statusCode: 500,
        body: {
          kind: "text",
          content: `Error fetching URL: ${err.message}`,
        },
        truncated: false,
      };
    }
  }
}
