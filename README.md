# dsh-plugin-antigravity (with Cockpit Tools Integration)

**Google Antigravity & OpenAI Codex Provider Plugin for DeepSeek Harness (DSH)**

本插件让 **DeepSeek Harness (`dsh`)** 直接集成 **Google Antigravity** 与 **OpenAI Codex** 全系列模型，完全支持 **Cockpit Tools** 本地安全 OAuth 凭据自动读取与实时同步（免二次登录），并支持**按模型精准配置推理等级（Reasoning Efforts）**。

---

## ✨ 核心特性

### 1. 完整获取 Antigravity 全量模型（含动态探测）
- **动态探测与静态全景支持**：不仅内置静态模型目录，还会自动调用 Antigravity 后端 `/v1internal:fetchAvailableModels` 获取云端实时上架的所有模型（共 20+ 个）。
- **包含模型**：
  - `antigravity/gemini-3.7-flash` (Gemini 3.7 Flash)
  - `antigravity/gemini-3.6-flash` (Gemini 3.6 Flash)
  - `antigravity/gemini-3.5-flash` (Gemini 3.5 Flash)
  - `antigravity/gemini-3.1-pro` (Gemini 3.1 Pro / Agent)
  - `antigravity/gemini-3.1-flash-lite` (Gemini 3.1 Flash Lite)
  - `antigravity/claude-sonnet-4-6` (Claude Sonnet 4.6 / Claude 3.7 Sonnet)
  - `antigravity/claude-opus-4-6` (Claude Opus 4.6)
  - `antigravity/gpt-oss-120b` (GPT-OSS 120B)
  - 以及所有实时动态发现的后端模型

### 2. Cockpit Tools OAuth 双平台自动同步（免二次登录）
- **Cockpit Antigravity 自动同步**：自动解密 `~/.antigravity_cockpit/accounts/`，随 Cockpit 账号切换而实时热更新。
- **Cockpit OpenAI Codex 自动同步**：自动解密 `~/.antigravity_cockpit/codex_accounts/` 以及 `D:\apps\CodexData\.codex\auth.json`，在 DSH 中直接提供 `openai-codex` 路由。
  - 支持 `openai-codex/gpt-5.6-sol`、`openai-codex/gpt-5.6-terra`、`openai-codex/gpt-5.6-luna`、`openai-codex/o3-mini`、`openai-codex/o1`、`openai-codex/gpt-4o`。

### 3. 按模型精准配置推理等级（Reasoning Effort）
- **告别 DeepSeek 默认单一档位**：不同模型支持的思考档位不同，本插件在 `resolveModel` 时会向 DSH UI 动态返回该模型专属的合法推理档位：
  - **Gemini 3.7 / 3.6 / 3.5 Flash**：提供 `Low` / `Medium` / `High` 档位。
  - **Claude Sonnet 4.6**：提供 `Low` / `Medium` / `High` 完整 Interleaved Thinking。
  - **GPT-5.6 Sol**：提供 `Low` / `Medium` / `High` 档位，默认 `Medium`。
  - **GPT-5.6 Terra**：提供 `Medium` / `High` / `X-High` 深度推理档位，默认 `High`。
  - **非思考模型**（如 `gemini-3.1-flash-lite`、`gpt-4o`）：自动隐藏/禁用思考下拉框。

---

## 🚀 安装与导入到 DSH

### 步骤 1：安装依赖到 DSH Web Profile
```bash
cd %USERPROFILE%\.dsh\profiles\web
pnpm add file:D:\dsh_tools\dsh-antigravity
```

### 步骤 2：在 profile 中启用 Bundle
编辑 `%USERPROFILE%\.dsh\profiles\web\package.json`，在 `dsh.profile.bundles` 中加入 `"dsh-plugin-antigravity"`：
```json
{
  "name": "dsh-profile-web",
  "private": true,
  "dependencies": {
    "dsh-plugin-antigravity": "file:D:/dsh_tools/dsh-antigravity",
    "dshmarket": "^1.12.1"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-plugin-antigravity",
        "dshmarket"
      ]
    }
  }
}
```

### 步骤 3：启动 DSH
```bash
dsh web
```

打开 `http://127.0.0.1:3080/`：
- 在 Provider 下拉框中即可选择 **`antigravity`** 或 **`openai-codex`**。
- 选择具体模型时，DSH 界面上的**推理/思考等级选择器**将自动匹配该模型的专属档位！
