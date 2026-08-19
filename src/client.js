window.__ModuleLoader__.load({
  id: "dsh-plugin-antigravity",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require("react");

    const oauthStatusSchema = {
      parse(value) {
        if (!value || typeof value !== "object") throw new TypeError("OAuth status must be an object");
        for (const provider of ["antigravity", "codex"]) {
          const state = value[provider];
          if (!state || typeof state.loggedIn !== "boolean" || typeof state.source !== "string") {
            throw new TypeError(`OAuth status for ${provider} is invalid`);
          }
        }
        return value;
      },
    };
    const TYPERT_REMOTE = {
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

    function errorMessage(response) {
      return response?.error?.message || "OAuth 操作失败";
    }

    function OAuthSettingsSection({ close }) {
      const api = OAuthSettingsSection.api;
      const [status, setStatus] = React.useState(null);
      const [busy, setBusy] = React.useState("");
      const [error, setError] = React.useState("");

      const refresh = React.useCallback(async () => {
        setError("");
        try {
          const response = await api.status();
          if (!response.ok) throw new Error(errorMessage(response));
          setStatus(response.value);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }, [api]);

      React.useEffect(() => {
        void refresh();
      }, [refresh]);

      const login = async (provider, method) => {
        setBusy(provider);
        setError("");
        try {
          const response = await api[method]();
          if (!response.ok) throw new Error(errorMessage(response));
          setStatus(response.value);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          setBusy("");
        }
      };

      const row = (provider, title, method) => {
        const item = status?.[provider];
        const loggedIn = item?.loggedIn === true;
        return React.createElement(
          "div",
          { key: provider, style: styles.card },
          React.createElement("div", { style: styles.row },
            React.createElement("strong", null, title),
            React.createElement("span", { role: "status", style: loggedIn ? styles.ok : styles.muted }, loggedIn ? "已登录" : "未登录")),
          React.createElement("div", { style: styles.source }, `保存来源：${item?.source || "读取中…"}`),
          React.createElement("button", {
            type: "button",
            disabled: Boolean(busy),
            onClick: () => void login(provider, method),
            style: styles.button,
          }, busy === provider ? "登录中…" : `登录 ${title} OAuth`),
        );
      };

      return React.createElement(
        "div",
        { style: styles.section },
        React.createElement("h2", { style: styles.heading }, "OAuth"),
        React.createElement("p", { style: styles.intro }, "登录信息保存在本机，前端只显示状态和保存来源，不显示令牌。"),
        row("antigravity", "Google Antigravity", "loginAntigravity"),
        row("codex", "Codex", "loginCodex"),
        error ? React.createElement("p", { role: "alert", style: styles.error }, error) : null,
        React.createElement("button", { type: "button", onClick: close, style: styles.close }, "关闭"),
      );
    }

    const styles = {
      section: { maxWidth: 620, padding: "8px 0 28px" },
      heading: { margin: "0 0 8px", fontSize: 20 },
      intro: { color: "var(--dsw-alias-label-secondary)", fontSize: 13, lineHeight: 1.6, margin: "0 0 18px" },
      card: { border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 10, marginBottom: 12, padding: 14 },
      row: { alignItems: "center", display: "flex", justifyContent: "space-between", gap: 12 },
      source: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12, margin: "8px 0 12px" },
      ok: { color: "var(--dsw-alias-label-success, #188038)", fontSize: 12 },
      muted: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12 },
      button: { border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 7, cursor: "pointer", padding: "7px 10px" },
      error: { color: "var(--dsw-alias-label-error, #c5221f)", fontSize: 13, marginTop: 14 },
      close: { background: "none", border: 0, color: "var(--dsw-alias-label-secondary)", cursor: "pointer", marginTop: 10, padding: "6px 0" },
    };

    const inject = ["slots", "remote"];
    async function apply(ctx) {
      const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE);
      OAuthSettingsSection.api = ctx.get("remote.antigravityOAuth");
      const disposeSection = ctx.slots.inject("settings.section", () => ctx.slots.register({
        name: "settings.section",
        id: "oauth",
        order: 25,
        label: () => "oauth",
      }, OAuthSettingsSection));
      return async () => {
        disposeSection();
        await disposeRemote();
      };
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
