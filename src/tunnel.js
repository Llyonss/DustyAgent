/**
 * SSH 反向隧道：将本地 localhost:3003 暴露到远程服务器 0.0.0.0:9090
 * 用法：node src/tunnel.js
 * 效果：访问 http://<SSH_HOST>:9090 → 转发到本机 localhost:3003
 */
const { Client } = require('ssh2');
const net = require('net');
const path = require('path');

// 加载 .env
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const REMOTE_HOST = process.env.SSH_HOST;
const REMOTE_PORT = parseInt(process.env.SSH_TUNNEL_PORT || '9090', 10);
const LOCAL_HOST = process.env.TUNNEL_LOCAL_HOST || '127.0.0.1';
const LOCAL_PORT = parseInt(process.env.TUNNEL_LOCAL_PORT || '3003', 10);

if (!REMOTE_HOST) {
  console.error('[tunnel] Missing SSH_HOST in .env');
  process.exit(1);
}

const SSH_CONFIG = {
  host: REMOTE_HOST,
  port: 22,
  username: process.env.SSH_USER,
  password: process.env.SSH_PASS,
  keepaliveInterval: 10000,
  keepaliveCountMax: 3,
  readyTimeout: 10000
};

let reconnectTimer = null;

function connect() {
  const conn = new Client();

  conn.on('ready', () => {
    console.log(`[tunnel] SSH connected.`);
    
    conn.forwardIn('0.0.0.0', REMOTE_PORT, (err) => {
      if (err) {
        console.error('[tunnel] Forward request failed:', err.message);
        conn.end();
        return;
      }
      console.log(`[tunnel] ✓ Tunnel active: http://${REMOTE_HOST}:${REMOTE_PORT} → localhost:${LOCAL_PORT}`);
    });
  });

  conn.on('tcp connection', (info, accept, reject) => {
    console.log(`[tunnel] Incoming from ${info.srcIP}:${info.srcPort}`);
    
    const remote = accept();
    const local = net.createConnection({ host: LOCAL_HOST, port: LOCAL_PORT });
    let localReady = false;
    const buffer = [];

    remote.on('data', (chunk) => {
      console.log(`[tunnel] remote→local ${chunk.length}B`);
      if (localReady) {
        local.write(chunk);
      } else {
        buffer.push(chunk);
      }
    });

    local.on('connect', () => {
      console.log(`[tunnel] Local connected`);
      localReady = true;
      for (const b of buffer) local.write(b);
      buffer.length = 0;
    });

    local.on('data', (chunk) => {
      console.log(`[tunnel] local→remote ${chunk.length}B`);
      remote.write(chunk);
    });

    local.on('error', (err) => {
      console.error('[tunnel] Local error:', err.message);
      remote.close();
    });
    remote.on('error', () => local.destroy());
    remote.on('close', () => local.destroy());
    local.on('close', () => { try { remote.close(); } catch {} });
    remote.on('end', () => local.end());
    local.on('end', () => { try { remote.end(); } catch {} });
  });

  conn.on('error', (err) => {
    console.error('[tunnel] SSH error:', err.message);
    scheduleReconnect();
  });

  conn.on('close', () => {
    console.log('[tunnel] Connection closed. Reconnecting in 3s...');
    scheduleReconnect();
  });

  conn.connect(SSH_CONFIG);
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 3000);
}

console.log('[tunnel] Starting SSH reverse tunnel...');
connect();
