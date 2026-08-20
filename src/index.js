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

  // 1. Always register Antigravity adapter (Gemini & Claude)
  try {
    ctx.llm.registerAdapter([ANTIGRAVITY_PROVIDER_ID], adapter);
    ctx.logger?.info?.(
      `[dsh-plugin-antigravity] Registered provider: ${ANTIGRAVITY_PROVIDER_ID}`,
    );
  } catch (err) {
    ctx.logger?.warn?.(
      `[dsh-plugin-antigravity] Failed to register ${ANTIGRAVITY_PROVIDER_ID}: ${err.message}`,
    );
  }

  // 2. Safely register OpenAI Codex adapter only if not already owned by built-in dsh-codex-connect
  const existingProviders = new Set((ctx.llm?.listProviders?.() || []).map((p) => p?.id));
  const hasCodexConflict = existingProviders.has(CODEX_PROVIDER_ID);

  if (!hasCodexConflict) {
    try {
      ctx.llm.registerAdapter([CODEX_PROVIDER_ID], adapter);
      ctx.logger?.info?.(
        `[dsh-plugin-antigravity] Registered provider: ${CODEX_PROVIDER_ID}`,
      );
    } catch (err) {
      ctx.logger?.info?.(
        `[dsh-plugin-antigravity] Skipped registering ${CODEX_PROVIDER_ID} (coexisting with built-in/external Codex adapter): ${err.message}`,
      );
    }
  } else {
    ctx.logger?.info?.(
      `[dsh-plugin-antigravity] Provider ${CODEX_PROVIDER_ID} already registered by external plugin. Coexisting peacefully.`,
    );
  }

  // 3. Declare configurable providers in DSH directory
  try {
    const configurableProviders = [
      {
        provider: ANTIGRAVITY_PROVIDER_ID,
        displayName: ANTIGRAVITY_PROVIDER_NAME,
        settingsNs: "llm-antigravity",
        settingsPath: [],
        declared: false,
      },
    ];
    if (!hasCodexConflict) {
      configurableProviders.push({
        provider: CODEX_PROVIDER_ID,
        displayName: CODEX_PROVIDER_NAME,
        settingsNs: "llm-codex",
        settingsPath: [],
        declared: false,
      });
    }
    ctx.llm.declareConfigurableProviders(configurableProviders);
  } catch {
    // ignore
  }

  // 4. Register Web Fetch Provider
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
