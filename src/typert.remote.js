import { z } from "zod";

const authStateSchema = z.object({
  loggedIn: z.boolean(),
  source: z.string(),
});
const oauthStatusSchema = z.object({
  antigravity: authStateSchema,
  codex: authStateSchema,
});

export const TYPERT_REMOTE = {
  package: "dsh-plugin-antigravity",
  descriptors: ["status", "loginAntigravity", "loginCodex"].map((method) => ({
    id: `dsh-plugin-antigravity#antigravityOAuth/${method}`,
    service: "antigravityOAuth",
    namespace: "antigravityOAuth",
    method,
    invocation: { kind: "direct" },
    parameters: [],
    result: {
      mode: "strict",
      typeSymbol: "dsh-plugin-antigravity/types#OAuthStatus",
      schema: oauthStatusSchema,
    },
  })),
};

export default TYPERT_REMOTE;
