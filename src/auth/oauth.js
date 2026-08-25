import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { defaultProjectId, loadCodeAssist } from "../client/client.js";
import { escapeHtml, antigravityEnv } from "../utils/util.js";
import { resolveCallbackHost, redactSecrets, safeError } from "../utils/security.js";
import { loadCockpitAntigravityAuth } from "./cockpit.js";

export const REDIRECT_URI = "http://localhost:51121/oauth-callback";
export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const OAUTH_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

export const SCOPES = [
  "https://www.googleapis.com/auth/aicode",
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
];

export const CLIENT_ID =
  antigravityEnv("CLIENT_ID") ||
  Buffer.from(
    "MTA3MTAwNjA2MDU5MS10bWhzc2luMmgyMWxjcmUyMzV2dG9sb2poNGc0MDNlc" +
      "C5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbQ==",
    "base64",
  ).toString("utf8");

export const CLIENT_SECRET =
  antigravityEnv("CLIENT_SECRET") ||
  Buffer.from("R09DU1BYLUs1OEZXUjQ" + "4NkxkTEoxbUxCOHNYQzR6NnFEQWY=", "base64").toString("utf8");

export const CALLBACK_HOST = resolveCallbackHost();

function oauthCallbackHeaders(contentType = "text/html; charset=utf-8") {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    "Referrer-Policy": "no-referrer",
  };
}

function base64Url(buffer) {
  return buffer.toString("base64url");
}

function generatePKCE() {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

async function getUserEmail(token) {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return undefined;
    const data = await res.json();
    return data.email;
  } catch {
    return undefined;
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
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, oauthCallbackHeaders("text/plain; charset=utf-8"));
        res.end("Method Not Allowed");
        return;
      }

      const url = new URL(req.url || "", REDIRECT_URI);
      if (url.pathname !== "/oauth-callback") {
        res.writeHead(404, oauthCallbackHeaders());
        res.end("Antigravity OAuth callback route not found.");
        return;
      }

      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (error) {
        const safe = escapeHtml(error.slice(0, 200));
        res.writeHead(400, oauthCallbackHeaders());
        res.end(`Antigravity authentication failed: ${safe}`);
        finish(() => rejectCode(new Error(`OAuth error: ${error.slice(0, 200)}`)));
        return;
      }
      if (!code || !state) {
        res.writeHead(400, oauthCallbackHeaders());
        res.end("Antigravity authentication failed: missing code or state.");
        finish(() => rejectCode(new Error("Missing code or state in OAuth callback")));
        return;
      }
      if (state !== expectedState) {
        res.writeHead(400, oauthCallbackHeaders());
        res.end("Antigravity authentication failed: invalid state.");
        finish(() => rejectCode(new Error("OAuth state mismatch")));
        return;
      }

      res.writeHead(200, oauthCallbackHeaders());
      res.end("Antigravity authentication complete. You can close this window and return to DSH.");
      finish(() => resolveCode({ code, state }));
    });

    server.on("error", reject);
    server.listen(51121, CALLBACK_HOST, () => {
      timeout = setTimeout(() => {
        finish(() => rejectCode(new Error("OAuth callback timed out waiting for browser login")));
        server.close();
      }, OAUTH_CALLBACK_TIMEOUT_MS);
      resolve({ server, waitForCode: () => codePromise });
    });
  });
}

export async function loginAntigravity(options = {}) {
  const { verifier, challenge } = generatePKCE();
  const state = base64Url(randomBytes(32));
  const { server, waitForCode } = await startCallbackServer(state);

  try {
    const authParams = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: "code",
      redirect_uri: REDIRECT_URI,
      scope: SCOPES.join(" "),
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      access_type: "offline",
      prompt: "consent",
    });
    const loginUrl = `${AUTH_URL}?${authParams.toString()}`;

    if (options.onAuth) {
      options.onAuth({
        url: loginUrl,
        instructions: "Please complete Google sign-in. DSH will capture the callback.",
      });
    } else {
      console.log(`\nPlease open the following URL in your browser to sign in with Google:\n\n${loginUrl}\n`);
      try {
        const { exec } = await import("node:child_process");
        const startCmd =
          process.platform === "darwin"
            ? `open "${loginUrl}"`
            : process.platform === "win32"
              ? `start "" "${loginUrl}"`
              : `xdg-open "${loginUrl}"`;
        exec(startCmd);
      } catch {
        // ignore browser launch failure
      }
    }

    const { code, state: returnedState } = await waitForCode();
    if (returnedState !== state) throw new Error("OAuth state mismatch");

    const tokenResponse = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      }).toString(),
    });

    if (!tokenResponse.ok) {
      throw new Error(`Token exchange failed: ${await tokenResponse.text()}`);
    }

    const tokenData = await tokenResponse.json();
    if (!tokenData.refresh_token) {
      throw new Error("No refresh token received. Please re-run login and allow offline access.");
    }

    const [email, discoveredProject] = await Promise.all([
      getUserEmail(tokenData.access_token),
      loadCodeAssist(tokenData.access_token),
    ]);

    const creds = {
      refresh: tokenData.refresh_token,
      access: tokenData.access_token,
      expires: Date.now() + tokenData.expires_in * 1000 - 5 * 60 * 1000,
      projectId: discoveredProject || defaultProjectId(email || "antigravity-default"),
      email,
    };

    saveStoredCredentials(creds);
    return creds;
  } finally {
    server.close();
  }
}

export async function refreshAntigravityToken(refreshToken, existingProjectId) {
  const tokenResponse = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    throw new Error(`Token refresh failed: ${errorText}`);
  }

  const tokenData = await tokenResponse.json();
  const creds = {
    refresh: tokenData.refresh_token || refreshToken,
    access: tokenData.access_token,
    expires: Date.now() + tokenData.expires_in * 1000 - 5 * 60 * 1000,
    projectId: existingProjectId || defaultProjectId(),
  };

  saveStoredCredentials(creds);
  return creds;
}

const PI_AUTH_PATH = join(homedir(), ".pi", "agent", "auth.json");

function getCandidateDshAuthPaths() {
  const candidates = [
    join(homedir(), ".dsh", "antigravity-auth.json"),
    ...(process.env.DSH_HOME
      ? [
          join(process.env.DSH_HOME, "antigravity-auth.json"),
          join(process.env.DSH_HOME, "..", "antigravity-auth.json"),
        ]
      : []),
    ...(process.execPath
      ? [
          join(dirname(process.execPath), "data", "antigravity-auth.json"),
          join(dirname(process.execPath), "data", "home", "antigravity-auth.json"),
        ]
      : []),
  ];
  return [...new Set(candidates.filter(Boolean))];
}

export function loadStoredCredentials() {
  // 1. Prefer the plugin-owned OAuth file in all standard and portable locations
  for (const authPath of getCandidateDshAuthPaths()) {
    if (existsSync(authPath)) {
      try {
        const raw = JSON.parse(readFileSync(authPath, "utf8"));
        if (raw.access || raw.refresh) return { source: "dsh-auth-file", ...raw };
      } catch {}
    }
  }

  // 2. Cockpit Tools OAuth integration (~/.antigravity_cockpit / portable)
  const cockpitAuth = loadCockpitAntigravityAuth();
  if (cockpitAuth && (cockpitAuth.access || cockpitAuth.refresh)) return cockpitAuth;

  // 3. Auto-detect ~/.pi/agent/auth.json (Pi Antigravity login)
  if (existsSync(PI_AUTH_PATH)) {
    try {
      const piAuth = JSON.parse(readFileSync(PI_AUTH_PATH, "utf8"));
      if (piAuth.antigravity && typeof piAuth.antigravity === "object") {
        return {
          source: "pi-agent",
          ...piAuth.antigravity,
        };
      }
    } catch {}
  }

  // 4. Environment variables
  const envToken = process.env.ANTIGRAVITY_TOKEN || process.env.ANTIGRAVITY_ACCESS_TOKEN;
  const envRefresh = process.env.ANTIGRAVITY_REFRESH_TOKEN;
  const envProject = process.env.ANTIGRAVITY_PROJECT_ID;
  if (envToken) {
    return {
      source: "environment",
      access: envToken.trim(),
      refresh: envRefresh?.trim(),
      projectId: envProject?.trim() || defaultProjectId(),
      expires: Date.now() + 3600 * 1000,
    };
  }

  return undefined;
}

export function saveStoredCredentials(creds) {
  for (const targetPath of getCandidateDshAuthPaths()) {
    try {
      const dir = dirname(targetPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(targetPath, JSON.stringify(creds, null, 2), "utf8");
    } catch {}
  }

  try {
    if (existsSync(PI_AUTH_PATH)) {
      const piAuth = JSON.parse(readFileSync(PI_AUTH_PATH, "utf8"));
      piAuth.antigravity = creds;
      writeFileSync(PI_AUTH_PATH, JSON.stringify(piAuth, null, 2), "utf8");
    }
  } catch {}
}

export async function getValidCredentials() {
  let creds = loadStoredCredentials();
  if (!creds || (!creds.access && !creds.refresh)) {
    throw new Error(
      "No Antigravity credentials found from Cockpit Tools or OAuth login. Please run 'node bin/login.js' or login in Cockpit Tools.",
    );
  }

  // If access token is expired or close to expiring (within 2 minutes), refresh it
  const isExpiring = creds.expires && Date.now() >= creds.expires - 2 * 60 * 1000;
  if ((!creds.access || isExpiring) && creds.refresh) {
    try {
      const refreshed = await refreshAntigravityToken(creds.refresh, creds.projectId);
      creds = {
        ...creds,
        ...refreshed,
      };
    } catch (err) {
      if (!creds.access) throw err;
    }
  }

  return creds;
}