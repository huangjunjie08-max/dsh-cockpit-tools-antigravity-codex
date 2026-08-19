import { Service } from "@deepseek-ai/cordis";
import { loginAntigravity, loadStoredCredentials } from "./auth/oauth.js";
import { loginCodex } from "./auth/codex-oauth.js";
import { loadCockpitCodexAuth } from "./auth/cockpit-codex.js";

const SOURCE_LABELS = {
  "cockpit-tools": "Cockpit Tools",
  "cockpit-codex-accounts": "Cockpit Tools",
  "codex-data-auth": "Codex",
  "pi-agent": "Pi",
  "pi-auth": "Pi",
  "environment": "环境变量",
  "dsh-auth-file": "插件本地 OAuth",
  "dsh-codex-auth": "插件本地 OAuth",
};

function summarize(credentials) {
  return {
    loggedIn: Boolean(credentials?.access || credentials?.refresh),
    source: credentials ? SOURCE_LABELS[credentials.source] || credentials.source || "未知" : "未配置",
  };
}

export function readOAuthStatus() {
  return {
    antigravity: summarize(loadStoredCredentials()),
    codex: summarize(loadCockpitCodexAuth()),
  };
}

export class AntigravityOAuthService extends Service {
  constructor(ctx) {
    super(ctx, "antigravityOAuth");
    this.typertRemote = Object.freeze({ service: this, serviceKey: this.name, namespace: "antigravityOAuth" });
  }

  status() {
    return readOAuthStatus();
  }

  async loginAntigravity() {
    await loginAntigravity();
    return this.status();
  }

  async loginCodex() {
    await loginCodex();
    return this.status();
  }
}
