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
- **Cockpit OpenAI Codex 自动同步**：自动解密 `~/.antigravity_cockpit/codex_accounts/`，并读取 `CODEX_HOME/auth.json`（未设置时为 `~/.codex/auth.json`），在 DSH 中直接提供 `openai-codex` 路由。
  - 支持 `openai-codex/gpt-5.6-sol`、`openai-codex/gpt-5.6-terra`、`openai-codex/gpt-5.6-luna`、`openai-codex/o3-mini`、`openai-codex/o1`、`openai-codex/gpt-4o`。

### 3. 按模型精准配置推理等级（Reasoning Effort）
- **告别 DeepSeek 默认单一档位**：不同模型支持的思考档位不同，本插件在 `resolveModel` 时会向 DSH UI 动态返回该模型专属的合法推理档位：
  - **Gemini 3.7 / 3.6 / 3.5 Flash**：提供 `Low` / `Medium` / `High` 档位。
  - **Claude Sonnet 4.6**：提供 `Low` / `Medium` / `High` 完整 Interleaved Thinking。
  - **GPT-5.6 Sol / Terra / Luna**：提供 `None` / `Low` / `Medium` / `High` / `X-High` / `Max` 档位，并额外提供插件侧 `Auto` 自动选择，默认 `Auto`。
- **非思考模型**（如 `gemini-3.1-flash-lite`、`gpt-4o`）：自动隐藏/禁用思考下拉框。

### 4. 极致 Prompt Cache 命中率与低 Token 优化
- **Cache-First 默认前缀稳定化**：默认采用全量 Canonical 规范化工具 Schema 与稳定前缀，避免会话多轮交互中因工具增删抖动而击穿服务端 Prompt Cache，实现 Claude、Gemini、Codex 近 100% 缓存命中与毫秒级首字延迟（TTFT）。
- **Codex 稳定 Cache Key 与会话续接**：Codex 生成稳定的会话专属 `prompt_cache_key`，配合 `previous_response_id` 续接与 Explicit Breakpoint，享受最大化 Cached Token 折扣。
- **灵活策略可调**：如需对极短单轮会话进行轻量化剪裁，仍可通过 `DSH_ANTIGRAVITY_TOOL_MODE=coding|research|memory|vision|all` 自由切换策略。
- DSH Web profile 默认切到 Code preset，并关闭 OpenViking、Hindsight、ModLens 的常驻上下文注入。需要记忆或图片能力时，再在 profile patch 中移除对应的 `disabled: true`。

---

## 🚀 一键安装与启用

### 推荐：DSH 官方单行命令安装（自动下载依赖并注册 Bundle）

在任何终端中直接执行一行命令：

```bash
dsh plugin --profile web add github:huangjunjie08-max/dsh-cockpit-tools-antigravity-codex
```

> 💡 **原理说明**：`dsh plugin add` 会自动调用 pnpm 安装依赖，并由于本插件声明了 `dsh.bundle`，DSH 会**自动将 `dsh-plugin-antigravity` 注册到 `dsh.profile.bundles` 中**，全程 100% 自动化，无需手动打开并编辑 `package.json`！

---

### 离线或本地安装方式

如果处于内网或本地调试环境：

```bash
# 离线 TGZ 包单行安装
dsh plugin --profile web add /path/to/dsh-plugin-antigravity-1.3.0.tgz

# 或本地目录单行安装
dsh plugin --profile web add /path/to/dsh-antigravity
```

---

### 启动使用

安装完成后启动 DSH：
```bash
dsh web
```

打开 `http://127.0.0.1:3080/`：
- 在 Provider 下拉框中即可选择 **`antigravity`** 或 **`openai-codex`**。
- 选择具体模型时，DSH 界面上的**推理/思考等级选择器**将自动匹配该模型的专属档位！
