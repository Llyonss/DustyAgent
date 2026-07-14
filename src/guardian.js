/**
 * Guardian — 守护进程
 *
 * 职责：
 *   1. 管理 Mental 服务（启动/停止/重启）
 *   2. 作为唯一远程入口：SSH 反向隧道 → :9090 → :3004
 *   3. 反向代理：非 /guardian/* 请求转发到 Mental (:3003)
 *   4. Mental 挂了时返回管理页面，可一键重启
 *
 * 用法：node src/guardian.js
 * 远端：http://<SSH_HOST>:9090/guardian/
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const net = require('net');
const { spawn, execSync } = require('child_process');
const { Client } = require('ssh2');

// ═══════════════════════════════════════════
// 1. 配置
// ═══════════════════════════════════════════

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const GUARDIAN_PORT = parseInt(process.env.GUARDIAN_PORT || '3004', 10);
const MENTAL_PORT = parseInt(process.env.MENTAL_PORT || '3003', 10);
const MENTAL_SCRIPT = path.resolve(__dirname, 'agent/mental/web/index.js');
const PROJECT_ROOT = path.resolve(__dirname, '..');

const AUTH_USER = process.env.AUTH_USER || 'dusty';
const AUTH_PASS = process.env.AUTH_PASS || 'dusty4ever';
const AUTO_RESTART = process.env.GUARDIAN_AUTO_RESTART === 'true';

// SSH tunnel config
const SSH_HOST = process.env.SSH_HOST;
const SSH_PORT = 22;
const SSH_USER = process.env.SSH_USER;
const SSH_PASS = process.env.SSH_PASS;
const REMOTE_TUNNEL_PORT = parseInt(process.env.SSH_TUNNEL_PORT || '9090', 10);

// ═══════════════════════════════════════════
// 2. 状态
// ═══════════════════════════════════════════

const state = {
  mental: null,        // child_process
  mentalPid: null,
  mentalRunning: false,
  mentalStartTime: null,
  restartCount: 0,
  lastError: null,
  lastHealthCheck: null,
  healthOk: false,
  mentalLogs: [],      // 最近 N 条日志
  maxLogLines: 200,
  _shuttingDown: false,
};

function log(level, msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${msg}`;
  console.log(line);
  state.mentalLogs.push(line);
  if (state.mentalLogs.length > state.maxLogLines) state.mentalLogs.shift();
}

// ═══════════════════════════════════════════
// 3. Basic Auth 校验
// ═══════════════════════════════════════════

function checkAuth(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) return false;
  try {
    const [user, pass] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
    return user === AUTH_USER && pass === AUTH_PASS;
  } catch { return false; }
}

function authMiddleware(req, res, next) {
  if (!checkAuth(req)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="DustyGuardian"');
    res.statusCode = 401;
    res.end('Authentication required');
    return;
  }
  next();
}

// ═══════════════════════════════════════════
// 4. 进程管理
// ═══════════════════════════════════════════

function isPortInUse(port) {
  try {
    const result = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, {
      timeout: 3000, windowsHide: true, encoding: 'utf-8'
    });
    return !!result.trim();
  } catch { return false; }
}

function getPidOnPort(port) {
  try {
    const result = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, {
      timeout: 3000, windowsHide: true, encoding: 'utf-8'
    });
    const match = result.trim().match(/(\d+)\s*$/m);
    return match ? parseInt(match[1], 10) : null;
  } catch { return null; }
}

function killByPid(pid) {
  try {
    execSync(`taskkill /F /PID ${pid}`, { timeout: 5000, windowsHide: true });
    return true;
  } catch { return false; }
}

function startMental() {
  // 如果端口上有进程在跑，直接收养（不管 state.mental 是什么状态）
  const pidOnPort = getPidOnPort(MENTAL_PORT);
  if (pidOnPort) {
    log('info', `Port ${MENTAL_PORT} occupied by PID ${pidOnPort}, adopting existing mental`);
    state.mental = null; // 没有子进程句柄，无法直接 kill，但可以通过端口杀
    state.mentalPid = pidOnPort;
    state.mentalRunning = true;
    state.mentalStartTime = Date.now();
    state.lastError = null;
    return true;
  }

  // 端口空闲，spawn 新进程
  log('info', `Starting mental: node ${MENTAL_SCRIPT}`);

  const child = spawn('node', [MENTAL_SCRIPT], {
    cwd: PROJECT_ROOT,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, MENTAL_PORT: String(MENTAL_PORT) },
  });

  child.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) log('mental', line);
  });

  child.stderr.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) log('mental:err', line);
  });

  child.on('error', (err) => {
    state.lastError = err.message;
    state.mentalRunning = false;
    log('error', `Mental spawn error: ${err.message}`);
  });

  child.on('exit', (code, signal) => {
    state.mentalRunning = false;
    state.mentalPid = null;
    state.mental = null;
    state.healthOk = false;
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    log('warn', `Mental exited (${reason})`);

    if (AUTO_RESTART && !state._shuttingDown) {
      log('info', `Auto-restart in 3s...`);
      setTimeout(() => {
        if (!state._shuttingDown) {
          state.restartCount++;
          startMental();
        }
      }, 3000);
    }
  });

  state.mental = child;
  state.mentalPid = child.pid;
  state.mentalRunning = true;
  state.mentalStartTime = Date.now();
  state.lastError = null;

  return true;
}

function stopMental() {
  // 优先用记录的 PID，否则从端口查
  const pid = state.mentalPid || (state.mental && state.mental.pid);
  if (!pid) {
    const portPid = getPidOnPort(MENTAL_PORT);
    if (portPid) {
      log('info', `Killing mental on port ${MENTAL_PORT} (PID ${portPid})`);
      killByPid(portPid);
    } else {
      log('warn', 'Mental not running');
    }
  } else {
    log('info', `Stopping mental (PID ${pid})`);
    if (state.mental) {
      // 有 child 句柄，用 .kill()
      try { state.mental.kill('SIGKILL'); } catch {}
      // 也用 taskkill 确保死透
      try { execSync(`taskkill /F /PID ${pid}`, { timeout: 5000, windowsHide: true }); } catch {}
    } else {
      // 收养的进程，没有 child 句柄，用 taskkill
      killByPid(pid);
    }
  }

  // 清除引用，让 startMental 能正常 spawn
  state.mental = null;
  state.mentalRunning = false;
  state.mentalPid = null;
  state.healthOk = false;
  return true;
}

function restartMental() {
  stopMental();
  // 等端口释放
  const start = Date.now();
  while (isPortInUse(MENTAL_PORT) && Date.now() - start < 5000) {
    const end = Date.now() + 200;
    while (Date.now() < end) { /* spin */ }
  }
  state.restartCount++;
  return startMental();
}

// ═══════════════════════════════════════════
// 5. 健康检查
// ═══════════════════════════════════════════

function healthCheck() {
  return new Promise((resolve) => {
    // 先做 TCP 端口探测（快速、可靠，不依赖 HTTP 响应）
    const socket = net.createConnection({ host: '127.0.0.1', port: MENTAL_PORT }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(2000, () => { socket.destroy(); resolve(false); });
  });
}

let healthTimer = null;

function startHealthCheck(intervalMs = 15000) {
  if (healthTimer) clearInterval(healthTimer);
  healthTimer = setInterval(async () => {
    state.lastHealthCheck = Date.now();
    state.healthOk = await healthCheck();
    // 更新 mentalRunning 以反映真实状态
    if (!state.healthOk) {
      // 端口探测失败 → 可能真的挂了，但也可能只是临时不响应
      // 只有确认端口上也无进程时才标记为停止
      const portPid = getPidOnPort(MENTAL_PORT);
      if (!portPid) {
        state.mentalRunning = false;
        state.mentalPid = null;
      } else {
        // 端口上有进程，保持 running 状态
        state.healthOk = true;
      }
    } else {
      state.mentalRunning = true;
    }
  }, intervalMs);
}

// ═══════════════════════════════════════════
// 6. HTTP 反向代理
// ═══════════════════════════════════════════

function proxyToMental(req, res) {
  // 如果 mental 没在运行，返回管理页面
  if (!state.mentalRunning) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(getDownPage());
    return;
  }

  const options = {
    hostname: '127.0.0.1',
    port: MENTAL_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers },
  };
  // 修正 host header
  options.headers.host = `127.0.0.1:${MENTAL_PORT}`;
  delete options.headers['proxy-connection'];

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    log('error', `Proxy error: ${err.message}`);
    res.statusCode = 502;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(getDownPage());
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    res.statusCode = 504;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(getDownPage());
  });

  proxyReq.setTimeout(30000);

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    req.pipe(proxyReq);
  } else {
    proxyReq.end();
  }
}

// ═══════════════════════════════════════════
// 7. WebSocket 代理
// ═══════════════════════════════════════════

function proxyWebSocket(req, socket, head) {
  if (!state.mentalRunning) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
    socket.destroy();
    return;
  }

  const target = net.createConnection({ host: '127.0.0.1', port: MENTAL_PORT }, () => {
    // 转发升级请求
    const headers = [];
    for (const [k, v] of Object.entries(req.headers)) {
      headers.push(`${k}: ${v}`);
    }
    headers.push(`Host: 127.0.0.1:${MENTAL_PORT}`);

    target.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers.join('\r\n')}\r\n\r\n`);

    if (head.length > 0) {
      target.write(head);
    }

    // 双向 pipe
    socket.pipe(target).pipe(socket);

    socket.on('error', () => target.destroy());
    target.on('error', () => socket.destroy());
    socket.on('close', () => target.destroy());
    target.on('close', () => socket.destroy());
  });

  target.on('error', () => {
    socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    socket.destroy();
  });
}

// ═══════════════════════════════════════════
// 8. Guardian API
// ═══════════════════════════════════════════

function getUptime() {
  if (!state.mentalStartTime) return 0;
  return Math.floor((Date.now() - state.mentalStartTime) / 1000);
}

function getGuardianUptime() {
  return Math.floor((Date.now() - guardianStartTime) / 1000);
}

let guardianStartTime = Date.now();

function handleGuardianApi(req, res) {
  const url = new URL(req.url, 'http://localhost');

  // GET /guardian/api/status
  if (url.pathname === '/guardian/api/status') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      guardian: {
        uptime: getGuardianUptime(),
        port: GUARDIAN_PORT,
        tunnelRemotePort: REMOTE_TUNNEL_PORT,
        tunnelActive: tunnelActive,
      },
      mental: {
        running: state.mentalRunning && state.healthOk,
        pid: state.mentalPid,
        uptime: state.mentalRunning ? getUptime() : 0,
        port: MENTAL_PORT,
        restartCount: state.restartCount,
        lastError: state.lastError,
        autoRestart: AUTO_RESTART,
        lastHealthCheck: state.lastHealthCheck,
      },
    }, null, 2));
    return;
  }

  // GET /guardian/api/mental/logs
  if (url.pathname === '/guardian/api/mental/logs') {
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      logs: state.mentalLogs.slice(-limit),
      total: state.mentalLogs.length,
    }));
    return;
  }

  // POST /guardian/api/mental/start
  if (url.pathname === '/guardian/api/mental/start' && req.method === 'POST') {
    const ok = startMental();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok, running: state.mentalRunning }));
    return;
  }

  // POST /guardian/api/mental/stop
  if (url.pathname === '/guardian/api/mental/stop' && req.method === 'POST') {
    const ok = stopMental();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok, running: false }));
    return;
  }

  // POST /guardian/api/mental/restart
  if (url.pathname === '/guardian/api/mental/restart' && req.method === 'POST') {
    const ok = restartMental();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok, running: state.mentalRunning }));
    return;
  }

  // GET /guardian/ or /guardian/index.html
  if (url.pathname === '/guardian/' || url.pathname === '/guardian/index.html' || url.pathname === '/guardian') {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'guardian', 'public', 'index.html'), 'utf-8');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(html);
    } catch (e) {
      res.statusCode = 500;
      res.end('Failed to load dashboard: ' + e.message);
    }
    return;
  }

  // 404
  res.statusCode = 404;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: 'not found' }));
}

// ═══════════════════════════════════════════
// 9. UI 页面 — 仪表盘 HTML 从 src/guardian/public/index.html 读取
//    下线页面仍内联（因为它在 Mental 挂了时需要独立可用）
// ═══════════════════════════════════════════

function _unused_getDashboard() {
  const mentalStatus = state.mentalRunning && state.healthOk
    ? '<span style="color:#4CAF50">● 运行中</span>'
    : '<span style="color:#f44336">● 已停止</span>';

  const tunnelStatus = tunnelActive
    ? '<span style="color:#4CAF50">● 已连接</span>'
    : '<span style="color:#f44336">● 未连接</span>';

  const uptimeMins = state.mentalRunning ? Math.floor(getUptime() / 60) : 0;
  const uptimeStr = uptimeMins >= 60
    ? `${Math.floor(uptimeMins / 60)}h ${uptimeMins % 60}m`
    : `${uptimeMins}m`;

  const guardianMins = Math.floor(getGuardianUptime() / 60);
  const guardianUptimeStr = guardianMins >= 60
    ? `${Math.floor(guardianMins / 60)}h ${guardianMins % 60}m`
    : `${guardianMins}m`;

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Guardian — Dusty14 管理</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0d1117; color: #c9d1d9; min-height: 100vh; display: flex; justify-content: center; padding: 40px 20px; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 24px; max-width: 600px; width: 100%; }
  h1 { font-size: 20px; margin-bottom: 8px; color: #58a6ff; }
  .subtitle { font-size: 13px; color: #8b949e; margin-bottom: 24px; }
  .status-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #21262d; }
  .status-row:last-child { border-bottom: none; }
  .label { font-size: 13px; color: #8b949e; }
  .value { font-size: 14px; font-weight: 500; }
  .actions { display: flex; gap: 10px; margin-top: 20px; }
  button { flex: 1; padding: 10px 16px; border: 1px solid #30363d; border-radius: 6px; font-size: 14px; cursor: pointer; background: #21262d; color: #c9d1d9; transition: all .2s; }
  button:hover { background: #30363d; }
  button.primary { background: #238636; border-color: #2ea043; color: #fff; }
  button.primary:hover { background: #2ea043; }
  button.danger { background: #da3633; border-color: #f85149; color: #fff; }
  button.danger:hover { background: #f85149; }
  .log-area { margin-top: 20px; background: #0d1117; border: 1px solid #21262d; border-radius: 6px; padding: 12px; max-height: 300px; overflow-y: auto; font-family: "SF Mono", "Cascadia Code", Consolas, monospace; font-size: 11px; line-height: 1.5; white-space: pre-wrap; word-break: break-all; }
  .toast { position: fixed; top: 20px; right: 20px; padding: 10px 20px; border-radius: 6px; font-size: 14px; z-index: 999; display: none; }
  .toast.ok { background: #238636; }
  .toast.err { background: #da3633; }
  .link-row { margin-top: 16px; font-size: 13px; }
  .link-row a { color: #58a6ff; }
</style>
</head>
<body>
<div class="card">
  <h1>🛡️ Guardian</h1>
  <div class="subtitle">Dusty14 守护进程 · 运行 ${guardianUptimeStr}</div>

  <div class="status-row">
    <span class="label">Mental 服务</span>
    <span class="value">${mentalStatus}</span>
  </div>
  <div class="status-row">
    <span class="label">PID</span>
    <span class="value">${state.mentalPid || '—'}</span>
  </div>
  <div class="status-row">
    <span class="label">运行时长</span>
    <span class="value">${state.mentalRunning ? uptimeStr : '—'}</span>
  </div>
  <div class="status-row">
    <span class="label">重启次数</span>
    <span class="value">${state.restartCount}</span>
  </div>
  <div class="status-row">
    <span class="label">自动重启</span>
    <span class="value">${AUTO_RESTART ? '✅ 开启' : '❌ 关闭'}</span>
  </div>
  <div class="status-row">
    <span class="label">SSH 隧道</span>
    <span class="value">${tunnelStatus}</span>
  </div>

  <div class="actions">
    <button class="primary" onclick="action('start')">▶ 启动</button>
    <button onclick="action('restart')">↻ 重启</button>
    <button class="danger" onclick="action('stop')">⏹ 停止</button>
  </div>

  <div class="link-row">
    → <a href="/" target="_blank">打开 Dusty14 主界面</a>
  </div>

  <div class="log-area" id="logs">加载中...</div>
</div>

<div class="toast" id="toast"></div>

<script>
  async function action(cmd) {
    try {
      const r = await fetch('/guardian/api/mental/' + cmd, { method: 'POST' });
      const j = await r.json();
      toast(cmd + (j.ok ? ' OK' : ' 失败'), j.ok ? 'ok' : 'err');
      setTimeout(() => location.reload(), 800);
    } catch(e) {
      toast('请求失败: ' + e.message, 'err');
    }
  }

  async function loadLogs() {
    try {
      const r = await fetch('/guardian/api/mental/logs?limit=80');
      const j = await r.json();
      document.getElementById('logs').textContent = j.logs.join('\\n') || '(暂无日志)';
    } catch(e) {
      document.getElementById('logs').textContent = '加载失败';
    }
  }

  function toast(msg, type) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast ' + type;
    el.style.display = 'block';
    setTimeout(() => el.style.display = 'none', 2000);
  }

  loadLogs();
  setInterval(loadLogs, 5000);
</script>
</body>
</html>`;
}

function getDownPage() {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>服务已停止 — Guardian</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0a0e14; color: #c9d1d9; min-height: 100vh; display: flex; justify-content: center; align-items: center; }
  .card { background: #11161e; border: 1px solid #1e2530; border-radius: 10px; padding: 48px; text-align: center; max-width: 460px; }
  .emoji { font-size: 56px; margin-bottom: 16px; }
  .title { font-size: 18px; font-weight: 600; margin-bottom: 8px; }
  .desc { color: #6b7785; margin-bottom: 28px; font-size: 14px; }
  a { color: #3b82f6; font-size: 14px; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .actions { display: flex; gap: 10px; justify-content: center; }
  button { padding: 12px 28px; border: 1px solid #1a3c2e; border-radius: 8px; font-size: 15px; cursor: pointer; background: #162620; color: #22c55e; transition: all .15s; font-weight: 500; }
  button:hover { background: #1a3c2e; }
  button:active { transform: scale(.98); }
  #msg { color: #3b82f6; margin-top: 16px; font-size: 14px; display: none; }
  .link { margin-top: 24px; }
</style>
</head>
<body>
<div class="card">
  <div class="emoji">🔌</div>
  <div class="title">Dusty14 服务未运行</div>
  <div class="desc">Mental 进程已停止，Guardian 仍在守候</div>
  <div class="actions">
    <button onclick="restart()">🚀 一键启动</button>
  </div>
  <p id="msg"></p>
  <div class="link"><a href="/guardian/">→ 打开 Guardian 管理面板</a></div>
</div>
<script>
  async function restart() {
    const msg = document.getElementById('msg');
    msg.style.display = 'block';
    msg.textContent = '启动中...';
    try {
      await fetch('/guardian/api/mental/restart', { method: 'POST', headers: { Authorization: 'Basic ' + btoa('dusty:dusty4ever') }});
      msg.textContent = '已发送启动指令，3秒后刷新...';
      setTimeout(() => location.href = '/', 3000);
    } catch(e) {
      msg.textContent = '失败: ' + e.message;
    }
  }
</script>
</body>
</html>`;
}

// ═══════════════════════════════════════════
// 10. SSH 隧道
// ═══════════════════════════════════════════

let tunnelActive = false;
let tunnelReconnectTimer = null;

function connectTunnel() {
  if (!SSH_HOST) {
    log('warn', 'SSH_HOST not configured, tunnel disabled');
    return;
  }

  const conn = new Client();
  let connected = false;

  conn.on('ready', () => {
    connected = true;
    log('info', `Tunnel SSH connected to ${SSH_HOST}`);

    conn.forwardIn('0.0.0.0', REMOTE_TUNNEL_PORT, (err) => {
      if (err) {
        log('error', `Tunnel forward failed: ${err.message}`);
        conn.end();
        return;
      }
      tunnelActive = true;
      log('info', `✓ Tunnel active: http://${SSH_HOST}:${REMOTE_TUNNEL_PORT} → localhost:${GUARDIAN_PORT}`);
    });
  });

  conn.on('tcp connection', (info, accept) => {
    const remote = accept();
    const local = net.createConnection({ host: '127.0.0.1', port: GUARDIAN_PORT });

    let localReady = false;
    const buffer = [];

    remote.on('data', (chunk) => {
      if (localReady) local.write(chunk);
      else buffer.push(chunk);
    });

    local.on('connect', () => {
      localReady = true;
      for (const b of buffer) local.write(b);
      buffer.length = 0;
    });

    local.pipe(remote);

    local.on('error', (err) => {
      log('error', `Tunnel local error: ${err.message}`);
      try { remote.close(); } catch {}
    });
    remote.on('error', () => { try { local.destroy(); } catch {} });
    remote.on('close', () => { try { local.destroy(); } catch {} });
    local.on('close', () => { try { remote.close(); } catch {} });
    remote.on('end', () => { try { local.end(); } catch {} });
    local.on('end', () => { try { remote.end(); } catch {} });
  });

  conn.on('error', (err) => {
    log('error', `Tunnel SSH error: ${err.message}`);
    tunnelActive = false;
    scheduleTunnelReconnect();
  });

  conn.on('close', () => {
    if (connected) log('warn', 'Tunnel connection closed, reconnecting...');
    tunnelActive = false;
    scheduleTunnelReconnect();
  });

  conn.connect({
    host: SSH_HOST,
    port: SSH_PORT,
    username: SSH_USER,
    password: SSH_PASS,
    keepaliveInterval: 10000,
    keepaliveCountMax: 3,
    readyTimeout: 10000,
  });
}

function scheduleTunnelReconnect() {
  if (tunnelReconnectTimer) return;
  tunnelReconnectTimer = setTimeout(() => {
    tunnelReconnectTimer = null;
    connectTunnel();
  }, 3000);
}

// ═══════════════════════════════════════════
// 11. HTTP Server — 主路由
// ═══════════════════════════════════════════

function createServer() {
  const server = http.createServer((req, res) => {
    // 所有请求需要 Basic Auth
    if (!checkAuth(req)) {
      res.setHeader('WWW-Authenticate', 'Basic realm="DustyGuardian"');
      res.statusCode = 401;
      res.end('Authentication required');
      return;
    }

    const url = new URL(req.url, 'http://localhost');

    // /guardian/* → Guardian 自己处理
    if (url.pathname.startsWith('/guardian/') || url.pathname === '/guardian') {
      handleGuardianApi(req, res);
      return;
    }

    // 其他所有路径 → 代理到 Mental
    proxyToMental(req, res);
  });

  // WebSocket 升级
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');

    // 检查 Basic Auth
    let authed = false;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Basic ')) {
      try {
        const [user, pass] = Buffer.from(authHeader.slice(6), 'base64').toString().split(':');
        if (user === AUTH_USER && pass === AUTH_PASS) authed = true;
      } catch {}
    }
    if (!authed) {
      // fallback to ?auth= query param
      const token = url.searchParams.get('auth');
      if (token) {
        try {
          const [user, pass] = Buffer.from(token, 'base64').toString().split(':');
          if (user === AUTH_USER && pass === AUTH_PASS) authed = true;
        } catch {}
      }
    }
    if (!authed) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // WebSocket 代理到 Mental
    proxyWebSocket(req, socket, head);
  });

  return server;
}

// ═══════════════════════════════════════════
// 11.5 自我脱离 — 如果 Guardian 是被 shell 启动的（可能是 Mental 的子进程），
//      重新 spawn 一个 detached 的自己，旧进程退出。
//      新进程不在任何进程树中，Mental 挂了也不影响 Guardian。
// ═══════════════════════════════════════════

function selfDetachIfNeeded() {
  // 通过环境变量标记：如果已经是 detached 的，跳过
  if (process.env.GUARDIAN_DETACHED === '1') return false;

  const isWin = process.platform === 'win32';
  log('info', 'Self-detaching from parent process tree...');

  const args = [__filename];
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, GUARDIAN_DETACHED: '1' },
  });
  child.unref();
  log('info', `Detached Guardian spawned (PID ${child.pid}), exiting current process...`);
  return true;
}

// ═══════════════════════════════════════════
// 12. 启动
// ═══════════════════════════════════════════

if (require.main === module) {
  // 如果不是 detached 模式，先脱离再启动真正的 Guardian
  if (selfDetachIfNeeded()) {
    // 给新进程一点时间启动，然后退出旧的
    setTimeout(() => process.exit(0), 500);
    return;
  }
  process.on('SIGINT', () => {
    log('info', 'Guardian shutting down...');
    state._shuttingDown = true;
    stopMental();
    if (healthTimer) clearInterval(healthTimer);
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    state._shuttingDown = true;
    stopMental();
    process.exit(0);
  });

  log('info', '══════════════════════════════════');
  log('info', 'Guardian starting...');
  log('info', `Project root: ${PROJECT_ROOT}`);
  log('info', `Guardian port: ${GUARDIAN_PORT}`);
  log('info', `Mental port:   ${MENTAL_PORT}`);
  log('info', `Auto restart:  ${AUTO_RESTART}`);
  log('info', '══════════════════════════════════');

  // 1. 启动 Mental
  startMental();

  // 2. 等 Mental 就绪后启动健康检查
  setTimeout(() => {
    startHealthCheck(15000);
  }, 3000);

  // 3. 启动 HTTP Server
  const server = createServer();
  server.listen(GUARDIAN_PORT, '0.0.0.0', () => {
    log('info', `Guardian HTTP listening on http://0.0.0.0:${GUARDIAN_PORT}`);
    log('info', `Dashboard: http://0.0.0.0:${GUARDIAN_PORT}/guardian/`);
  });

  // 4. 启动 SSH 隧道
  connectTunnel();
}
