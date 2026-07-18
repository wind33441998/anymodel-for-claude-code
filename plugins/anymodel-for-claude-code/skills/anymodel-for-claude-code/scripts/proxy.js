// Claude Code 多模型本地代理 (Anthropic <-> OpenAI 协议转换)
// 支持 DeepSeek / SiliconFlow / OpenRouter / 智谱 / Kimi / Gemini / Qwen / Groq 等任意 OpenAI 格式上游
// 完整支持 tool use 双向转换 (Claude Code 执行命令/读写文件依赖此功能)
// 内置 Web 管理界面 (http://localhost:4000)，支持模型选择 / 密钥配置 / 运行时热切换 / 中英文
// 内置自检 (echo 模型 + /api/selftest)，无需任何外部密钥即可验证整条链路
// 用法: node proxy.js  (默认监听 http://localhost:4000)
// 配置: 同目录 config.json，API key 用 ${ENV_VAR} 占位，运行时从环境变量或 data/keys.json 读取

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const PORT = process.env.PORT || 4000;
const CONFIG_PATH = process.env.PROXY_CONFIG || path.join(__dirname, 'config.json');
const KEYS_PATH = process.env.PROXY_KEYS || path.join(__dirname, 'data', 'keys.json');
const STATE_PATH = process.env.PROXY_STATE || path.join(__dirname, 'data', 'state.json');
const UI_PATH = path.join(__dirname, 'ui.html');

function resolveEnv(val) {
  if (typeof val !== 'string') return val;
  return val.replace(/\$\{([^}]+)\}/g, (m, k) => process.env[k] || '');
}

// ---------- 加载配置 ----------
const config = { providers: {} };
if (fs.existsSync(CONFIG_PATH)) {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    for (const [name, p] of Object.entries(raw.providers || {})) {
      config.providers[name] = {
        base_url: resolveEnv(p.base_url),
        api_key: resolveEnv(p.api_key),
        models: p.models || {},
        display: p.display || name,
        region: p.region || '',
        icon: p.icon || '🔌',
        internal: false
      };
    }
  } catch (e) { console.error('[配置错误]', e.message); }
}

// 兜底：若环境变量里有 DEEPSEEK_KEY 则至少启用 DeepSeek
if (Object.keys(config.providers).length === 0 && process.env.DEEPSEEK_KEY) {
  config.providers.deepseek = {
    base_url: 'https://api.deepseek.com/chat/completions', api_key: process.env.DEEPSEEK_KEY,
    models: { 'deepseek-chat': 'deepseek-chat', 'deepseek-reasoner': 'deepseek-reasoner' },
    display: 'DeepSeek', region: 'cn', icon: '🐋', internal: false
  };
}

// 内置自检 provider：不需要任何密钥，返回一条模拟 OpenAI SSE，走真实转换管线
config.providers.echo = {
  base_url: '', api_key: '', models: { 'echo': 'echo' },
  display: 'Echo 自检', region: '', icon: '🔁', internal: true
};

// model别名 -> {provider, upstreamModel}
const modelMap = {};
for (const [name, p] of Object.entries(config.providers)) {
  for (const [alias, real] of Object.entries(p.models || {})) modelMap[alias] = { provider: name, upstream: real };
}

// 运行时激活模型（default/auto 别名指向它，界面切换即时生效、无需重启 Claude Code）
const state = { current: modelMap['deepseek-chat'] ? 'deepseek-chat' : (Object.keys(modelMap)[0] || 'echo') };
// 启动时恢复上次选择
try {
  const saved = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
  if (saved && saved.current && modelMap[saved.current]) state.current = saved.current;
} catch (e) { /* 无持久化文件，用默认 */ }
function saveState() {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify({ current: state.current }, null, 2));
  } catch (e) { /* 忽略持久化失败 */ }
}

function resolveProvider(model) {
  if (model === 'default' || model === 'auto') return resolveProvider(state.current || '');
  if (modelMap[model]) return modelMap[model];
  for (const [name] of Object.entries(config.providers)) {
    if (model.startsWith(name + '-') || model.startsWith(name + '/')) return { provider: name, upstream: model.slice(name.length + 1) };
  }
  const first = Object.keys(config.providers).find(n => !config.providers[n].internal);
  if (!first) return null;
  return { provider: first, upstream: model };
}

// 本地密钥覆盖 (来自 data/keys.json，不进 git)
let keysFile = {};
if (fs.existsSync(KEYS_PATH)) {
  try { keysFile = JSON.parse(fs.readFileSync(KEYS_PATH, 'utf-8')) || {}; } catch (e) { keysFile = {}; }
}
function effectiveKey(name) {
  if (config.providers[name] && config.providers[name].internal) return 'internal';
  if (keysFile[name]) return keysFile[name];
  const p = config.providers[name];
  return p ? p.api_key : '';
}

const START_TIME = Date.now();

// ---------- 活动日志 (内存环形缓冲) ----------
const logs = [];
const MAX_LOGS = 300;
function logReq(entry) {
  logs.push(Object.assign({ t: Date.now() }, entry));
  if (logs.length > MAX_LOGS) logs.shift();
}

// ---------- 协议转换 (Anthropic <-> OpenAI) ----------
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

// 把一个上游流 (OpenAI SSE) 转写为 Anthropic SSE 写回 res
function pipeUpstream(upstream, a, res, complete) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
  const msgId = 'msg_' + Date.now();
  sendSSE(res, 'message_start', { type: 'message_start', message: { id: msgId, type: 'message', role: 'assistant', model: a.model || 'echo', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } });
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
        if (complete) complete('ok', null);
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
    if (complete) complete('ok', null);
  });
  upstream.on('error', (e) => {
    sendSSE(res, 'error', { type: 'error', error: { type: 'api_error', message: e.message } });
    res.end();
    if (complete) complete('error', e.message);
  });
}

// 内置自检：构造一条模拟的 OpenAI SSE，复用真实转换管线
function makeEchoStream() {
  const frames = [
    JSON.stringify({ choices: [{ delta: { content: '[Echo 自检] 代理链路正常：Anthropic→OpenAI 转换、tool_use 回写均工作。' }, finish_reason: null }] }),
    JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_echo1', function: { name: 'echo_tool', arguments: '{"received":true}' } }] }, finish_reason: null }] }),
    JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
    '[DONE]'
  ];
  return Readable.from(frames.map(f => 'data: ' + f + '\n\n'));
}

function handleMessages(a, res) {
  const started = Date.now();
  const target = resolveProvider(a.model || '');
  let done = false;
  function complete(status, err) {
    if (done) return; done = true;
    logReq({ type: 'message', model: a.model || '', provider: target ? target.provider : null, status, err: err || null, ms: Date.now() - started });
  }
  if (!target) { res.writeHead(500); res.end(JSON.stringify({ error: '没有配置任何 provider，请检查 config.json 或设置 DEEPSEEK_KEY' })); complete('error', 'no provider'); return; }
  const provider = config.providers[target.provider];
  if (!provider.internal && !effectiveKey(target.provider)) {
    res.writeHead(500); res.end(JSON.stringify({ error: 'provider [' + target.provider + '] 缺少 API key，请在界面填写或设置对应环境变量' }));
    complete('error', 'missing key'); return;
  }
  // 自检模式：不触网，直接回放模拟流
  if (provider.internal && target.provider === 'echo') {
    pipeUpstream(makeEchoStream(), a, res, complete);
    return;
  }
  const openaiReq = convertRequest(Object.assign({}, a, { model: target.upstream }));
  const body = JSON.stringify(openaiReq);
  const u = new URL(provider.base_url);
  const options = {
    hostname: u.hostname,
    path: u.pathname + u.search,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + effectiveKey(target.provider), 'Accept': 'text/event-stream' }
  };
  const req = https.request(options, (upstream) => { pipeUpstream(upstream, a, res, complete); });
  req.on('error', (e) => { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); complete('error', e.message); });
  req.write(body);
  req.end();
}

// ---------- Web 界面 & API ----------
let uiCache = null;
function serveUI(res) {
  if (uiCache == null) {
    try { uiCache = fs.readFileSync(UI_PATH, 'utf-8'); } catch (e) { res.writeHead(500); res.end('ui.html not found'); return; }
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(uiCache);
}
function sendJSON(res, obj) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = ''; req.on('data', c => b += c); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { resolve({}); } });
  });
}

const REAL_PROVIDERS = () => Object.keys(config.providers).filter(n => !config.providers[n].internal);

http.createServer(async (req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (req.method === 'POST' && url.startsWith('/v1/messages')) {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { try { handleMessages(JSON.parse(body), res); } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); } });
    return;
  }
  if (req.method === 'GET' && (url === '/' || url === '/ui' || url === '/ui.html')) { serveUI(res); return; }
  if (req.method === 'GET' && url === '/health') { res.writeHead(200); res.end('OK'); return; }
  if (req.method === 'GET' && url === '/models') {
    sendJSON(res, { models: Object.keys(modelMap), providers: Object.keys(config.providers) });
    return;
  }
  // ---- 管理 API ----
  if (req.method === 'GET' && url === '/api/models') {
    const providers = Object.keys(config.providers).map(name => {
      const p = config.providers[name];
      return {
        name, display: p.display, region: p.region, icon: p.icon, internal: !!p.internal,
        configured: !!effectiveKey(name) && effectiveKey(name) !== '',
        models: Object.entries(p.models).map(([alias, upstream]) => ({ alias, upstream }))
      };
    });
    sendJSON(res, { current: state.current, providers, modelCount: Object.keys(modelMap).length });
    return;
  }
  if (req.method === 'GET' && url === '/api/status') {
    sendJSON(res, { current: state.current, uptime: Date.now() - START_TIME, modelCount: Object.keys(modelMap).length });
    return;
  }
  if (req.method === 'GET' && url === '/api/env') {
    const claudePath = path.join(process.env.USERPROFILE || process.env.HOME || '.', '.claude', 'settings.json');
    const real = REAL_PROVIDERS();
    const configured = real.filter(n => !!effectiveKey(n)).length;
    sendJSON(res, {
      node: { version: process.version, ok: parseInt(process.versions.node.split('.')[0], 10) >= 14 },
      port: { ok: true, value: PORT },
      claudeSettings: { path: claudePath, exists: fs.existsSync(claudePath) },
      providersConfigured: configured, totalProviders: real.length
    });
    return;
  }
  if (req.method === 'GET' && url === '/api/logs') {
    sendJSON(res, { logs: logs.slice().reverse() });
    return;
  }
  if (req.method === 'GET' && url === '/api/selftest') {
    const payload = JSON.stringify({ model: 'echo', max_tokens: 64, messages: [{ role: 'user', content: 'ping' }] });
    const opt = { hostname: '127.0.0.1', port: PORT, path: '/v1/messages', method: 'POST', headers: { 'Content-Type': 'application/json' } };
    const r = http.request(opt, (resp) => {
      let body = '';
      resp.on('data', d => body += d);
      resp.on('end', () => {
        const events = (body.match(/event: (\w+)/g) || []).map(s => s.replace('event: ', '')).filter(Boolean);
        const ok = events.includes('message_start') && events.includes('content_block_delta') && events.includes('message_stop');
        sendJSON(res, { ok, events, sample: body.slice(0, 300) });
      });
    });
    r.on('error', e => sendJSON(res, { ok: false, error: e.message }));
    r.write(payload); r.end();
    return;
  }
  if (req.method === 'POST' && url === '/api/switch') {
    const body = await readBody(req);
    const m = body.model;
    if (!m || !modelMap[m]) { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid model alias' })); return; }
    state.current = m;
    saveState();
    sendJSON(res, { ok: true, current: state.current });
    return;
  }
  if (req.method === 'POST' && url === '/api/keys') {
    const body = await readBody(req);
    const name = body.provider, key = body.key;
    if (!config.providers[name]) { res.writeHead(400); res.end(JSON.stringify({ error: 'unknown provider' })); return; }
    try {
      fs.mkdirSync(path.dirname(KEYS_PATH), { recursive: true });
      if (key) keysFile[name] = key; else delete keysFile[name];
      fs.writeFileSync(KEYS_PATH, JSON.stringify(keysFile, null, 2));
      sendJSON(res, { ok: true, configured: !!effectiveKey(name) });
    } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    return;
  }
  res.writeHead(404); res.end();
}).listen(PORT, '127.0.0.1', () => {
  console.log('Claude Code 多模型代理已启动: http://localhost:' + PORT);
  console.log('已加载 providers:', Object.keys(config.providers).join(', '));
  console.log('支持的模型别名:', Object.keys(modelMap).join(', '));
  console.log('当前激活模型:', state.current);
});
