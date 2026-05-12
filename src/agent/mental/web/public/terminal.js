// === 终端前端 ===
// 职责：xterm.js 实例管理 + WebSocket 连接 + resize 适配

// 保存 xterm.js 全局类引用（避免被 export 名覆盖）
const XTerm = window.Terminal;
const XFitAddon = window.FitAddon?.FitAddon;

let terminal = null;
let ws = null;
let fitAddon = null;
let container = null;
let connected = false;

// 为 xterm 添加触摸惯性滚动
function addMomentumScroll(container, term) {
  const viewport = container.querySelector('.xterm-viewport');
  if (!viewport) return;

  let velY = 0;
  let lastY = 0;
  let lastTime = 0;
  let raf = null;

  function decay() {
    velY *= 0.92; // 衰减系数：越小刹车越快
    if (Math.abs(velY) < 0.5) { raf = null; return; }
    term.scrollLines(Math.round(velY));
    raf = requestAnimationFrame(decay);
  }

  viewport.addEventListener('touchstart', (e) => {
    cancelAnimationFrame(raf); raf = null;
    velY = 0;
    if (e.touches.length === 1) {
      lastY = e.touches[0].clientY;
      lastTime = Date.now();
    }
  }, { passive: true });

  viewport.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 1) return;
    const y = e.touches[0].clientY;
    const now = Date.now();
    const dy = lastY - y;
    const dt = now - lastTime;
    if (dt > 0) velY = dy / dt * 16; // 归一化到 16ms 帧
    lastY = y;
    lastTime = now;
  }, { passive: true });

  viewport.addEventListener('touchend', () => {
    if (Math.abs(velY) > 1.5) {
      raf = requestAnimationFrame(decay);
    } else {
      velY = 0;
    }
  }, { passive: true });
}

function getWsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = window.TERMINAL_AUTH || '';
  return `${proto}//${location.host}/api/terminal?auth=${encodeURIComponent(token)}`;
}

function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  try {
    ws = new WebSocket(getWsUrl());
  } catch (e) {
    terminal?.writeln(`\r\n[WebSocket 连接失败: ${e.message}]`);
    return;
  }

  ws.onopen = () => {
    connected = true;
    updateStatus('已连接', '#4caf50');
    terminal?.writeln('\r\n\x1b[32m● 已连接\x1b[0m\r\n');
    sendResize();
  };

  ws.onmessage = (ev) => {
    if (terminal) {
      terminal.write(ev.data);
    }
  };

  ws.onclose = () => {
    connected = false;
    updateStatus('已断开', '#e05050');
    terminal?.writeln('\r\n\x1b[31m● 已断开\x1b[0m\r\n');
  };

  ws.onerror = () => {
    // onclose 会随后触发，这里不重复处理
  };
}

function sendResize() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (!terminal) return;
  const dims = fitAddon?.proposeDimensions();
  if (dims) {
    ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
  }
}

function updateStatus(text, color) {
  const el = document.getElementById('terminalStatus');
  if (el) {
    el.textContent = text;
    el.style.color = color || '#888';
  }
}

export const Terminal = {
  init(panel) {
    container = panel;
  },

  open() {
    if (!container) return;

    if (!terminal) {
      // 延迟创建 xterm 实例
      terminal = new XTerm({
        cursorBlink: true,
        cursorStyle: 'bar',
        fontSize: 13,
        fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
        scrollback: 10000,
        scrollSensitivity: 3,
        fastScrollSensitivity: 8,
        theme: {
          background: '#0e0e10',
          foreground: '#c8c8d0',
          cursor: '#7c6fe0',
          selectionBackground: '#2a2a44',
          black: '#1a1a24',
          red: '#e05050',
          green: '#4caf50',
          yellow: '#e0af68',
          blue: '#7c9fd4',
          magenta: '#c8a0f0',
          cyan: '#4ec9b0',
          white: '#c8c8d0',
          brightBlack: '#555',
          brightRed: '#ff7070',
          brightGreen: '#6ae06a',
          brightYellow: '#ffcf8a',
          brightBlue: '#a0c0f0',
          brightMagenta: '#dbb8ff',
          brightCyan: '#6ee0c0',
          brightWhite: '#e0e0e8',
        },
        allowProposedApi: true,
      });

      fitAddon = new XFitAddon();
      terminal.loadAddon(fitAddon);

      terminal.open(container);
      fitAddon.fit();

      // —— 移动端触摸惯性滚动 ——
      // xterm.js 自己处理 touch→scroll，但缺惯性。在 touchend 后补动量。
      addMomentumScroll(container, terminal);

      // resize 事件 → 通知后端
      terminal.onResize(() => {
        sendResize();
      });

      // 用户输入 → WebSocket
      terminal.onData((data) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });
    }

    // fit 以适配当前容器
    setTimeout(() => {
      if (fitAddon) {
        try { fitAddon.fit(); } catch {}
        sendResize();
      }
    }, 50);

    // 自动连接
    if (!connected) {
      connect();
    }
  },

  close() {
    // 不销毁，保持连接
  },

  refit() {
    if (fitAddon && terminal) {
      try { fitAddon.fit(); } catch {}
      sendResize();
    }
  },

  // 停止当前命令（发送 Ctrl+C）
  stop() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'signal', signal: 'SIGINT' }));
      // 同时也直接写 \x03（双保险）
      ws.send('\x03');
    }
  },

  // 复制：有选区复制选区，无选区 selectAll 复制全量 scrollback
  copy() {
    if (!terminal) return;
    try {
      let text = terminal.getSelection();
      if (!text) {
        terminal.selectAll();
        text = terminal.getSelection();
        terminal.clearSelection();
      }
      if (text) {
        navigator.clipboard.writeText(text);
        updateStatus('已复制 ' + text.length + ' 字符', '#e0af68');
        setTimeout(() => updateStatus(connected ? '已连接' : '已断开', connected ? '#4caf50' : '#e05050'), 1500);
      }
    } catch {}
  },

  // 重开终端（断开并重新连接，新 pty）
  restart() {
    if (ws) {
      try { ws.close(); } catch {}
      ws = null;
    }
    connected = false;
    updateStatus('重连中...', '#e0af68');
    // 清屏并重连
    if (terminal) {
      terminal.clear();
      terminal.writeln('\x1b[33m● 正在重连...\x1b[0m');
    }
    connect();
  },

  destroy() {
    if (ws) {
      try { ws.close(); } catch {}
      ws = null;
    }
    if (terminal) {
      try { terminal.dispose(); } catch {}
      terminal = null;
      fitAddon = null;
    }
    connected = false;
    updateStatus('未连接', '#888');
  }
};
