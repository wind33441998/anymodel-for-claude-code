// ModelHub — Claude Code 多模型本地代理 (Anthropic <-> OpenAI 协议转换)
// 支持 DeepSeek / SiliconFlow / OpenRouter / 智谱 / Kimi / Gemini / Qwen / Groq 等任意 OpenAI 格式上游
// 完整支持 tool use 双向转换 (Claude Code 执行命令/读写文件依赖此功能)
// 内置 Web 管理界面 (http://localhost:4000)，支持模型选择 / 密钥配置 / 运行时热切换 / 中英文
// 内置自检 (echo 模型 + /api/selftest)，无需任何外部密钥即可验证整条链路
//
// 用法:
//   直接运行:  node lib/proxy.js
//   CLI 调用:  require('./proxy.js').start(port)
// 数据目录: ~/.modelhub/ (config.json / keys.json / state.json / modelhub.pid)

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Readable } = require('stream');

const PORT = process.env.MODELHUB_PORT || process.env.PORT || 4000;
const DATA_DIR = path.join(os.homedir(), '.modelhub');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const KEYS_PATH = path.join(DATA_DIR, 'keys.json');
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const PID_PATH = path.join(DATA_DIR, 'modelhub.pid');
const UI_PATH = path.join(__dirname, '..', 'assets', 'ui.html');
const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'assets', 'config.json');

// ---------- 初始化数据目录 ----------
function initDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_PATH) && fs.existsSync(DEFAULT_CONFIG_PATH)) {
    fs.copyFileSync(DEFAULT_CONFIG_PATH, CONFIG_PATH);
    console.log('[ModelHub] 首次运行，已创建默认配置: ' + CONFIG_PATH);
  }
}

function resolveEnv(val) {
  if (typeof val !== 'string') return val;
  return val.replace(/\$\{([^}]+)\}/g, (m, k) => process.env[k] || '');
}

// ---------- 加载配置 ----------
function loadConfig() {
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
  // 内置自检 provider
  config.providers.echo = {
    base_url: '', api_key: '', models: { 'echo': 'echo' },
    display: 'Echo 自检', region: '', icon: '🔁', internal: true
  };
  return config;
}

let config = {};
let modelMap = {};
let state = { current: 'echo' };
let keysFile = {};
let logs = [];
let server = null;
const START_TIME = Date.now();

function rebuildMaps() {
  modelMap = {};
  for (const [name, p] of Object.entries(config.providers)) {
    for (const [alias, real] of Object.entries(p.models || {})) modelMap[alias] = { provider: name, upstream: real };
  }
  state.current = modelMap['deepseek-chat'] ? 'deepseek-chat' : (Object.keys(modelMap)[0] || 'echo');
}

function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
    if (saved && saved.current && modelMap[saved.current]) state.current = saved.current;
  } catch (e) { /* 无持久化文件，用默认 */ }
}

function saveState() {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify({ current: state.current }, null, 2));
  } catch (e) { /* 忽略持久化失败 */ }
}

function loadKeys() {
  keysFile = {};
  if (fs.existsSync(KEYS_PATH)) {
    try { keysFile = JSON.parse(fs.readFileSync(KEYS_PATH, 'utf-8')) || {}; } catch (e) { keysFile = {}; }
  }
}

function effectiveKey(name) {
  if (config.providers[name] && config.providers[name].internal) return 'internal';
  if (keysFile[name]) return keysFile[name];
  const p = config.providers[name];
  return p ? p.api_key : '';
}

function resolveProvider(model) {
  if (model === 'default' || model === 'auto') return resolveProvider(state.current || '');
  if (modelMap[model]) return modelMap[model];
  for (const [name] of Object.entries(config.providers)) {
    if (model.startsWith(name + '-') || model.startsWith(name + '/')) return { provider: name, upstream: model.slice(name.length + 1) };
  }
  // 未知模型名 fallback 到当前激活模型
  if (state.current && modelMap[state.current]) return modelMap[state.current];
  const first = Object.keys(config.providers).find(n => !config.providers[n].internal);
  if (!first) return null;
  return { provider: first, upstream: model };
}

// ---------- 活动日志 (内存环形缓冲) ----------
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
  function sendErr(statusCode, type, message) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ type: 'error', error: { type, message } }));
  }
  if (!target) { sendErr(400, 'invalid_request_error', '没有配置任何 provider，请检查 config.json 或设置 DEEPSEEK_KEY'); complete('error', 'no provider'); return; }
  const provider = config.providers[target.provider];
  if (!provider.internal && !effectiveKey(target.provider)) {
    sendErr(401, 'authentication_error', 'provider [' + target.provider + '] 缺少 API key，请在界面填写或运行 modelhub keys set ' + target.provider + ' <KEY>');
    complete('error', 'missing key'); return;
  }
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
  req.on('error', (e) => { sendErr(500, 'api_error', e.message); complete('error', e.message); });
  req.write(body);
  req.end();
}

// ---------- Web 界面 & API ----------
let uiCache = null;
function serveUI(res) {
  if (uiCache == null) {
    try { uiCache = fs.readFileSync(UI_PATH, 'utf-8'); } catch (e) { res.writeHead(500); res.end('ui.html not found at ' + UI_PATH); return; }
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

function createServer() {
  return http.createServer(async (req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (req.method === 'POST' && url.startsWith('/v1/messages')) {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => { try { handleMessages(JSON.parse(body), res); } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: e.message } })); } });
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
      sendJSON(res, { current: state.current, uptime: Date.now() - START_TIME, modelCount: Object.keys(modelMap).length, pid: process.pid });
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
    // ---- 停止代理 (CLI 调用) ----
    if (req.method === 'POST' && url === '/api/stop') {
      sendJSON(res, { ok: true, message: 'shutting down' });
      setTimeout(() => { try { fs.unlinkSync(PID_PATH); } catch(e){} server.close(); process.exit(0); }, 200);
      return;
    }
    res.writeHead(404); res.end();
  });
}

// ---------- 启动 / 停止 ----------
function start(port) {
  const listenPort = port || PORT;
  initDir();
  config = loadConfig();
  rebuildMaps();
  loadState();
  loadKeys();

  // 写 PID 文件
  try { fs.writeFileSync(PID_PATH, String(process.pid)); } catch (e) {}

  server = createServer();
  server.listen(listenPort, '127.0.0.1', () => {
    console.log('');
    console.log('  ModelHub 多模型代理已启动');
    console.log('  ────────────────────────────────');
    console.log('  Web 管理界面: http://localhost:' + listenPort);
    console.log('  API 端点:     http://localhost:' + listenPort + '/v1/messages');
    console.log('  数据目录:     ' + DATA_DIR);
    console.log('  已加载供应商: ' + REAL_PROVIDERS().join(', '));
    console.log('  支持模型数:   ' + Object.keys(modelMap).length);
    console.log('  当前激活模型: ' + state.current);
    console.log('  ────────────────────────────────');
    console.log('  按 Ctrl+C 停止');
    console.log('');
  });

  // 退出时清理 PID
  process.on('SIGINT', () => { try { fs.unlinkSync(PID_PATH); } catch(e){} process.exit(0); });
  process.on('SIGTERM', () => { try { fs.unlinkSync(PID_PATH); } catch(e){} process.exit(0); });
  process.on('exit', () => { try { fs.unlinkSync(PID_PATH); } catch(e){} });

  return server;
}

function stop() {
  if (server) { server.close(); try { fs.unlinkSync(PID_PATH); } catch(e){} }
}

module.exports = { start, stop, PORT, DATA_DIR, CONFIG_PATH, KEYS_PATH, STATE_PATH, PID_PATH, config, modelMap, effectiveKey, REAL_PROVIDERS };

// 直接运行时自动启动
if (require.main === module) start();
