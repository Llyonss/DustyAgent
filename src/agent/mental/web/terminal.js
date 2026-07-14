// === 终端进程管理器 ===
// 单一数据源模型：每个 PTY 会话只有一个 onData/onExit 分发点，
// 所有 WebSocket 作为订阅者接入，attach 返回精确的取消订阅函数，杜绝监听器泄漏。
// PTY 独立于 WebSocket：attach 不存在的 id 会自动创建；断开不杀进程。

const { spawn } = require('node-pty');
const os = require('os');

const DEFAULT_COLS = 80, DEFAULT_ROWS = 24, MAX_BUFFER = 50000;
const sessions = new Map();

function newId() {
  return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function getShell() {
  if (os.platform() === 'win32') return process.env.ComSpec || 'cmd.exe';
  return process.env.SHELL || '/bin/bash';
}

// 创建一个全新会话，返回 { id, session }
function createSession() {
  const id = newId();
  const pty = spawn(getShell(), [], {
    name: 'xterm-256color', cols: DEFAULT_COLS, rows: DEFAULT_ROWS,
    cwd: process.cwd(),
    env: Object.assign({}, process.env, { TERM: 'xterm-256color' }),
  });
  const s = {
    pty, buffer: '', cols: DEFAULT_COLS, rows: DEFAULT_ROWS, alive: true,
    subscribers: new Set(),
  };
  sessions.set(id, s);

  // 唯一的数据分发点：累加环形 buffer + 广播给所有订阅者
  pty.onData(data => {
    s.buffer += data;
    if (s.buffer.length > MAX_BUFFER) s.buffer = s.buffer.slice(s.buffer.length - MAX_BUFFER);
    for (const fn of s.subscribers) { try { fn({ type: 'data', data }); } catch {} }
  });
  pty.onExit(({ exitCode, signal }) => {
    s.alive = false;
    const msg = signal ? `\r\n[进程被信号 ${signal} 终止]` : `\r\n[进程退出，代码: ${exitCode}]`;
    s.buffer += msg;
    for (const fn of s.subscribers) { try { fn({ type: 'data', data: msg }); } catch {} }
  });

  return { id, session: s };
}

function getOrCreate(id) {
  if (id) {
    const s = sessions.get(id);
    if (s) return { id, session: s };
  }
  return createSession();
}

function killSession(id) {
  const s = sessions.get(id);
  if (!s) return false;
  s.alive = false;
  try { s.pty.kill(); } catch {}
  sessions.delete(id);
  return true;
}

// 将一个 WebSocket 作为订阅者接入会话。requestedId 为空则新建会话。
function attach(ws, requestedId) {
  const { id, session: s } = getOrCreate(requestedId);
  const send = (obj) => { if (ws.readyState === 1) { try { ws.send(JSON.stringify(obj)); } catch {} } };

  send({ type: 'attached', id });
  if (s.buffer) send({ type: 'replay', data: s.buffer });

  // 订阅：pty 数据/退出通过这个函数转发给本 ws
  const subscriber = (obj) => send(obj);
  s.subscribers.add(subscriber);

  let alive = true;
  const detach = () => {
    if (!alive) return;
    alive = false;
    s.subscribers.delete(subscriber);
  };

  ws.on('message', (raw) => {
    if (!alive) return;
    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch { try { s.pty.write(raw.toString()); } catch {} return; }

    if (msg.type === 'resize') {
      s.cols = Math.max(10, Math.min(500, msg.cols || DEFAULT_COLS));
      s.rows = Math.max(3, Math.min(200, msg.rows || DEFAULT_ROWS));
      try { s.pty.resize(s.cols, s.rows); } catch {}
    } else if (msg.type === 'signal') {
      try { s.pty.kill(msg.signal); } catch {}
    } else if (msg.type === 'input') {
      try { s.pty.write(msg.data); } catch {}
    }
  });
  ws.on('close', detach);
  ws.on('error', detach);
}

function handleConnection(ws) {
  let handled = false;
  ws.on('message', (raw) => {
    if (handled) return;
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    // create（新建）与 attach（接入，id 为空则新建）统一走 attach
    if (msg.type === 'create') { handled = true; attach(ws, null); }
    else if (msg.type === 'attach') { handled = true; attach(ws, msg.id || null); }
  });
}

// REST API
function listHandler(req, res) {
  const list = [...sessions.entries()].map(([id, s]) => ({ id, alive: s.alive }));
  res.json(list);
}
function killHandler(req, res) {
  const id = req.query?.id || req.body?.id;
  if (!id) return res.status(400).json({ error: 'id required' });
  res.json({ ok: killSession(id) });
}

module.exports = { handleConnection, listHandler, killHandler };
