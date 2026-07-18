# Claude Code 多模型代理 Skill

让 Claude Code 免费使用 DeepSeek、SiliconFlow、智谱 GLM、Kimi 等任意 OpenAI 协议模型，无需 Anthropic 官方 API。

<!-- 赞助: 如果这个 skill 帮到了你，欢迎请作者喝杯咖啡 ☕ -->

## ✨ 特性

- **多模型支持**：DeepSeek / SiliconFlow / OpenRouter / 智谱 GLM / Kimi，开箱即用 11 个模型别名
- **完整 tool use**：双向转换 Claude Code 的工具调用（执行命令、读写文件等核心功能正常）
- **零依赖**：纯 Node.js 原生实现，不需要 `npm install`
- **安全**：API key 用环境变量注入，不硬编码进代码
- **易扩展**：改 `config.json` 一行即可加新模型

## 📦 安装（作为 CodeBuddy Skill）

```bash
/plugin marketplace add https://github.com/<你的用户名>/claude-code-proxy-setup
/plugin install claude-code-proxy-setup
```

或手动复制 `scripts/proxy.js` + `scripts/config.json` 到本地目录。

## 🚀 使用步骤

1. 设置 API key 环境变量：
   ```bash
   export DEEPSEEK_KEY=sk-xxxx
   ```
2. 启动代理：
   ```bash
   node proxy.js
   ```
3. 修改 Claude Code 配置 `~/.claude/settings.json`：
   ```json
   {
     "env": {
       "ANTHROPIC_BASE_URL": "http://127.0.0.1:4000",
       "ANTHROPIC_MODEL": "deepseek-chat",
       "ANTHROPIC_AUTH_TOKEN": "sk-local-proxy"
     }
   }
   ```
4. 重开 Claude Code 会话即可使用外部模型。

## 🎛 支持的模型

| 别名 | 上游 | 环境变量 |
|------|------|---------|
| `deepseek-chat` / `deepseek-reasoner` | DeepSeek | `DEEPSEEK_KEY` |
| `sf-qwen-72b` / `sf-deepseek-v3` / `sf-glm-4-9b` | SiliconFlow | `SILICONFLOW_KEY` |
| `or-deepseek` / `or-qwen` / `or-llama` | OpenRouter | `OPENROUTER_KEY` |
| `glm-4-plus` / `glm-4-air` | 智谱 GLM | `ZHIPU_KEY` |
| `kimi-chat` | Kimi | `MOONSHOT_KEY` |

新增模型：编辑 `config.json` 的 `providers.models` 即可。

## 💡 原理

```
Claude Code ──Anthropic格式──▶ 本地代理(4000) ──OpenAI格式──▶ 上游模型
```

Claude Code 只支持 Anthropic 协议，本代理在中间做协议翻译，使其能调用任意 OpenAI 兼容模型。

## ☕ 赞助

如果这个 skill 对你有帮助，欢迎通过 GitHub Sponsors 支持作者持续维护更多实用 skill。

## 📄 License

MIT
