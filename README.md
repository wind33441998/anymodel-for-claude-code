# ModelHub

> Claude Code 多模型本地网关 — 国产供应商直连免翻墙，8 家 21 模型，Web 管理界面，完整 tool use 转换

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **品牌说明**：本项目前身为 *AnyModel for Claude Code*，现统一为 **ModelHub** 品牌。Skill 安装名 `anymodel-for-claude-code` 保持不变（向后兼容），npm 包名为 `modelhub-cli`（安装后命令仍为 `modelhub`）。两者同源同核，共享 `~/.modelhub/` 数据目录。

## 两种安装方式

ModelHub 提供两种形态，按需选择：

| 形态 | 安装命令 | 适用场景 |
|------|----------|----------|
| **npm CLI** | `npm install -g modelhub-cli` | 已有 Node 环境，想要命令行管理 |
| **Skill** | `/plugin marketplace add wind33441998/modelhub` | 在 CodeBuddy / Claude Code 插件市场内安装 |

两种形态共享同一套代理核心和数据目录，配一次 Key 两边都能用。

## 为什么用 ModelHub？

- **零依赖** — 纯 Node.js 原生实现，无 `npm install`、无 Docker，下载即用（仅需 Node ≥ 14）
- **国产供应商直连** — DeepSeek / 智谱 / 通义千问 / Kimi / 硅基流动，无需翻墙
- **国际供应商也支持** — OpenRouter / Gemini / Groq，有 Key 就能连
- **完整 tool use** — 双向转换 Claude Code 的工具调用（执行命令、读写文件等核心功能正常）
- **Web 管理界面** — 浏览器里切模型、配密钥、看日志，不用改配置文件
- **界面热切换** — Claude Code 配 `ANTHROPIC_MODEL=default`，在界面点一下即可切模型，无需重启
- **中英双语** — 界面和文档都支持中文
- **Windows 优先** — 在 Windows 上开箱即用，路径/编码坑已填平

## 快速开始

### 方式一：npm CLI

```bash
# 全局安装
npm install -g modelhub-cli

# 启动代理（前台运行）
modelhub start

# 配置 API Key（例如 DeepSeek）
modelhub keys set deepseek sk-xxxxxxxx

# 打开 Web 管理界面
modelhub ui
```

### 方式二：Skill 形态

在 CodeBuddy / Claude Code 内：

```
/plugin marketplace add wind33441998/modelhub
/plugin install anymodel-for-claude-code@anymodel-marketplace
```

安装后双击 `start.bat`（Windows），或命令行：

```bash
cd scripts
node proxy.js
```

### 接入 Claude Code

两种方式任选：

**环境变量：**
```bash
export ANTHROPIC_API_URL=http://127.0.0.1:4000
export ANTHROPIC_AUTH_TOKEN=sk-local-proxy
export ANTHROPIC_MODEL=default
```

**settings.json**（`~/.claude/settings.json`）：
```json
{
  "env": {
    "ANTHROPIC_API_URL": "http://127.0.0.1:4000",
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

> **注意**：用 `127.0.0.1` 而非 `localhost`，避免 IPv6 `::1` 解析问题。`ANTHROPIC_MODEL` 设 `default` 后可在管理界面随时热切换，无需重启 Claude Code。保存配置后需**完全退出并重开** Claude Code 会话才生效。

## CLI 命令

| 命令 | 说明 |
|------|------|
| `modelhub start [-d] [-p PORT]` | 启动代理（`-d` 后台，`-p` 指定端口） |
| `modelhub stop` | 停止后台代理 |
| `modelhub status` | 查看运行状态 + 当前模型 |
| `modelhub models` | 列出所有可用模型 |
| `modelhub switch <model>` | 切换当前激活模型 |
| `modelhub keys [list]` | 列出已配置的 API Key |
| `modelhub keys set <provider> <key>` | 设置供应商 API Key |
| `modelhub keys del <provider>` | 删除供应商 API Key |
| `modelhub ui` | 在浏览器打开管理界面 |
| `modelhub doctor` | 环境自检（Node / 端口 / 配置 / Key） |
| `modelhub selftest` | 运行代理链路自检（无需 API Key） |

## 支持的供应商

| 供应商 | 地区 | 模型数 | 环境变量 |
|--------|------|--------|----------|
| 🐋 DeepSeek | 中国 | 2 | `DEEPSEEK_KEY` |
| 🌊 SiliconFlow 硅基流动 | 中国 | 3 | `SILICONFLOW_KEY` |
| 🧠 智谱 GLM | 中国 | 2 | `ZHIPU_KEY` |
| 🌙 Kimi (Moonshot) | 中国 | 1 | `MOONSHOT_KEY` |
| 🐱 通义千问 Qwen | 中国 | 4 | `QWEN_KEY` |
| 🌐 OpenRouter | 国际 | 3 | `OPENROUTER_KEY` |
| ✨ Google Gemini | 国际 | 3 | `GEMINI_KEY` |
| ⚡ Groq | 国际 | 3 | `GROQ_KEY` |

API Key 可通过环境变量设置，也可通过 `modelhub keys set` 或 Web 界面配置（存入 `~/.modelhub/keys.json`，不进 git）。

> 别名 `default` 和 `auto` 是特殊保留字：发给代理时解析为「界面当前选中的模型」。另有内置自检别名 **`echo`**：不消耗任何外部 API、不需要密钥，直接回放一条模拟 Anthropic SSE（含 tool_use），用于验证代理链路是否正常。

## 数据目录

所有配置和数据存储在 `~/.modelhub/`（Skill 和 CLI 共享）：

```
~/.modelhub/
├── config.json      # 供应商配置（首次运行自动创建）
├── keys.json        # API Key（不进 git）
├── state.json       # 当前激活模型
├── modelhub.pid     # 后台运行 PID（CLI 形态）
└── modelhub.log     # 后台运行日志（CLI 形态）
```

## 技术架构

```
Claude Code  ──Anthropic Messages API──→  ModelHub 代理 (127.0.0.1:4000)
                                              │
                                    OpenAI Chat Completions
                                              │
                                    ┌─────────┴─────────┐
                                    │                   │
                              国产供应商            国际供应商
                           (免翻墙直连)         (需网络访问)
```

ModelHub 将 Anthropic Messages API 请求转换为 OpenAI Chat Completions 格式，转发到上游供应商，再将响应流式转换回 Anthropic SSE 格式。完整支持 tool use 双向转换（Claude Code 执行命令、读写文件等核心功能依赖此能力）。

### 管理 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` 或 `/ui` | 管理界面 |
| GET | `/api/env` | 环境自检结果 |
| GET | `/api/models` | 当前模型 + 全部供应商与模型别名 |
| GET | `/api/status` | 存活探活 |
| GET | `/api/logs` | 活动日志（最近请求） |
| GET | `/api/selftest` | 内置自检（回环 echo 模型，免密钥） |
| POST | `/api/switch` | 切换当前模型 |
| POST | `/api/keys` | 保存/清除密钥 |
| POST | `/v1/messages` | Anthropic 协议代理入口（Claude Code 实际调用） |

## 本地开发

```bash
git clone https://github.com/wind33441998/modelhub.git
cd modelhub

# CLI 形态
node bin/modelhub.js start

# 或 Skill 形态
cd plugins/anymodel-for-claude-code/skills/anymodel-for-claude-code/scripts
node proxy.js
```

重新打包 Skill：`python build_skill.py`（生成 `anymodel-for-claude-code.skill`）

## 仓库结构

```
modelhub/
├── bin/modelhub.js          # CLI 入口
├── lib/cli.js               # CLI 命令分发（11 个命令）
├── lib/proxy.js             # 代理核心（协议转换 + 管理 API）
├── assets/config.json       # 供应商配置（8 家 21 模型）
├── assets/ui.html           # Web 管理界面
├── package.json             # npm 包定义
├── plugins/                 # Skill 形态
│   └── anymodel-for-claude-code/
│       ├── .codebuddy-plugin/plugin.json
│       ├── .claude-plugin/plugin.json
│       └── skills/anymodel-for-claude-code/
│           ├── SKILL.md
│           └── scripts/（proxy.js / config.json / ui.html / check-env.js / start.bat）
├── .codebuddy-plugin/marketplace.json
├── .claude-plugin/marketplace.json
├── build_skill.py           # Skill 打包脚本
└── README.md
```

## License

MIT
