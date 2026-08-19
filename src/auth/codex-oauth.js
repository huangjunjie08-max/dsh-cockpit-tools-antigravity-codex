import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CODEX_REDIRECT_URI = "http://localhost:1455/auth/callback";
export const CODEX_AUTH_URL = "https://auth.openai.com/oauth/authorize";
export const CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
export const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const CODEX_OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

const CODEX_AUTH_PATH = join(homedir(), ".dsh", "codex-auth.json");

function generatePkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function openBrowser(url) {
  try {
    const command = process.platform === "win32" ? "cmd.exe" : process.platform === "darwin" ? "open" : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
    spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } catch {
    // The URL is also returned through onAuth for environments without a browser.
  }
}

function startCallbackServer(expectedState) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout;
    let resolveCode;
    let rejectCode;
    const codePromise = new Promise((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });

    const finish = (fn) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      fn();
    };

    const server = createServer((req, res) => {
      const url = new URL(req.url || "", CODEX_REDIRECT_URI);
      if (url.pathname !== "/auth/callback") {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Codex OAuth callback route not found.");
        return;
      }

      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (error || !code || state !== expectedState) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Codex authentication failed. You can close this window.");
        finish(() => rejectCode(new Error(error || "Invalid or missing Codex OAuth callback state/code")));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Codex authentication complete. You can close this window and return to DSH.");
      finish(() => resolveCode({ code }));
    });

    server.on("error", reject);
    server.listen(1455, "127.0.0.1", () => {
      timeout = setTimeout(() => {
        finish(() => rejectCode(new Error("Codex OAuth callback timed out waiting for browser login")));
        server.close();
      }, CODEX_OAUTH_TIMEOUT_MS);
      resolve({ server, waitForCode: () => codePromise });
    });
  });
}

function accountIdFromAccessToken(accessToken) {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8"));
    return payload?.["https://api.openai.com/auth"]?.chatgpt_account_id;
  } catch {
    return undefined;
  }
}

export function saveCodexCredentials(credentials) {
  const dir = join(homedir(), ".dsh");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CODEX_AUTH_PATH, JSON.stringify(credentials, null, 2), { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(CODEX_AUTH_PATH, 0o600);
  } catch {
    // Windows does not expose POSIX file modes.
  }
}

export function loadCodexCredentials() {
  if (!existsSync(CODEX_AUTH_PATH)) return null;
  try {
    const credentials = JSON.parse(readFileSync(CODEX_AUTH_PATH, "utf8"));
    if (credentials?.access || credentials?.refresh) return { ...credentials, source: "dsh-codex-auth" };
  } catch {
    // Ignore a missing or partially written local credential file.
  }
  return null;
}

export async function loginCodex(options = {}) {
  const { verifier, challenge } = generatePkce();
  const state = randomBytes(16).toString("hex");
  const { server, waitForCode } = await startCallbackServer(state);

  try {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: CODEX_CLIENT_ID,
      redirect_uri: CODEX_REDIRECT_URI,
      scope: "openid profile email offline_access",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      id_token_add_organizations: "true",
      codex_cli_simplified_flow: "true",
      originator: "dsh-plugin-antigravity",
    });
    const url = `${CODEX_AUTH_URL}?${params.toString()}`;
    if (options.onAuth) options.onAuth({ url, instructions: "Please complete OpenAI Codex sign-in. DSH will capture the callback." });
    else openBrowser(url);

    const { code } = await waitForCode();
    const response = await fetch(CODEX_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CODEX_CLIENT_ID,
        code,
        code_verifier: verifier,
        redirect_uri: CODEX_REDIRECT_URI,
      }).toString(),
    });
    if (!response.ok) throw new Error(`OpenAI Codex token exchange failed: ${await response.text()}`);
    const token = await response.json();
    if (!token.access_token || !token.refresh_token || typeof token.expires_in !== "number") {
      throw new Error("OpenAI Codex token response is missing access_token, refresh_token, or expires_in");
    }

    const credentials = {
      type: "oauth",
      access: token.access_token,
      refresh: token.refresh_token,
      expires: Date.now() + token.expires_in * 1000,
      accountId: accountIdFromAccessToken(token.access_token),
    };
    saveCodexCredentials(credentials);
    return credentials;
  } finally {
    server.close();
  }
}
