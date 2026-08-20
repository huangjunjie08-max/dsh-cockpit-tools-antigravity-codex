import { AntigravityAndCodexLlmAdapter } from "./adapter.js";
import {
  ANTIGRAVITY_PROVIDER_ID,
  ANTIGRAVITY_PROVIDER_NAME,
  ANTIGRAVITY_MODELS,
} from "./models/antigravity.js";
import {
  CODEX_PROVIDER_ID,
  CODEX_PROVIDER_NAME,
  CODEX_MODELS,
} from "./models/codex.js";
import { loginAntigravity, getValidCredentials, loadStoredCredentials } from "./auth/oauth.js";
import { loadCockpitCodexAuth, getValidCodexCredentials } from "./auth/cockpit-codex.js";
import { loginCodex } from "./auth/codex-oauth.js";
import { AntigravityOAuthService, readOAuthStatus } from "./oauth-service.js";
import { AntigravityWebFetchProvider } from "./web/fetch.js";

export const name = "dsh-plugin-antigravity";
export const inject = ["llm"];

export function apply(ctx, config = {}) {
  new AntigravityOAuthService(ctx);
  const adapter = new AntigravityAndCodexLlmAdapter();
  const routes = [ANTIGRAVITY_PROVIDER_ID, CODEX_PROVIDER_ID];

  // 1. Register LLM adapter for Antigravity and Codex
  try {
    ctx.llm.registerAdapter(routes, adapter);
    ctx.logger?.info?.(
      `[dsh-plugin-antigravity] Registered providers: ${routes.join(", ")}`,
    );
  } catch (err) {
    ctx.logger?.warn?.(
      `[dsh-plugin-antigravity] Failed to register adapter: ${err.message}`,
    );
  }

  // 2. Declare configurable providers in DSH directory
  try {
    ctx.llm.declareConfigurableProviders([
      {
        provider: ANTIGRAVITY_PROVIDER_ID,
        displayName: ANTIGRAVITY_PROVIDER_NAME,
        settingsNs: "llm-antigravity",
        settingsPath: [],
        declared: false,
      },
      {
        provider: CODEX_PROVIDER_ID,
        displayName: CODEX_PROVIDER_NAME,
        settingsNs: "llm-codex",
        settingsPath: [],
        declared: false,
      },
    ]);
  } catch {
    // ignore
  }

  // 3. Register Web Fetch Provider
  try {
    const web = ctx.get ? ctx.get("web", false) : ctx.web;
    if (web && typeof web.registerFetchProvider === "function") {
      web.registerFetchProvider(new AntigravityWebFetchProvider());
      ctx.logger?.info?.(
        "[dsh-plugin-antigravity] Registered WebFetchProvider: antigravity-fetch",
      );
    }
  } catch (err) {
    ctx.logger?.warn?.(
      `[dsh-plugin-antigravity] Failed to register WebFetchProvider: ${err.message}`,
    );
  }
}

export {
  AntigravityAndCodexLlmAdapter,
  AntigravityWebFetchProvider,
  ANTIGRAVITY_MODELS,
  CODEX_MODELS,
  ANTIGRAVITY_PROVIDER_ID,
  CODEX_PROVIDER_ID,
  loginAntigravity,
  loginCodex,
  getValidCredentials,
  loadStoredCredentials,
  loadCockpitCodexAuth,
  getValidCodexCredentials,
  AntigravityOAuthService,
  readOAuthStatus,
};
