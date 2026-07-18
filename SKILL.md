---
name: claude-code-proxy-setup
description: 将 Claude Code 切换到任意外部模型（DeepSeek/SiliconFlow/OpenRouter/智谱GLM/Kimi 等），通过本地 Node 代理实现 Anthropic ↔ OpenAI 协议转换，支持 tool use 双向转换。触发词：Claude Code 换模型、切换模型、用 DeepSeek、用 SiliconFlow、外部模型、代理网关、多模型
---

# Claude Code 外部多模型代理配置

## 核心原理

Claude Code 只支持 Anthropic API 协议（Messages API），而 DeepSeek / SiliconFlow / 智谱 / Kimi 等使用 OpenAI API 协议（Chat Completions API）。两者格式不兼容，不能直接切换。

**解决方案**：在本地运行一个轻量级 Node 代理，接收 Anthropic 格式请求 → 转换为 OpenAI 格式 → 转发到上游 API → 把响应再转回 Anthropic 格式返回给 Claude Code。

```
Claude Code ──(Anthropic格式)──> 本地代理(4000) ──(OpenAI格式)──> DeepSeek/SiliconFlow/...
```

代理内置 **tool use 双向转换**，Claude Code 执行命令、读写文件、调用工具等核心功能完全正常。

## 支持的模型（开箱即用）

| 模型别名 (ANTHROPIC_MODEL) | 上游服务 | 上游实际模型 | 环境变量 (API Key) |
|---------------------------|---------|-------------|-------------------|
| `deepseek-chat` | DeepSeek | deepseek-chat | `DEEPSEEK_KEY` |
| `deepseek-reasoner` | DeepSeek | deepseek-reasoner | `DEEPSEEK_KEY` |
| `sf-qwen-72b` | SiliconFlow | Qwen/Qwen2.5-72B-Instruct | `SILICONFLOW_KEY` |
| `sf-deepseek-v3` | SiliconFlow | deepseek-ai/DeepSeek-V3 | `SILICONFLOW_KEY` |
| `sf-glm-4-9b` | SiliconFlow | ZhipuAI/glm-4-9b-chat | `SILICONFLOW_KEY` |
| `or-deepseek` | OpenRouter | deepseek/deepseek-chat | `OPENROUTER_KEY` |
| `or-qwen` | OpenRouter | qwen/qwen-72b-instruct | `OPENROUTER_KEY` |
| `or-llama` | OpenRouter | meta-llama/llama-3.1-70b-instruct | `OPENROUTER_KEY` |
| `glm-4-plus` | 智谱 GLM | glm-4-plus | `ZHIPU_KEY` |
| `glm-4-air` | 智谱 GLM | glm-4-air | `ZHIPU_KEY` |
| `kimi-chat` | Kimi (Moonshot) | moonshot-v1-8k | `MOONSHOT_KEY` |

新增模型只需在 `config.json` 的 `providers` 里加一项即可，无需改代码。

## 前置检查清单

1. **Claude Code 配置文件**：`C:\Users\Administrator\.claude\settings.json`
2. **上游 API key 有效且有余额**
3. **Node.js 可用**（系统已装 Node 22，零依赖）
4. **端口 4000 空闲**

## 工作流程

### Step 1: 部署代理文件

将 `scripts/proxy.js` 和 `scripts/config.json` 复制到目标目录（如 `D:\litellm\`）。

config.json 用 `${ENV_VAR}` 占位 API key，运行时从环境变量读取（安全，不硬编码 key）。

### Step 2: 设置 API Key 环境变量

方式 A — 命令行启动：
```bash
export DEEPSEEK_KEY=sk-xxxx
node D:\litellm\proxy.js
```

方式 B — 写 `.bat` 启动脚本（推荐双击用）：
```batch
@echo off
set DEEPSEEK_KEY=sk-xxxx
set SILICONFLOW_KEY=sk-yyyy
node D:\litellm\proxy.js
pause
```

### Step 3: 启动并验证代理

```bash
node D:\litellm\proxy.js &

# 健康检查
curl http://127.0.0.1:4000/health   # 期望: OK

# 查看支持的模型
curl http://127.0.0.1:4000/models

# 测试普通对话转发
curl -sN -X POST http://127.0.0.1:4000/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","max_tokens":80,"stream":true,"messages":[{"role":"user","content":"你好"}]}'

# 测试 tool use 转换（必须看到 stop_reason:tool_use + tool_use 块）
curl -sN -X POST http://127.0.0.1:4000/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","max_tokens":200,"stream":true,"system":"You must use the tool provided.","tools":[{"name":"test_tool","description":"测试","input_schema":{"type":"object","properties":{"q":{"type":"string"}}}}],"messages":[{"role":"user","content":"call test_tool"}]}'
```

**必须看到** `stop_reason: tool_use` + `tool_use` content block，否则 Claude Code 无法执行工具调用。

### Step 4: 修改 Claude Code 配置

编辑 `C:\Users\Administrator\.claude\settings.json`：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:4000",
    "ANTHROPIC_MODEL": "deepseek-chat",
    "ANTHROPIC_AUTH_TOKEN": "sk-local-proxy",
    "API_TIMEOUT_MS": "3000000",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"
  }
}
```

- `ANTHROPIC_BASE_URL`: 本地代理地址（用 127.0.0.1 避免 IPv6 歧义）
- `ANTHROPIC_MODEL`: 设为上表任一模型别名（如 `deepseek-chat`）
- `ANTHROPIC_AUTH_TOKEN`: 代理不校验，填任意值

### Step 5: 用户操作指引

1. **每次用 Claude Code 前，先启动代理**（双击 .bat 或运行 `node proxy.js`）
2. **保持代理窗口打开**（关了就断）
3. **重开 VS Code 的 Claude Code 会话**（新会话才生效）
4. **切换模型**：改 settings.json 的 `ANTHROPIC_MODEL` 为其他别名，重启代理生效

## 新增自定义模型

编辑 `config.json`，在对应 provider 的 `models` 里加一行：
```json
"providers": {
  "deepseek": {
    "base_url": "https://api.deepseek.com/chat/completions",
    "api_key": "${DEEPSEEK_KEY}",
    "models": {
      "deepseek-chat": "deepseek-chat",
      "deepseek-reasoner": "deepseek-reasoner",
      "my-custom": "deepseek-ai/my-custom-model"   // ← 新增
    }
  }
}
```
然后 Claude Code 的 `ANTHROPIC_MODEL` 设为 `my-custom` 即可。

## 备选方案（免本地代理）

如果不想跑本地代理，可用 **OpenRouter**（免部署）：
1. 注册 openrouter.ai 并充值
2. 直接改 settings.json:
   ```
   ANTHROPIC_BASE_URL = https://openrouter.ai/api/anthropic
   ANTHROPIC_MODEL = deepseek/deepseek-chat
   ANTHROPIC_AUTH_TOKEN = <OpenRouter Key>
   ```
3. 无需任何本地代理

## 故障排查

| 症状 | 可能原因 | 解决方案 |
|------|----------|----------|
| curl 连接拒绝 | 代理未启动 | 运行 `node proxy.js` |
| `/models` 返回 404 | 旧代理占端口 | 用 127.0.0.1 并彻底杀旧进程 |
| EADDRINUSE | 端口被占 | `netstat -ano | grep 4000` 找到 PID 并 `taskkill` |
| 回复正常但不能执行工具 | tool use 失败 | 用 curl 测试 tool_use 场景确认 stop_reason=tool_use |
| 429 错误 | 上游余额不足 | 检查上游账户余额 |
| 500 "缺少 API key" | 环境变量未设 | 设置对应 provider 的 `*_KEY` 环境变量 |

## 发布到 Skill 应用商店

CodeBuddy 的插件市场基于 git 仓库，发布流程：

1. **本地仓库**：将 skill 目录初始化为 git 仓库
2. **推送到公开平台**：推送到 GitHub 公开仓库（如 `username/claude-code-proxy-setup`）
3. **分享安装**：他人通过 CodeBuddy 命令安装
   ```
   /plugin marketplace add https://github.com/username/claude-code-proxy-setup
   /plugin install claude-code-proxy-setup
   ```
4. **变现**：CodeBuddy 官方 marketplace 为开源协作模式，若需商业化分发，可在仓库 README 引导赞助/付费授权

## Resources

### scripts/
- **proxy.js**: Node 22 原生实现的 Anthropic↔OpenAI 协议代理，零依赖。支持流式响应、tool_use 双向转换、多 provider 路由。
- **config.json**: 多 provider 配置模板，API key 用 `${ENV}` 占位，运行时从环境变量读取。
