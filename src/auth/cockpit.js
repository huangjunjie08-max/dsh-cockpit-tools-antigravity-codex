import { createDecipheriv } from "node:crypto";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { defaultProjectId } from "../client/client.js";

const COCKPIT_DIR = join(homedir(), ".antigravity_cockpit");

export function hasCockpitTools() {
  return existsSync(COCKPIT_DIR);
}

export function loadCockpitAntigravityAuth() {
  if (!existsSync(COCKPIT_DIR)) return null;

  const keyPath = join(COCKPIT_DIR, "secure-account-storage.key");
  if (!existsSync(keyPath)) return null;

  let key;
  try {
    key = Buffer.from(readFileSync(keyPath, "utf8").trim(), "base64");
  } catch {
    return null;
  }

  const accountsJsonPath = join(COCKPIT_DIR, "accounts.json");
  let currentId = null;
  let accountList = [];
  if (existsSync(accountsJsonPath)) {
    try {
      const data = JSON.parse(readFileSync(accountsJsonPath, "utf8"));
      currentId = data.current_account_id;
      accountList = data.accounts || [];
    } catch {
      // ignore
    }
  }

  const accountsDir = join(COCKPIT_DIR, "accounts");
  if (!existsSync(accountsDir)) return null;

  const files = readdirSync(accountsDir).filter(
    (f) => f.endsWith(".json") && !f.endsWith(".bak"),
  );
  if (files.length === 0) return null;

  // Find target file based on current_account_id or most recently used/modified
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
          mtime = statSync(join(accountsDir, f)).mtimeMs;
        } catch {
          // ignore
        }
        return { file: f, lastUsed: item?.last_used || 0, mtime };
      })
      .sort((a, b) => (b.lastUsed || b.mtime) - (a.lastUsed || a.mtime));
    targetFile = sorted[0]?.file;
  }

  if (!targetFile) return null;

  try {
    const raw = JSON.parse(readFileSync(join(accountsDir, targetFile), "utf8"));
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

    if (parsed.token?.access_token) {
      const expiresAt = parsed.token.expiry_timestamp
        ? parsed.token.expiry_timestamp * 1000
        : Date.now() + (parsed.token.expires_in || 3600) * 1000;

      return {
        source: "cockpit-tools",
        accountId: parsed.id,
        email: parsed.email,
        name: parsed.name,
        access: parsed.token.access_token,
        refresh: parsed.token.refresh_token,
        expires: expiresAt,
        projectId: parsed.projectId || parsed.project_id || defaultProjectId(parsed.email || "antigravity-default"),
      };
    }
  } catch (err) {
    // decryption failed or corrupted
  }

  return null;
}

export function listCockpitAccounts() {
  if (!existsSync(COCKPIT_DIR)) return [];
  const accountsJsonPath = join(COCKPIT_DIR, "accounts.json");
  if (!existsSync(accountsJsonPath)) return [];
  try {
    const data = JSON.parse(readFileSync(accountsJsonPath, "utf8"));
    return data.accounts || [];
  } catch {
    return [];
  }
}
