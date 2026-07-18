// 环境自检：检查 Node 版本、端口占用、Claude 配置、上游 Key 是否配置
// 退出码：Node 版本过低或端口被占 -> 1（阻断启动）；其余仅告警 -> 0
const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');

const PORT = process.env.PORT || 4000;
const CONFIG_PATH = process.env.PROXY_CONFIG || path.join(__dirname, 'config.json');
const CLAUDE_SETTINGS = path.join(process.env.USERPROFILE || process.env.HOME || '.', '.claude', 'settings.json');

function ok(m) { return '  \u2713 ' + m; }
function bad(m) { return '  \u2717 ' + m; }
function warn(m) { return '  \u26a0 ' + m; }

let block = false;

// 1. Node 版本
const major = parseInt(process.versions.node.split('.')[0], 10);
if (major >= 14) console.log(ok('Node.js v' + process.version + ' (>=14 ✓)'));
else { console.log(bad('Node.js 版本过低: v' + process.version + '，需要 >=14')); console.log('    请到 https://nodejs.org 下载安装 LTS 版本'); block = true; }

// 2. 端口占用
function checkPort(cb) {
  const srv = net.createServer();
  srv.once('error', (e) => {
    if (e.code === 'EADDRINUSE') { console.log(bad('端口 ' + PORT + ' 被占用，请先关闭占用程序或设置 PORT 环境变量')); block = true; }
    else { console.log(bad('端口检查失败: ' + e.message)); }
    cb();
  });
  srv.once('listening', () => { console.log(ok('端口 ' + PORT + ' 空闲可用')); srv.close(cb); });
  srv.listen(PORT, '127.0.0.1');
}
function step3() {
  // 3. Claude 配置
  if (fs.existsSync(CLAUDE_SETTINGS)) console.log(ok('Claude Code 配置存在: ' + CLAUDE_SETTINGS));
  else console.log(warn('未找到 Claude Code 配置: ' + CLAUDE_SETTINGS + '（可能尚未安装 Claude Code）'));

  // 4. 上游 Key 配置
  let n = 0;
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      for (const [name, p] of Object.entries(raw.providers || {})) {
        const envVar = (p.api_key || '').replace(/\$\{([^}]+)\}/g, '$1');
        if (envVar && process.env[envVar]) n++;
      }
    } catch (e) {}
  }
  if (n > 0) console.log(ok('已配置 ' + n + ' 个上游 API Key（环境变量）'));
  else console.log(warn('未检测到任何上游 API Key（可在 Web 界面填入，或设置 *_KEY 环境变量）'));

  console.log('');
  if (block) { console.log(bad('环境检查未通过，请先解决上述 ✗ 问题再启动。')); process.exit(1); }
  console.log(ok('环境检查通过，正在启动代理…'));
  process.exit(0);
}
checkPort(step3);
