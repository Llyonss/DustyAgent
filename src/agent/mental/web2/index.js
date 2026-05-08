require('dotenv').config({ path: require('path').join(__dirname, '../../../../.env') });

const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { readEvents, writeEvent } = require('../../../core/event');
const { loop } = require('../../../core/loop');
const createMentalAgent = require('../brain');

const mentalRoot = path.join(__dirname, '../../../../mental');
const roomsDir = path.join(mentalRoot, 'space');
const instancesDir = path.join(mentalRoot, 'instances');

// --- Express ---
const app = express();
const server = http.createServer(app);

// Basic Auth
const AUTH_USER = process.env.AUTH_USER || 'dusty';
const AUTH_PASS = process.env.AUTH_PASS || 'dusty4ever';
app.use((req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="DustyMate"');
    return res.status(401).send('Authentication required');
  }
  const [user, pass] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
  if (user === AUTH_USER && pass === AUTH_PASS) return next();
  res.setHeader('WWW-Authenticate', 'Basic realm="DustyMate"');
  return res.status(401).send('Invalid credentials');
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- WebSocket ---
const wss = new WebSocketServer({ server });
const clients = new Set();
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

// --- Write lock ---
let writeQueue = Promise.resolve();
function withWriteLock(fn) {
  const p = writeQueue.then(fn).catch(fn);
  writeQueue = p;
  return p;
}

// --- Helpers ---
function tryRead(p) {
  try { return fs.readFileSync(p, 'utf-8'); } catch { return null; }
}

function ensureDir(d) {
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
}

// --- Loops ---
const loops = new Map(); // instanceName -> { abort, running }

function ensureInstanceDir(name) {
  const d = path.join(instancesDir, name);
  ensureDir(path.join(d, 'events'));
  ensureDir(path.join(d, 'history'));
  const sysPath = path.join(d, 'system.md');
  if (!fs.existsSync(sysPath)) {
    const def = tryRead(path.join(__dirname, '../brain/system-default.md')) || '';
    fs.writeFileSync(sysPath, def, 'utf-8');
  }
  return d;
}

async function startLoop(instanceName) {
  if (loops.has(instanceName)) return;
  const instanceDir = ensureInstanceDir(instanceName);
  const agent = createMentalAgent(instanceDir, {
    onWrite: (name) => broadcast({ event: 'mental-updated', name })
  });
  const ctrl = new AbortController();
  const hooks = {
    system: () => agent.system(),
    tools: () => agent.tools(),
    events: agent.events,
    output: (turn) => {
      agent.output(turn);
      // Broadcast turn to frontend
      broadcast({ event: 'conversation-turn', instance: instanceName });
    }
  };
  const gen = loop({ instanceDir, signal: ctrl.signal, hooks });
  loops.set(instanceName, { abort: ctrl, running: true });

  (async () => {
    try {
      for await (const turn of gen) { /* yield consumed by output hook */ }
    } catch (e) {
      console.error(`Loop ${instanceName} error:`, e.message);
    } finally {
      const entry = loops.get(instanceName);
      if (entry) entry.running = false;
    }
  })();
}

function stopLoop(instanceName) {
  const entry = loops.get(instanceName);
  if (entry) {
    entry.abort.abort();
    loops.delete(instanceName);
  }
}

// --- API: Mentals ---
app.get('/api/mentals', (req, res) => {
  try {
    const files = fs.readdirSync(roomsDir).filter(f => f.endsWith('.md'));
    const mentals = files.map(f => {
      const name = f.slice(0, -3);
      const summary = tryRead(path.join(roomsDir, name + '.summary')) || '';
      return { name, summary: summary.trim() };
    });
    res.json(mentals);
  } catch (e) {
    res.json([]);
  }
});

app.get('/api/mentals/:name', (req, res) => {
  const name = req.params.name;
  const content = tryRead(path.join(roomsDir, name + '.md'));
  if (content === null) return res.status(404).json({ error: 'not found' });
  const summary = tryRead(path.join(roomsDir, name + '.summary')) || '';
  res.json({ name, content, summary: summary.trim() });
});

app.post('/api/mentals', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const mdPath = path.join(roomsDir, name + '.md');
  if (fs.existsSync(mdPath)) return res.status(409).json({ error: 'already exists' });
  fs.writeFileSync(mdPath, '', 'utf-8');
  broadcast({ event: 'mental-created', name });
  res.json({ ok: true, name });
});

app.delete('/api/mentals/:name', (req, res) => {
  const name = req.params.name;
  const mdPath = path.join(roomsDir, name + '.md');
  if (!fs.existsSync(mdPath)) return res.status(404).json({ error: 'not found' });
  try { fs.unlinkSync(mdPath); } catch {}
  try { fs.unlinkSync(path.join(roomsDir, name + '.links')); } catch {}
  try { fs.unlinkSync(path.join(roomsDir, name + '.summary')); } catch {}
  broadcast({ event: 'mental-deleted', name });
  res.json({ ok: true });
});

// Mental edit (by user from frontend)
app.put('/api/mentals/:name', (req, res) => {
  const name = req.params.name;
  const { content } = req.body;
  if (content === undefined) return res.status(400).json({ error: 'content required' });
  withWriteLock(() => {
    fs.writeFileSync(path.join(roomsDir, name + '.md'), content, 'utf-8');
    broadcast({ event: 'mental-updated', name });
    res.json({ ok: true });
  });
});

// --- API: Links (for layout clustering) ---
app.get('/api/links', (req, res) => {
  try {
    const links = {};
    const files = fs.readdirSync(roomsDir).filter(f => f.endsWith('.links'));
    for (const f of files) {
      const name = f.slice(0, -6);
      const content = tryRead(path.join(roomsDir, f));
      if (!content) continue;
      const parsed = content.split('\n').filter(l => l.trim()).map(l => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
      links[name] = parsed.map(p => p.name);
    }
    res.json(links);
  } catch { res.json({}); }
});

// --- API: Canvas state ---
app.get('/api/canvas', (req, res) => {
  const data = tryRead(path.join(mentalRoot, 'canvas.json'));
  res.json(data ? JSON.parse(data) : { viewport: { x: 0, y: 0, zoom: 1 }, cards: {} });
});

app.put('/api/canvas', (req, res) => {
  fs.writeFileSync(path.join(mentalRoot, 'canvas.json'), JSON.stringify(req.body, null, 2));
  res.json({ ok: true });
});

// --- API: Conversations ---
app.post('/api/conversations', (req, res) => {
  const { mental: anchorMental, select } = req.body || {};
  const instanceName = `${(anchorMental || 'global').replace(/[<>:"/\\|?*]/g,'')}-${Date.now()}`;
  ensureInstanceDir(instanceName);
  res.json({ instance: instanceName, anchor: { mental: anchorMental, select } });
});

app.get('/api/conversations', (req, res) => {
  const convs = [];
  try {
    for (const d of fs.readdirSync(instancesDir, { withFileTypes: true })) {
      if (d.isDirectory()) {
        const entry = loops.get(d.name);
        convs.push({ instance: d.name, running: entry ? entry.running : false });
      }
    }
  } catch {}
  res.json(convs);
});

app.get('/api/conversations/:id/events', (req, res) => {
  const id = req.params.id;
  const eventsDir = path.join(instancesDir, id, 'events');
  const events = readEvents(eventsDir);
  const entry = loops.get(id);
  res.json({ events, running: entry ? entry.running : false });
});

app.post('/api/conversations/:id/events', async (req, res) => {
  const id = req.params.id;
  const { content, anchor } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });
  const eventsDir = path.join(instancesDir, id, 'events');
  writeEvent(eventsDir, 'user', { content, anchor: anchor || {} });
  res.json({ ok: true });
  // Start loop if not running
  if (!loops.has(id) || !loops.get(id).running) {
    await startLoop(id);
  }
});

app.delete('/api/conversations/:id/loop', (req, res) => {
  stopLoop(req.params.id);
  res.json({ ok: true });
});

// --- Start ---
const PORT = process.env.MENTAL_V2_PORT || 3004;
server.listen(PORT, () => {
  console.log(`Mental v2 running on http://localhost:${PORT}`);
});
