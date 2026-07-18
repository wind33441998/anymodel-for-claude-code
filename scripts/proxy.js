// Claude Code 多模型本地代理 (Anthropic <-> OpenAI 协议转换)
// 支持 DeepSeek / SiliconFlow / OpenRouter / 智谱 / Kimi 等任意 OpenAI 格式上游
// 完整支持 tool use 双向转换 (Claude Code 执行命令/读写文件依赖此功能)
// 用法: node proxy.js  (默认监听 http://localhost:4000)
// 配置: 同目录 config.json，API key 用 ${ENV_VAR} 占位，运行时从环境变量读取

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4000;
const CONFIG_PATH = process.env.PROXY_CONFIG || path.join(__dirname, 'config.json');

function resolveEnv(val) {
  if (typeof val !== 'string') return val;
  return val.replace(/\$\{([^}]+)\}/g, (m, k) => process.env[k] || '');
}

// 加载配置：model别名 -> provider
const config = { providers: {} };
if (fs.existsSync(CONFIG_PATH)) {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    for (const [name, p] of Object.entries(raw.providers || {})) {
      config.providers[name] = { base_url: resolveEnv(p.base_url), api_key: resolveEnv(p.api_key), models: p.models || {} };
    }
  } catch (e) { console.error('[配置错误]', e.message); }
}

// 兜底：若环境变量里有 DEEPSEEK_KEY 则至少启用 DeepSeek
if (Object.keys(config.providers).length === 0 && process.env.DEEPSEEK_KEY) {
  config.providers.deepseek = { base_url: 'https://api.deepseek.com/chat/completions', api_key: process.env.DEEPSEEK_KEY, models: { 'deepseek-chat': 'deepseek-chat', 'deepseek-reasoner': 'deepseek-reasoner' } };
}

// model别名 -> {provider, upstreamModel}
const modelMap = {};
for (const [name, p] of Object.entries(config.providers)) {
  for (const [alias, real] of Object.entries(p.models || {})) modelMap[alias] = { provider: name, upstream: real };
}
function resolveProvider(model) {
  if (modelMap[model]) return modelMap[model];
  for (const [name] of Object.entries(config.providers)) {
    if (model.startsWith(name + '-') || model.startsWith(name + '/')) return { provider: name, upstream: model.slice(name.length + 1) };
  }
  const first = Object.keys(config.providers)[0];
  if (!first) return null;
  return { provider: first, upstream: model };
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter(b => b && b.type === 'text').map(b => b.text).join('\n');
  return '';
}
function convertRequest(a) {
  const messages = [];
  let system = '';
  for (const m of a.messages || []) {
    if (m.role === 'system') { system += (system ? '\n' : '') + extractText(m.content); continue; }
    if (m.role === 'user') {
      const blocks = Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }];
      let text = '';
      for (const b of blocks) {
        if (b.type === 'text') text += (text ? '\n' : '') + b.text;
        else if (b.type === 'tool_result') messages.push({ role: 'tool', tool_call_id: b.tool_use_id, content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content) });
      }
      if (text) messages.push({ role: 'user', content: text });
    } else if (m.role === 'assistant') {
      const blocks = Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }];
      let text = '';
      const tool_calls = [];
      for (const b of blocks) {
        if (b.type === 'text') text += (text ? '\n' : '') + b.text;
        else if (b.type === 'tool_use') tool_calls.push({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input || {}) } });
      }
      const msg = { role: 'assistant' };
      if (text) msg.content = text;
      if (tool_calls.length) msg.tool_calls = tool_calls;
      messages.push(msg);
    }
  }
  if (a.system) {
    const s = typeof a.system === 'string' ? a.system : extractText(a.system);
    system = system ? system + '\n' + s : s;
  }
  const o = { model: a.model || 'deepseek-chat', messages: [], stream: true, max_tokens: a.max_tokens || 4096 };
  if (system) o.messages.push({ role: 'system', content: system });
  o.messages.push(...messages);
  if (a.temperature != null) o.temperature = a.temperature;
  if (a.stop) o.stop = a.stop;
  if (a.tools) o.tools = a.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description || '', parameters: t.input_schema || { type: 'object', properties: {} } } }));
  if (a.tool_choice && a.tool_choice.type === 'tool') o.tool_choice = { type: 'function', function: { name: a.tool_choice.name } };
  return o;
}
function sendSSE(res, event, data) {
  res.write('event: ' + event + '\n');
  res.write('data: ' + JSON.stringify(data) + '\n\n');
}
function handleMessages(a, res) {
  const target = resolveProvider(a.model || '');
  if (!target) { res.writeHead(500); res.end(JSON.stringify({ error: '没有配置任何 provider，请检查 config.json 或设置 DEEPSEEK_KEY' })); return; }
  const provider = config.providers[target.provider];
  if (!provider.api_key) { res.writeHead(500); res.end(JSON.stringify({ error: 'provider [' + target.provider + '] 缺少 API key，请设置对应环境变量' })); return; }
  const openaiReq = convertRequest(Object.assign({}, a, { model: target.upstream }));
  const body = JSON.stringify(openaiReq);
  const u = new URL(provider.base_url);
  const options = {
    hostname: u.hostname,
    path: u.pathname + u.search,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + provider.api_key, 'Accept': 'text/event-stream' }
  };
  const req = https.request(options, (upstream) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    const msgId = 'msg_' + Date.now();
    sendSSE(res, 'message_start', { type: 'message_start', message: { id: msgId, type: 'message', role: 'assistant', model: a.model || target.upstream, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } });
    let textStarted = false, outputTokens = 0;
    const toolCalls = [];
    let buf = '';
    upstream.setEncoding('utf-8');
    upstream.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        let json;
        try { json = JSON.parse(data); } catch (e) { continue; }
        const choice = json.choices && json.choices[0];
        if (!choice) continue;
        const delta = choice.delta || {};
        if (delta.content) {
          if (!textStarted) { sendSSE(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }); textStarted = true; }
          sendSSE(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: delta.content } });
          outputTokens++;
        }
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            let slot = toolCalls[tc.index];
            if (!slot) { slot = { id: '', name: '', args: '' }; toolCalls[tc.index] = slot; }
            if (tc.id) slot.id = tc.id;
            if (tc.function && tc.function.name) slot.name = tc.function.name;
            if (tc.function && tc.function.arguments) slot.args += tc.function.arguments;
          }
        }
        if (choice.finish_reason) {
          if (textStarted) sendSSE(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
          toolCalls.forEach((slot, i) => {
            if (slot.name) {
              sendSSE(res, 'content_block_start', { type: 'content_block_start', index: i + 1, content_block: { type: 'tool_use', id: slot.id || ('tool_' + i), name: slot.name, input: {} } });
              sendSSE(res, 'content_block_delta', { type: 'content_block_delta', index: i + 1, delta: { type: 'input_json_delta', partial_json: slot.args } });
              sendSSE(res, 'content_block_stop', { type: 'content_block_stop', index: i + 1 });
            }
          });
          const stop = choice.finish_reason === 'tool_calls' ? 'tool_use' : (choice.finish_reason === 'length' ? 'max_tokens' : 'end_turn');
          sendSSE(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: outputTokens } });
          sendSSE(res, 'message_stop', { type: 'message_stop' });
          res.end();
        }
      }
    });
    upstream.on('end', () => {
      if (!res.writableEnded) {
        if (textStarted) sendSSE(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
        sendSSE(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: outputTokens } });
        sendSSE(res, 'message_stop', { type: 'message_stop' });
        res.end();
      }
    });
    upstream.on('error', (e) => { sendSSE(res, 'error', { type: 'error', error: { type: 'api_error', message: e.message } }); res.end(); });
  });
  req.on('error', (e) => { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); });
  req.write(body);
  req.end();
}
http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/v1/messages')) {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { try { handleMessages(JSON.parse(body), res); } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); } });
  } else if (req.method === 'GET' && req.url === '/health') { res.writeHead(200); res.end('OK'); }
  else if (req.method === 'GET' && req.url === '/models') {
    const models = Object.keys(modelMap);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ models, providers: Object.keys(config.providers) }));
  }
  else { res.writeHead(404); res.end(); }
}).listen(PORT, '127.0.0.1', () => {
  console.log('Claude Code 多模型代理已启动: http://localhost:' + PORT);
  console.log('已加载 providers:', Object.keys(config.providers).join(', '));
  console.log('支持的模型别名:', Object.keys(modelMap).join(', '));
});
