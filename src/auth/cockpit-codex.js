import { createDecipheriv } from "node:crypto";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadCodexCredentials, saveCodexCredentials } from "./codex-oauth.js";

const COCKPIT_DIR = join(homedir(), ".antigravity_cockpit");
const CODEX_DATA_AUTH = "D:\\apps\\CodexData\\.codex\\auth.json";
const PI_AUTH_PATH = join(homedir(), ".pi", "agent", "auth.json");

const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token";

export function loadCockpitCodexAuth() {
  // 1. Prefer the plugin-owned OAuth file so Cockpit Tools is optional.
  const localAuth = loadCodexCredentials();
  if (localAuth) return localAuth;

  // 2. Try ~/.antigravity_cockpit/codex_accounts
  if (existsSync(COCKPIT_DIR)) {
    const keyPath = join(COCKPIT_DIR, "secure-account-storage.key");
    const codexAccountsJson = join(COCKPIT_DIR, "codex_accounts.json");
    const codexDir = join(COCKPIT_DIR, "codex_accounts");

    if (existsSync(keyPath) && existsSync(codexDir)) {
      try {
        const key = Buffer.from(readFileSync(keyPath, "utf8").trim(), "base64");
        let currentId = null;
        let accountList = [];

        if (existsSync(codexAccountsJson)) {
          try {
            const data = JSON.parse(readFileSync(codexAccountsJson, "utf8"));
            currentId = data.current_account_id;
            accountList = data.accounts || [];
          } catch {
            // ignore
          }
        }

        const files = readdirSync(codexDir).filter(
          (f) => f.endsWith(".json") && !f.endsWith(".bak"),
        );

        if (files.length > 0) {
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
                } catch {
                  // ignore
                }
                return { file: f, lastUsed: item?.last_used || 0, mtime };
              })
              .sort((a, b) => (b.lastUsed || b.mtime) - (a.lastUsed || a.mtime));
            targetFile = sorted[0]?.file;
          }

          if (targetFile) {
            const raw = JSON.parse(readFileSync(join(codexDir, targetFile), "utf8"));
            const nonce = Buffer.from(raw.nonce, "base64");
            const ciphertextAndTag = Buffer.from(raw.ciphertext, "base64");
            const tag = ciphertextAndTag.subarray(ciphertextAndTag.length - 16);
            const ciphertext = ciphertextAndTag.subarray(0, ciphertextAndTag.length - 16);

            const decipher = createDecipheriv("aes-256-gcm", key, nonce);
            decipher.setAuthTag(tag);
            const decrypted = Buffer.concat([
              decipher.update(ciphertext),
              decipher.final(),
            ]).toString("utf8");
            const parsed = JSON.parse(decrypted);

            if (parsed.tokens?.access_token) {
              return {
                source: "cockpit-codex-accounts",
                accountId: parsed.id,
                email: parsed.email,
                planType: parsed.plan_type,
                access: parsed.tokens.access_token,
                refresh: parsed.tokens.refresh_token,
                idToken: parsed.tokens.id_token,
                expires: Date.now() + 3600 * 1000,
              };
            }
          }
        }
      } catch (err) {
        // ignore decryption error
      }
    }
  }

  // 3. Try CodexData/.codex/auth.json
  if (existsSync(CODEX_DATA_AUTH)) {
    try {
      const data = JSON.parse(readFileSync(CODEX_DATA_AUTH, "utf8"));
      if (data.tokens?.access_token) {
        return {
          source: "codex-data-auth",
          accountId: data.tokens.account_id,
          access: data.tokens.access_token,
          refresh: data.tokens.refresh_token,
          idToken: data.tokens.id_token,
          expires: Date.now() + 3600 * 1000,
        };
      }
    } catch {
      // ignore
    }
  }

  // 4. Try Pi auth.json
  if (existsSync(PI_AUTH_PATH)) {
    try {
      const data = JSON.parse(readFileSync(PI_AUTH_PATH, "utf8"));
      const codex = data["openai-codex"] || data.codex;
      if (codex?.access) {
        return {
          source: "pi-auth",
          accountId: codex.accountId,
          access: codex.access,
          refresh: codex.refresh,
          expires: codex.expires || Date.now() + 3600 * 1000,
        };
      }
    } catch {
      // ignore
    }
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
