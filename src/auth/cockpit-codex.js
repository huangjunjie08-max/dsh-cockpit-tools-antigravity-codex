import { createDecipheriv } from "node:crypto";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadCodexCredentials, saveCodexCredentials } from "./codex-oauth.js";

function getCandidateCockpitDirs() {
  const candidates = [
    join(homedir(), ".antigravity_cockpit"),
    ...(process.env.DSH_HOME
      ? [join(process.env.DSH_HOME, "..", "antigravity_cockpit"), join(process.env.DSH_HOME, "antigravity_cockpit")]
      : []),
    "D:\\app\\DSH Desktop 2.0.2\\data\\antigravity_cockpit",
  ];
  return [...new Set(candidates)].filter((d) => existsSync(d));
}

const CODEX_HOME = process.env.CODEX_HOME || join(homedir(), ".codex");
const CODEX_DATA_AUTH = join(CODEX_HOME, "auth.json");
const PI_AUTH_PATH = join(homedir(), ".pi", "agent", "auth.json");

const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token";

function loadCodexFromDir(cockpitDir) {
  const keyPath = join(cockpitDir, "secure-account-storage.key");
  const codexAccountsJson = join(cockpitDir, "codex_accounts.json");
  const codexDir = join(cockpitDir, "codex_accounts");

  if (!existsSync(keyPath) || !existsSync(codexDir)) return null;

  try {
    const key = Buffer.from(readFileSync(keyPath, "utf8").trim(), "base64");
    let currentId = null;
    let accountList = [];

    if (existsSync(codexAccountsJson)) {
      try {
        const data = JSON.parse(readFileSync(codexAccountsJson, "utf8"));
        currentId = data.current_account_id;
        accountList = data.accounts || [];
      } catch {}
    }

    const files = readdirSync(codexDir).filter(
      (f) => f.endsWith(".json") && !f.endsWith(".bak"),
    );
    if (files.length === 0) return null;

    let targetFile = null;
    if (currentId) {
      const matched = files.find((f) => f === `${currentId}.json`);
      if (matched) targetFile = matched;
    }
    if (!targetFile) {
      const sorted = files
        .map((f) => {
          const id = f.replace(".json", "");
          const item = accountList.find((a) => a.id === id);
          let mtime = 0;
          try {
            mtime = statSync(join(codexDir, f)).mtimeMs;
          } catch {}
          return { file: f, lastUsed: item?.last_used || 0, mtime };
        })
        .sort((a, b) => (b.lastUsed || b.mtime) - (a.lastUsed || a.mtime));
      targetFile = sorted[0]?.file;
    }

    if (!targetFile) return null;

    const raw = JSON.parse(readFileSync(join(codexDir, targetFile), "utf8"));
    const nonce = Buffer.from(raw.nonce, "base64");
    const ciphertextAndTag = Buffer.from(raw.ciphertext, "base64");
    const tag = ciphertextAndTag.subarray(ciphertextAndTag.length - 16);
    const ciphertext = ciphertextAndTag.subarray(0, ciphertextAndTag.length - 16);

    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      "utf8",
    );
    const parsed = JSON.parse(decrypted);

    if (parsed.tokens?.access_token) {
      const expiresAt = parsed.tokens.expires_at
        ? parsed.tokens.expires_at * 1000
        : Date.now() + 3600 * 1000;

      return {
        source: "cockpit-tools",
        accountId: parsed.id,
        email: parsed.email,
        name: parsed.name,
        access: parsed.tokens.access_token,
        refresh: parsed.tokens.refresh_token,
        expires: expiresAt,
        accountIdToken: parsed.tokens.account_id,
      };
    }
  } catch {}
  return null;
}

export function loadCockpitCodexAuth() {
  const localAuth = loadCodexCredentials();
  if (localAuth) return localAuth;

  for (const dir of getCandidateCockpitDirs()) {
    const auth = loadCodexFromDir(dir);
    if (auth) return auth;
  }

  if (existsSync(CODEX_DATA_AUTH)) {
    try {
      const raw = JSON.parse(readFileSync(CODEX_DATA_AUTH, "utf8"));
      if (raw.tokens?.access_token) {
        return {
          source: "codex-auth-file",
          access: raw.tokens.access_token,
          refresh: raw.tokens.refresh_token,
          expires: (raw.tokens.expires_at || 0) * 1000 || Date.now() + 3600 * 1000,
          accountIdToken: raw.tokens.account_id,
          email: raw.email,
        };
      }
    } catch {}
  }

  if (existsSync(PI_AUTH_PATH)) {
    try {
      const piAuth = JSON.parse(readFileSync(PI_AUTH_PATH, "utf8"));
      if (piAuth.codex && typeof piAuth.codex === "object") {
        return {
          source: "pi-agent-codex",
          ...piAuth.codex,
        };
      }
    } catch {}
  }

  return null;
}

export async function refreshCodexToken(refreshToken) {
  const response = await fetch(OPENAI_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: OPENAI_CLIENT_ID,
    }).toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI Codex token refresh failed: ${text}`);
  }

  const json = await response.json();
  return {
    access: json.access_token,
    refresh: json.refresh_token || refreshToken,
    expires: Date.now() + (json.expires_in || 3600) * 1000,
  };
}

export async function getValidCodexCredentials() {
  let creds = loadCockpitCodexAuth();
  if (!creds || !creds.access) {
    throw new Error("No OpenAI Codex credentials found from this plugin, Cockpit Tools, Codex, or Pi.");
  }

  if (creds.expires && Date.now() >= creds.expires - 2 * 60 * 1000 && creds.refresh) {
    try {
      const refreshed = await refreshCodexToken(creds.refresh);
      creds = { ...creds, ...refreshed };
      if (creds.source === "dsh-codex-auth") saveCodexCredentials(creds);
    } catch (error) {
      if (!creds.access) throw error;
    }
  }

  return creds;
}
