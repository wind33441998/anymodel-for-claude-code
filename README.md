# Claude Code 多模型代理 Skill

让 Claude Code 免费使用 DeepSeek、SiliconFlow、智谱 GLM、Kimi、Google Gemini、通义千问、Groq 等 **8 家 21 个模型**，无需 Anthropic 官方 API。自带**管理界面**，点一下切换模型，密钥存本机。

<!-- 如果这个 skill 帮到了你，欢迎请作者喝杯咖啡 ☕ -->

## ✨ 特性

- **8 家供应商 · 21 个模型别名**：DeepSeek / SiliconFlow / OpenRouter / 智谱 GLM / Kimi / Google Gemini / 通义千问 Qwen / Groq
- **完整 tool use**：双向转换 Claude Code 的工具调用（执行命令、读写文件等核心功能正常）
- **零依赖**：纯 Node.js 原生实现，不需要 `npm install`，**只需 Node.js ≥ 14（Python 不需要）**
- **管理界面**：浏览器打开 `http://localhost:4000` 即可可视化选模型 / 配 Key / 一键复制 settings.json；支持中 / EN 与深 / 浅主题
- **界面热切换**：Claude Code 设置 `ANTHROPIC_MODEL=default`，在界面点一下换模型，**无需重启 Claude Code**
- **密钥本地落盘**：界面填的 Key 存到 `data/keys.json`（也可继续用环境变量），不进代码
- **选择持久化**：界面切换的模型写入 `data/state.json`，代理重启后仍生效
- **活动日志**：界面「活动日志」卡片实时显示每次请求（模型 / 供应商 / 状态 / 耗时），排查无响应时用得上
- **内置自检（免密钥）**：界面点「🔧 运行自检」或访问 `/api/selftest` 验证整条链路；也可切到 `echo` 模型发测试请求
- **安装前自检**：`check-env.js` 自动检查 Node / 端口 / Claude 配置 / Key，缺什么直接告诉你

## 📦 安装（作为 CodeBuddy Skill）

```bash
/plugin marketplace add https://github.com/<你的用户名>/claude-code-proxy-setup
/plugin install claude-code-proxy-setup
```

或手动复制 `scripts/` 整个目录到本地。

## 🚀 使用步骤（界面驱动 · 推荐）

1. **启动代理**：双击 `scripts/start.bat`（Windows），或 `cd scripts && node proxy.js`
2. **打开界面**：浏览器访问 `http://localhost:4000`
   - 看「环境自检」是否全绿
   - 点「🔧 运行自检」验证链路（无需任何 Key）
   - 在「配置 API 密钥」填入各家 Key（保存即写入 `data/keys.json`）
   - 在「选择模型」点目标模型即可切换
   - 看「活动日志」了解每次请求的状态与耗时
   - 点「📋 复制 settings.json」拿到现成配置
3. **接入 Claude Code**：把复制到的配置粘进 `~/.claude/settings.json` 的 `env` 字段（关键：`ANTHROPIC_MODEL` 设 `default`）
   - 🧑‍💻 **完全小白**：界面第 ③ 步卡片已经显示你机器上的**目标文件路径**并标了「已存在 / 未找到」，按卡片里的 **A→E 五步** 操作即可（含：用记事本打开文件、粘贴、保存后重启 Claude Code、发消息验证）。
   - ⚠️ 若你**已有** settings.json（里面有其它配置）：**不要整段替换**，只把 `env` 这一段加进去，保留其它内容；新手（文件不存在/空白）直接整段保存。
4. **重开 Claude Code 会话**即可使用外部模型（保存配置后需完全退出并重开，光刷新不够）
5. **以后换模型**：直接在 `http://localhost:4000` 界面点选，无需重启 Claude Code
6. **验证**：在 Claude Code 发条消息，回到界面看「活动日志」是否出现记录；没记录说明没生效，检查代理是否在运行、是否重启了会话

### 最简 settings.json

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:4000",
    "ANTHROPIC_AUTH_TOKEN": "sk-local-proxy",
    "ANTHROPIC_MODEL": "default"
  }
}
```

## 🎛 支持的模型

| 别名 | 上游 | 环境变量 |
|------|------|---------|
| `deepseek-chat` / `deepseek-reasoner` | DeepSeek | `DEEPSEEK_KEY` |
| `sf-qwen-72b` / `sf-deepseek-v3` / `sf-glm-4-9b` | SiliconFlow | `SILICONFLOW_KEY` |
| `or-deepseek` / `or-qwen` / `or-llama` | OpenRouter | `OPENROUTER_KEY` |
| `glm-4-plus` / `glm-4-air` | 智谱 GLM | `ZHIPU_KEY` |
| `kimi-chat` | Kimi | `MOONSHOT_KEY` |
| `gemini-2.5-pro` / `gemini-2.5-flash` / `gemini-2.0-flash` | Google Gemini | `GEMINI_KEY` |
| `qwen-max` / `qwen-plus` / `qwen-turbo` / `qwen2.5-72b` | 通义千问 Qwen | `QWEN_KEY` |
| `groq-llama-70b` / `groq-llama-8b` / `groq-deepseek-r1` | Groq | `GROQ_KEY` |

> 别名 `default` / `auto` 会被解析为「界面当前选中的模型」。把 Claude Code 的 `ANTHROPIC_MODEL` 设为 `default`，界面切换即时生效。

新增模型：编辑 `config.json` 的 `providers.models` 加一行即可。

## 💡 原理

```
Claude Code ──Anthropic格式──▶ 本地代理(4000) ──OpenAI格式──▶ 上游模型
```

Claude Code 只支持 Anthropic 协议，本代理在中间做协议翻译，使其能调用任意 OpenAI 兼容模型，并双向转换 tool use。

## ☕ 赞助

如果这个 skill 对你有帮助，欢迎通过 GitHub Sponsors 支持作者持续维护更多实用 skill。

## 📄 License

MIT
