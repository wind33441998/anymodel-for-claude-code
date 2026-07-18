---
name: anymodel-for-claude-code
description: AnyModel Gateway for Claude Code —— 一个本地零依赖的多模型网关，让 Claude Code 通过统一的 OpenAI 兼容端点路由到任意模型（Claude / DeepSeek / SiliconFlow / OpenRouter / 智谱 GLM / Kimi / Gemini / Qwen / Groq 等 8 家 21 个模型）。本地 Node 代理做 Anthropic↔OpenAI 协议转换，tool use 双向转换，管理界面一键热切换，API Key 本地落盘，Windows 友好。Claude 本身是一等路由，按需为不同任务选最合适模型。触发词：Claude Code 多模型网关、multi-model gateway、model router、Claude Code 代理、local llm gateway、AnyModel、route Claude Code to any model
---

# AnyModel Gateway for Claude Code — 多模型网关

## 核心原理

Claude Code 只支持 Anthropic API 协议（Messages API），而 DeepSeek / SiliconFlow / 智谱 / Kimi / Gemini / Qwen / Groq 等使用 OpenAI API 协议（Chat Completions API）。两者格式不兼容，不能直接切换。

**解决方案**：在本地运行一个轻量级 Node 代理，接收 Anthropic 格式请求 → 转换为 OpenAI 格式 → 转发到上游 API → 把响应再转回 Anthropic 格式返回给 Claude Code。

```
Claude Code ──(Anthropic格式)──> 本地代理(4000) ──(OpenAI格式)──> DeepSeek/SiliconFlow/Gemini/...
```

代理内置 **tool use 双向转换**，Claude Code 执行命令、读写文件、调用工具等核心功能完全正常。

## ✨ 特性

- **8 家供应商 · 21 个模型别名开箱即用**：DeepSeek / SiliconFlow / OpenRouter / 智谱 GLM / Kimi / Google Gemini / 通义千问 Qwen / Groq
- **完整 tool use**：双向转换 Claude Code 的工具调用（执行命令、读写文件等核心功能正常）
- **零依赖**：纯 Node.js 原生实现，不需要 `npm install`，**只需 Node.js ≥ 14（Python 不需要）**
- **管理界面**：浏览器打开 `http://localhost:4000` 即可可视化选模型 / 配 Key / 一键复制 settings.json；支持中 / EN 双语与深 / 浅主题
- **界面热切换**：Claude Code 配置 `ANTHROPIC_MODEL=default`，在界面点一下即可切换模型，**无需重启 Claude Code**
- **密钥本地落盘**：可通过界面把 Key 存到 `data/keys.json`（也可继续用环境变量），不硬编码进代码
- **选择持久化**：界面切换的模型写入 `data/state.json`，**代理重启后仍生效**，不用每次重选
- **活动日志**：管理界面「活动日志」卡片实时显示每次请求（模型 / 供应商 / 状态 / 耗时），Claude Code 无响应时一眼定位
- **内置自检（免密钥）**：界面点「🔧 运行自检」或访问 `/api/selftest`，即可验证整条 Anthropic↔OpenAI 转换链路（含 tool_use）；也可在界面切到 `echo` 模型发一条测试请求
- **安装前环境自检**：`check-env.js` 自动检查 Node 版本 / 端口占用 / Claude 配置 / Key，缺什么直接告诉你
- **安全**：仅监听 `127.0.0.1`（不暴露到公网）；Key 不进代码

## 📦 支持的模型（开箱即用 · 21 个）

| 模型别名 (ANTHROPIC_MODEL) | 上游服务 | 上游实际模型 | 环境变量 (API Key) |
|---------------------------|---------|-------------|-------------------|
| `deepseek-chat` / `deepseek-reasoner` | DeepSeek | deepseek-chat / deepseek-reasoner | `DEEPSEEK_KEY` |
| `sf-qwen-72b` / `sf-deepseek-v3` / `sf-glm-4-9b` | SiliconFlow 硅基流动 | Qwen/Qwen2.5-72B-Instruct / deepseek-ai/DeepSeek-V3 / ZhipuAI/glm-4-9b-chat | `SILICONFLOW_KEY` |
| `or-deepseek` / `or-qwen` / `or-llama` | OpenRouter | deepseek/deepseek-chat / qwen/qwen-72b-instruct / meta-llama/llama-3.1-70b-instruct | `OPENROUTER_KEY` |
| `glm-4-plus` / `glm-4-air` | 智谱 GLM | glm-4-plus / glm-4-air | `ZHIPU_KEY` |
| `kimi-chat` | Kimi (Moonshot) | moonshot-v1-8k | `MOONSHOT_KEY` |
| `gemini-2.5-pro` / `gemini-2.5-flash` / `gemini-2.0-flash` | Google Gemini | gemini-2.5-pro / gemini-2.5-flash / gemini-2.0-flash | `GEMINI_KEY` |
| `qwen-max` / `qwen-plus` / `qwen-turbo` / `qwen2.5-72b` | 通义千问 Qwen | qwen-max / qwen-plus / qwen-turbo / qwen2.5-72b-instruct | `QWEN_KEY` |
| `groq-llama-70b` / `groq-llama-8b` / `groq-deepseek-r1` | Groq | llama-3.3-70b-versatile / llama-3.1-8b-instant / deepseek-r1-distill-llama-70b | `GROQ_KEY` |

新增模型只需在 `config.json` 的 `providers` 里加一项即可，无需改代码。

> 别名 `default` 和 `auto` 是特殊保留字：发给代理时会被解析为「界面当前选中的模型」。把 Claude Code 的 `ANTHROPIC_MODEL` 设为 `default`，即可在管理界面随时热切换，无需改配置重启。
>
> 另有内置自检别名 **`echo`**：不消耗任何外部 API、不需要密钥，直接回放一条模拟 Anthropic SSE（含 tool_use），用于验证代理链路是否正常。

## 🔧 环境与依赖

- **必需**：Node.js ≥ 14（系统已装 Node 22，零 npm 依赖）
- **不需要**：Python、任何第三方 npm 包、浏览器外的额外软件
- **端口**：默认 `4000`（仅本地 `127.0.0.1`）
- **Claude Code 配置**：`C:\Users\<用户>\.claude\settings.json`（存在即视为已装）

安装前可双击 `start.bat` 自动跑 `check-env.js` 自检，缺哪一项会直接提示（Node 版本过低 / 端口被占 / 未找到 Claude 配置 / 尚未配 Key）。

## 🚀 快速开始（推荐：界面驱动）

### Step 1：填写 API Key

两种方式任选其一：

- **方式 A — 界面填写（推荐）**：启动后打开界面，在「配置 API 密钥」卡片里逐家填入，保存即写入 `data/keys.json`（密钥仅存本机，不上传）。
- **方式 B — 环境变量**：在 `start.bat` 里 `set DEEPSEEK_KEY=sk-xxxx` 等，或在启动前 `export`。

### Step 2：启动代理

双击 `start.bat`（Windows），或命令行：

```bash
cd scripts
node check-env.js   # 可选：先看自检
node proxy.js
```

代理启动后监听 `http://127.0.0.1:4000`。

### Step 3：打开管理界面

浏览器访问 `http://localhost:4000`：

1. **环境自检**卡片：确认 Node / 端口 / Claude 配置 / 已配 Key 全绿
2. **当前模型**：显示代理当前默认模型（即 `default` 解析到的模型）
3. **① 选择模型**：点任意模型卡片即切换（调 `POST /api/switch`，实时生效）
4. **② 配置 API 密钥**：逐家填入并保存（写 `data/keys.json`）
5. **③ 接入 Claude Code**：点「📋 复制 settings.json」拿到现成配置
6. 右上角可切 **中 / EN** 与 **深色 / 浅色** 主题（本地记忆）

### Step 4：接入 Claude Code

> 🧑‍💻 **完全小白看这里**：管理界面第 ③ 步「接入 Claude Code」卡片已经帮你把这件事做成了「看图操作」——
> 卡片顶部直接显示你机器上的**目标文件路径**（如 `C:\Users\你的用户名\.claude\settings.json`），并标了它「已存在 / 未找到」。
> 点「📋 复制 settings.json」拿到现成配置，再按卡片里的 **A→E 五步** 走完即可（含：打开文件、粘贴、保存后重启 Claude Code、怎么验证）。
> 一句话：**复制 → 记事本打开那个文件 → 粘贴保存 → 重启 Claude Code → 发条消息看「活动日志」有没有记录。**

把界面复制到的配置粘进 `~/.claude/settings.json` 的 `env` 字段：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:4000",
    "ANTHROPIC_AUTH_TOKEN": "sk-local-proxy",
    "ANTHROPIC_MODEL": "default",
    "ANTHROPIC_SMALL_FAST_MODEL": "default",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "default",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "default",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "default",
    "CLAUDE_CODE_SUBAGENT_MODEL": "default"
  }
}
```

- `ANTHROPIC_BASE_URL`：本地代理地址（用 `127.0.0.1` 避免 IPv6 歧义）
- `ANTHROPIC_MODEL`：**设 `default`**，之后在管理界面点一下即可换模型，无需重启 Claude Code
- `ANTHROPIC_AUTH_TOKEN`：代理不校验，填任意值

**两种粘贴情形（很重要）：**
- **你是新手，从没改过 Claude Code 配置**：直接把上面整段当作 `settings.json` 的全部内容保存即可（文件不存在就新建）。
- **你已有 settings.json（里面有其它配置，比如权限、hooks）**：**不要整段替换**！只把其中的 `"env": { ... }` 这一段加进去（或覆盖原来的 env 字段），其它内容原样保留，否则会丢配置。

### Step 5：使用

1. **每次用 Claude Code 前先启动代理**（保持 `start.bat` / `proxy.js` 运行）—— 代理没开，Claude Code 会连不上
2. **保存配置后，完全退出并重开 VS Code 的 Claude Code 会话**（新会话才生效，光刷新不够）
3. **切换模型**：在 `http://localhost:4000` 界面点目标模型即可，Claude Code 下一次请求即用新模型
4. **验证是否生效**：在 Claude Code 发任意一条消息，回到管理界面看「活动日志」是否出现记录；没有记录说明配置没生效，检查 Step 4 的 A~E 是否漏了「重启」或「代理在运行」

## 🔌 管理 API（界面底层，也可自行调用）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` 或 `/ui` | 管理界面（ui.html） |
| GET | `/api/env` | 环境自检结果（Node / 端口 / Claude 配置 / 已配 Key 数） |
| GET | `/api/models` | 当前模型 + 全部供应商与模型别名 |
| GET | `/api/status` | 存活探活 |
| GET | `/api/logs` | 活动日志（最近请求：模型 / 供应商 / 状态 / 耗时），倒序 |
| GET | `/api/selftest` | 内置自检：回环调用 `echo` 模型并校验 SSE 事件链，返回 `{ ok, events }` |
| POST | `/api/switch` | 切换当前模型 `{ "model": "deepseek-chat" }`（写入 `data/state.json` 持久化） |
| POST | `/api/keys` | 保存 / 清除密钥 `{ "provider": "deepseek", "key": "sk-xxx" }`（空 key 清除） |
| POST | `/v1/messages` | Anthropic 协议代理入口（Claude Code 实际调用） |
| GET | `/health` ` /models` | 早期健康检查 / 模型列表 |

## 🧪 验证代理（可选）

```bash
curl http://127.0.0.1:4000/health                       # 期望: OK
curl http://127.0.0.1:4000/api/models                   # 当前模型 + 供应商列表
curl http://127.0.0.1:4000/api/selftest                 # 期望: {"ok":true,"events":[...]}（免密钥自检）

# 测试普通对话转发（需先配好对应 Key）
curl -sN -X POST http://127.0.0.1:4000/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","max_tokens":80,"stream":true,"messages":[{"role":"user","content":"你好"}]}'

# 测试 tool use 转换（必须看到 stop_reason:tool_use + tool_use 块）
curl -sN -X POST http://127.0.0.1:4000/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","max_tokens":200,"stream":true,"system":"You must use the tool provided.","tools":[{"name":"test_tool","description":"测试","input_schema":{"type":"object","properties":{"q":{"type":"string"}}}}],"messages":[{"role":"user","content":"call test_tool"}]}'
```

**必须看到** `stop_reason: tool_use` + `tool_use` content block，否则 Claude Code 无法执行工具调用。

> **零密钥快速验证**：没有 Key 也能验证整条链路 —— `curl http://127.0.0.1:4000/api/selftest`，或在界面切到 `echo` 模型、点「🔧 运行自检」。这会用一条模拟响应走完「Anthropic→OpenAI→Anthropic」转换，确认协议转换与 tool_use 回写都正常。

## ➕ 新增自定义模型

编辑 `config.json`，在对应 provider 的 `models` 里加一行（Key 是别名，Value 是上游模型名）：

```json
"providers": {
  "deepseek": {
    "display": "DeepSeek", "region": "cn", "icon": "🐋",
    "base_url": "https://api.deepseek.com/chat/completions",
    "api_key": "${DEEPSEEK_KEY}",
    "models": {
      "deepseek-chat": "deepseek-chat",
      "deepseek-reasoner": "deepseek-reasoner",
      "my-custom": "deepseek-ai/my-custom-model"   // ← 新增别名
    }
  }
}
```

然后 Claude Code 的 `ANTHROPIC_MODEL` 设为 `my-custom` 即可（或设为 `default` 后在界面点选）。

## 🧰 备选方案（免本地代理）

如果不想跑本地代理，可用 **OpenRouter**（免部署）：

```
ANTHROPIC_BASE_URL = https://openrouter.ai/api/anthropic
ANTHROPIC_MODEL    = deepseek/deepseek-chat
ANTHROPIC_AUTH_TOKEN = <OpenRouter Key>
```

无需任何本地代理，但不能享受本 skill 的界面管理与多供应商统一网关。

## 🐛 故障排查

| 症状 | 可能原因 | 解决方案 |
|------|----------|----------|
| curl 连接拒绝 | 代理未启动 | 运行 `node proxy.js` / 双击 `start.bat` |
| `/api/models` 返回旧数据 | 代理缓存了旧 ui.html | 改动 ui.html 后**必须重启代理**才生效 |
| EADDRINUSE | 端口被占 | 用 PowerShell 杀残留进程：<br>`$p=(Get-NetTCPConnection -LocalPort 4000).OwningProcess; Stop-Process -Id $p -Force`<br>（注意：PowerShell 中 `$pid` 是只读常量，不能赋值） |
| 回复正常但不能执行工具 | tool use 失败 | 用上面的 curl 测试 tool_use 场景确认 `stop_reason=tool_use` |
| 429 错误 | 上游余额不足 | 检查上游账户余额 |
| 500 "缺少 API key" | Key 未配 | 在界面「配置 API 密钥」填写，或在环境变量 / `data/keys.json` 设好 |
| 界面点切换没反应 | 代理未运行 | 先启动 `proxy.js`，界面会提示「无法连接代理」 |

## 📤 发布到 CodeBuddy 插件市场

本仓库已按 CodeBuddy 插件市场规范组织：根目录含 `.codebuddy-plugin/marketplace.json`（市场清单），插件位于 `plugins/anymodel-for-claude-code/`（含 `.codebuddy-plugin/plugin.json` + `skills/anymodel-for-claude-code/`）。

发布流程：

1. **推送到 GitHub 公开仓库**（如 `wind33441998/anymodel-for-claude-code`）
2. **他人在 CodeBuddy 内添加市场并安装**：
   ```
   /plugin marketplace add wind33441998/anymodel-for-claude-code
   /plugin install anymodel-for-claude-code@anymodel-marketplace
   ```
   > 也可用完整 URL：`/plugin marketplace add https://github.com/wind33441998/anymodel-for-claude-code`
3. **变现**：CodeBuddy 官方 marketplace 为开源协作模式，若需商业化分发，可在仓库 README 引导赞助/付费授权；付费渠道另走 SkillHQ / SkillStack

## Resources

### scripts/
- **proxy.js**：Node 原生实现的 Anthropic↔OpenAI 协议代理，零依赖。支持流式响应、tool_use 双向转换、多 provider 路由、`default`/`auto` 热切换、模型选择持久化（`data/state.json`）、活动日志、内置 `echo` 自检、`/api/logs` 与 `/api/selftest` 管理 API、仅监听 `127.0.0.1`。
- **config.json**：8 家供应商配置，API key 用 `${ENV}` 占位（运行时从环境变量读取），也可由界面写 `data/keys.json` 覆盖。
- **ui.html**：管理界面（选模型 / 配 Key / 复制 settings.json / 中英文 / 深浅主题）。
- **check-env.js**：安装前环境自检（Node ≥14 / 端口 4000 / Claude 配置 / Key），缺项直接提示。
- **start.bat**：Windows 启动器，先跑 `check-env.js` 再启动 `proxy.js`。

### data/（运行时生成，已 gitignore）
- **keys.json**：界面保存的 API Key，仅本机、不上传。
- **state.json**：界面选中的当前模型，重启代理后保持上次选择。
