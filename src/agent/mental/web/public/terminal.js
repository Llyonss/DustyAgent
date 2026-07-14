// === 终端前端 ===
// 后端管理 PTY 进程和 ID。前端通过 REST 获取列表，WS 通信。

const XTerm = window.Terminal;
const XFitAddon = window.FitAddon?.FitAddon;

let containerDesktop = null;
let containerMobile = null;
let terminal = null;
let fitAddon = null;
let activeId = null;
let currentWs = null;

function getWsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/api/terminal?auth=${encodeURIComponent(window.TERMINAL_AUTH || '')}`;
}
function getContainer() {
  return window.matchMedia('(max-width:768px)').matches ? containerMobile : containerDesktop;
}
function statusEl() { return document.getElementById('terminalStatus'); }
function setStatus(text, color) {
  const el = statusEl(); if (el) { el.textContent = text; el.style.color = color || '#888'; }
}

function showPanel() {
  if (window.matchMedia('(max-width:768px)').matches) {
    const p = document.getElementById('terminalPanel'); if (p) p.classList.add('terminal-open');
    const cp = document.getElementById('chatPanel'); if (cp) cp.classList.add('mobile-term');
  } else {
    ['graphView','contentView','storyView','fileView'].forEach(id => {
      const el = document.getElementById(id); if (el) el.classList.add('hidden');
    });
    const tp = document.getElementById('termPane'); if (tp) tp.classList.remove('hidden');
  }
}

function addMomentumScroll(c, term) {
  const vp = c.querySelector('.xterm-viewport'); if (!vp) return;
  let velY = 0, lastY = 0, lastTime = 0, raf = null;
  function decay() { velY *= 0.92; if (Math.abs(velY) < 0.5) { raf = null; return; } term.scrollLines(Math.round(velY)); raf = requestAnimationFrame(decay); }
  vp.addEventListener('touchstart', e => { cancelAnimationFrame(raf); raf = null; velY = 0; if (e.touches.length === 1) { lastY = e.touches[0].clientY; lastTime = Date.now(); } }, { passive: true });
  vp.addEventListener('touchmove', e => { if (e.touches.length !== 1) return; const y = e.touches[0].clientY, now = Date.now(), dy = lastY - y, dt = now - lastTime; if (dt > 0) velY = dy / dt * 16; lastY = y; lastTime = now; }, { passive: true });
  vp.addEventListener('touchend', () => { if (Math.abs(velY) > 1.5) raf = requestAnimationFrame(decay); else velY = 0; }, { passive: true });
}

function ensureXterm() {
  const c = getContainer(); if (terminal || !c) return;
  terminal = new XTerm({
    cursorBlink: true, cursorStyle: 'bar', fontSize: 13,
    fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace", scrollback: 10000,
    theme: { background:'#0e0e10', foreground:'#c8c8d0', cursor:'#7c6fe0', selectionBackground:'#2a2a44',
      black:'#1a1a24', red:'#e05050', green:'#4caf50', yellow:'#e0af68', blue:'#7c9fd4', magenta:'#c8a0f0', cyan:'#4ec9b0', white:'#c8c8d0',
      brightBlack:'#555', brightRed:'#ff7070', brightGreen:'#6ae06a', brightYellow:'#ffcf8a', brightBlue:'#a0c0f0', brightMagenta:'#dbb8ff', brightCyan:'#6ee0c0', brightWhite:'#e0e0e8' },
    allowProposedApi: true,
  });
  fitAddon = new XFitAddon(); terminal.loadAddon(fitAddon); terminal.open(c);
  try { fitAddon.fit(); } catch {} 
  addMomentumScroll(c, terminal);
  terminal.onResize(() => {
    if (currentWs && currentWs.readyState === WebSocket.OPEN && fitAddon) {
      const d = fitAddon.proposeDimensions(); if (d) currentWs.send(JSON.stringify({ type:'resize', cols:d.cols, rows:d.rows }));
    }
  });
  terminal.onData(data => {
    if (currentWs && currentWs.readyState === WebSocket.OPEN) currentWs.send(JSON.stringify({ type:'input', data }));
  });
}

function connect(id) {
  if (currentWs) { try { currentWs.close(); } catch {} currentWs = null; }
  const ws = new WebSocket(getWsUrl());
  currentWs = ws;
  ws.onopen = () => ws.send(JSON.stringify({ type:'attach', id }));
  ws.onmessage = ev => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'replay' || msg.type === 'data') terminal?.write(msg.data);
    } catch { terminal?.write(ev.data); }
  };
  ws.onclose = () => { currentWs = null; setStatus('已断开','#e05050'); };
}

export const Terminal = {
  init(mobileEl, desktopEl) { containerMobile = mobileEl; containerDesktop = desktopEl; },

  async list() {
    try { const r = await fetch('/api/terminal/sessions'); return r.json(); } catch { return []; }
  },

  async create() {
    showPanel();
    const ws = new WebSocket(getWsUrl());
    return new Promise((resolve) => {
      ws.onopen = () => ws.send(JSON.stringify({ type:'create' }));
      ws.onmessage = ev => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'attached') {
            currentWs?.close(); currentWs = ws; activeId = msg.id;
            ensureXterm(); terminal?.clear(); setStatus('已连接','#4caf50');
            setTimeout(() => { try { fitAddon?.fit(); } catch {} }, 200);
            resolve(msg.id);
          }
        } catch {}
      };
    });
  },

  async kill(id) {
    await fetch('/api/terminal/kill?id=' + encodeURIComponent(id), { method:'POST' });
    if (activeId === id) { activeId = null; currentWs?.close(); currentWs = null; terminal?.clear(); }
  },

  async switchTo(id) {
    if (activeId === id) return;
    activeId = id;
    showPanel();
    ensureXterm();
    terminal?.clear();
    setStatus('连接中...','#e0af68');
    terminal?.writeln('\x1b[33m● 连接中...\x1b[0m');
    connect(id);
    setStatus('已连接','#4caf50');
    setTimeout(() => { try { fitAddon?.fit(); } catch {} }, 200);
  },

  open() {
    // 供外部调用（移动端终端按钮等）
    showPanel();
    ensureXterm();
  },

  refit() { if (fitAddon && terminal) try { fitAddon.fit(); } catch {} },
  stop() { if (currentWs?.readyState === WebSocket.OPEN) currentWs.send(JSON.stringify({ type:'signal', signal:'SIGINT' })); },
  copy() {
    if (!terminal) return;
    let t = terminal.getSelection(); if (!t) { terminal.selectAll(); t = terminal.getSelection(); terminal.clearSelection(); }
    if (t) navigator.clipboard.writeText(t);
  },
  restart() {
    if (!activeId) return;
    currentWs?.close(); currentWs = null;
    terminal?.clear(); terminal?.writeln('\x1b[33m● 重连中...\x1b[0m');
    connect(activeId);
  },
};
