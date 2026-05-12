// === 终端 WebSocket 处理器 ===
// 职责：WebSocket 连接 → spawn pty → 双向数据 pipe → 断开清理
// 每个连接一个独立 pty 进程，断开即杀

const { spawn } = require('node-pty');
const os = require('os');

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

function getShell() {
  if (os.platform() === 'win32') {
    return process.env.ComSpec || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

function handleConnection(ws) {
  let pty = null;
  let alive = true;

  function cleanup() {
    if (!alive) return;
    alive = false;
    if (pty) {
      try { pty.kill(); } catch {}
      pty = null;
    }
    try { ws.close(); } catch {}
  }

  try {
    const shell = getShell();
    pty = spawn(shell, [], {
      name: 'xterm-256color',
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      cwd: process.cwd(),
      env: Object.assign({}, process.env, { TERM: 'xterm-256color' }),
    });

    // pty 输出 → WebSocket
    pty.onData((data) => {
      if (alive && ws.readyState === 1) {
        ws.send(data);
      }
    });

    // pty 进程退出
    pty.onExit(({ exitCode, signal }) => {
      if (alive && ws.readyState === 1) {
        const msg = signal
          ? `\r\n[进程被信号 ${signal} 终止]`
          : `\r\n[进程退出，代码: ${exitCode}]`;
        ws.send(msg);
      }
      cleanup();
    });

    // WebSocket 消息 → pty
    ws.on('message', (raw) => {
      if (!alive || !pty) return;

      // 尝试解析为 JSON（resize 等控制消息）
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'resize') {
          const cols = Math.max(10, Math.min(500, msg.cols || DEFAULT_COLS));
          const rows = Math.max(3, Math.min(200, msg.rows || DEFAULT_ROWS));
          pty.resize(cols, rows);
          return;
        }
        if (msg.type === 'signal') {
          // 发送信号到 pty 进程（如 SIGINT = Ctrl+C）
          if (msg.signal && pty) {
            try { pty.kill(msg.signal); } catch {}
          }
          return;
        }
      } catch {
        // 不是 JSON，当作普通数据写入 pty
      }

      try {
        pty.write(raw.toString());
      } catch {}
    });

    ws.on('close', () => cleanup());
    ws.on('error', () => cleanup());

  } catch (e) {
    if (ws.readyState === 1) {
      ws.send(`\r\n[终端启动失败: ${e.message}]`);
    }
    cleanup();
  }
}

module.exports = { handleConnection };
