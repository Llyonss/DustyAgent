require('dotenv').config({ path: require('path').join(__dirname, '../../../../.env') });

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const { readEvents, writeEvent } = require('../../../core/event');
const { loop } = require('../../../core/loop');
const createMentalAgent = require('../brain');
const { handleConnection } = require('./terminal');


const mentalRoot = path.join(__dirname, '../../../../mental');
const roomsDir = path.join(mentalRoot, 'space');
const instancesDir = path.join(mentalRoot, 'instances');
const loops = new Map();

function ensureDirs() {
  fs.mkdirSync(roomsDir, { recursive: true });
  fs.mkdirSync(instancesDir, { recursive: true });
}
ensureDirs();

// 支持路径格式: "根实例" 或 "根实例/分支1/分支2..."
function resolve(name) {
  const parts = (name || '').split('/').filter(Boolean);
  if (!parts.length) parts.push('default');
  const sanitize = (s) => {
    const safe = (s || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
    return safe && safe !== '.' && safe !== '..' ? safe : 'default';
  };
  let key = sanitize(parts[0]);
  let instanceDir = path.join(instancesDir, key);
  for (let i = 1; i < parts.length; i++) {
    key += '/' + parts[i];
    instanceDir = path.join(instanceDir, 'events', sanitize(parts[i]));
  }
  return { key, instanceDir, eventsDir: path.join(instanceDir, 'events') };
}

const DEFAULT_SYSTEM_PATH = path.join(__dirname, '../brain/system-default.md');

function ensureInstance(instanceDir) {
  fs.mkdirSync(path.join(instanceDir, 'events'), { recursive: true });
  fs.mkdirSync(path.join(instanceDir, 'history'), { recursive: true });
  // Write default system.md if not exists
  const systemMdPath = path.join(instanceDir, 'system.md');
  if (!fs.existsSync(systemMdPath)) {
    const defaultContent = tryRead(DEFAULT_SYSTEM_PATH) || '';
    fs.writeFileSync(systemMdPath, defaultContent, 'utf-8');
  }
}

function tryRead(p) {
  try { return fs.readFileSync(p, 'utf-8'); } catch { return null; }
}

// Parse JSONL links content
function parseLinks(content) {
  if (!content) return [];
  return content.split('\n').filter(l => l.trim()).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

const app = express();

// Basic Auth - 所有访问都需要密码
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


// --- Instance list ---
app.get('/api/instances', (req, res) => {
  try {
    const dirs = fs.readdirSync(instancesDir, { withFileTypes: true })
      .filter(d => d.isDirectory()).map(d => d.name).sort();
    res.json(dirs);
  } catch { res.json([]); }
});

app.post('/api/instances', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const { instanceDir } = resolve(name);
  ensureInstance(instanceDir);
  res.json({ ok: true });
});

app.delete('/api/instances', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const { key, instanceDir } = resolve(name);
  // Stop running loop if any
  const entry = loops.get(key);
  if (entry) { entry.controller.abort(); await entry.done; }
  // Remove directory
  try { fs.rmSync(instanceDir, { recursive: true, force: true }); } catch {}
  res.json({ ok: true });
});

// --- Events ---
app.get('/api/events', (req, res) => {
  const { key, eventsDir, instanceDir } = resolve(req.query.instance);
  try {
    let usages = [];
    try { usages = JSON.parse(fs.readFileSync(path.join(instanceDir, 'usage.json'), 'utf-8')); } catch {}
    res.json({ events: readEvents(instanceDir), running: loops.has(key), usages });
  } catch { res.json({ events: [], running: false, usages: [] }); }
});

app.delete('/api/events', (req, res) => {
  const { instance, file, mode, files } = req.body;
  const { key, eventsDir, instanceDir } = resolve(instance);
  // 运行中禁止删除
  if (loops.has(key)) return res.status(409).json({ error: 'loop running, stop first' });
  try {
    if (Array.isArray(files) && files.length > 0) {
      let deleted = 0;
      for (const f of files) {
        const fp = path.join(eventsDir, f);
        if (fs.existsSync(fp)) { fs.unlinkSync(fp); deleted++; }
      }
      return res.json({ ok: true, deleted });
    }
    if (!file || !mode) return res.status(400).json({ error: 'file and mode required, or files array' });
    const events = readEvents(instanceDir);
    const idx = events.findIndex(e => e._file === file);
    if (idx === -1) return res.status(404).json({ error: 'event not found' });
    const toDelete = mode === 'after' ? events.slice(idx) : [events[idx]];
    for (const e of toDelete) {
      fs.unlinkSync(path.join(eventsDir, e._file));
    }
    res.json({ ok: true, deleted: toDelete.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

function createHooks(key, instanceDir) {
  const hooks = createMentalAgent(instanceDir);
  hooks.stop = hooks.createStop(() => startLoop(key, instanceDir, hooks));
  return hooks;
}

function startLoop(key, instanceDir, hooks) {
  if (loops.has(key)) return;
  const controller = new AbortController();
  const done = (async () => {
    try {
      for await (const turn of loop({ instanceDir, signal: controller.signal, hooks })) {}
    } catch (e) {
      if (e.name !== 'AbortError') console.error('Loop error:', e.message);
    } finally {
      loops.delete(key);
      if (!controller.signal.aborted && hooks.stop) await hooks.stop();
    }
  })();
  loops.set(key, { controller, done });
}

app.post('/api/events', async (req, res) => {
  const { content, retry } = req.body;
  const { key, instanceDir, eventsDir } = resolve(req.query.instance);
  ensureInstance(instanceDir);

  if (retry) {
    const events = readEvents(instanceDir);
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type !== 'error') break;
      fs.unlinkSync(path.join(eventsDir, events[i]._file));
    }
  }

  if (content) writeEvent(eventsDir, { type: 'user', content });
  res.json({ ok: true });

  if (loops.has(key)) return;
  startLoop(key, instanceDir, createHooks(key, instanceDir));
});

app.delete('/api/loop', async (req, res) => {
  const { key } = resolve(req.query.instance);
  const entry = loops.get(key);
  if (entry) { entry.controller.abort(); await entry.done; }
  res.json({ ok: true });
});

// --- Restart ---
app.post('/api/restart', (req, res) => {
  res.json({ ok: true });
  if (!server) { process.exit(1); return; }
  server.close(() => {
    const { spawn } = require('child_process');
    const child = spawn('node', ['src/agent/mental/web/index.js'], {
      detached: true, stdio: 'ignore',
      cwd: path.join(__dirname, '../../../..')
    });
    child.unref();
    process.exit(0);
  });
});

// --- Graph: nodes + edges for force-directed graph ---
app.get('/api/graph', (req, res) => {
  try {
    const files = fs.readdirSync(roomsDir).filter(f => f.endsWith('.md'));
    const nodes = files.map(f => ({ name: f.replace(/\.md$/, '') }));
    const edges = [];
    for (const node of nodes) {
      const linksContent = tryRead(path.join(roomsDir, node.name + '.links'));
      const links = parseLinks(linksContent);
      for (const link of links) {
        if (link.parent) {
          // Node declares its parent: edge from parent to child
          edges.push({ source: link.name, target: node.name, label: link.summary || '', parent: true });
        } else {
          edges.push({ source: node.name, target: link.name, label: link.summary || '', parent: false });
        }
      }
    }
    res.json({ nodes, edges });
  } catch { res.json({ nodes: [], edges: [] }); }
});

// --- Room content ---
app.get('/api/room', (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const md = fs.readFileSync(path.join(roomsDir, name + '.md'), 'utf-8');
    const links = tryRead(path.join(roomsDir, name + '.links'));
    res.json({ name, content: md, links });
  } catch (e) { res.status(404).json({ error: e.message }); }
});

// --- Model presets ---
const presetsPath = path.join(__dirname, '../../../../model-presets.json');
function readPresets() {
  try { return JSON.parse(fs.readFileSync(presetsPath, 'utf-8')); } catch { return {}; }
}
function detectPreset(config, presets) {
  if (!config || !Object.keys(config).filter(k => k !== '_preset').length) return null;
  const cfg = { provider: config.provider, apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.model };
  for (const [name, preset] of Object.entries(presets)) {
    if (preset.provider === cfg.provider && preset.apiKey === cfg.apiKey && preset.baseUrl === cfg.baseUrl && preset.model === cfg.model) {
      return name;
    }
  }
  return null;
}

app.get('/api/model-presets', (req, res) => {
  const presets = readPresets();
  const { instanceDir } = resolve(req.query.instance);
  let current = null, hasConfig = false;
  try {
    const config = JSON.parse(fs.readFileSync(path.join(instanceDir, 'model.json'), 'utf-8'));
    current = config._preset || detectPreset(config, presets);
    hasConfig = Object.keys(config).filter(k => k !== '_preset').length > 0;
  } catch {}
  res.json({ presets: Object.fromEntries(Object.entries(presets).map(([k, v]) => [k, { provider: v.provider, baseUrl: v.baseUrl, model: v.model }])), current, hasConfig });
});

// --- Model config ---
app.get('/api/model', (req, res) => {
  const { instanceDir } = resolve(req.query.instance);
  try {
    const content = fs.readFileSync(path.join(instanceDir, 'model.json'), 'utf-8');
    res.json(JSON.parse(content));
  } catch { res.json({}); }
});

app.post('/api/model', (req, res) => {
  const { instance, config, preset } = req.body;
  if (!instance) return res.status(400).json({ error: 'instance required' });
  const { instanceDir } = resolve(instance);
  ensureInstance(instanceDir);
  try {
    let data = config;
    if (preset) {
      const presets = readPresets();
      data = presets[preset];
      if (!data) return res.status(400).json({ error: 'unknown preset: ' + preset });
      data = { ...data, _preset: preset };
    }
    fs.writeFileSync(path.join(instanceDir, 'model.json'), JSON.stringify(data || {}, null, 2), 'utf-8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Instance data ---
app.get('/api/instance', (req, res) => {
  const { instanceDir } = resolve(req.query.name);
  try {
    const systemMd = tryRead(path.join(instanceDir, 'system.md')) ?? '';
    // ENV info (same as system.js appends)
    const os = require('os');
    const env = `Environment: ${os.platform()}/${os.arch()}, shell: ${os.platform() === 'win32' ? 'cmd.exe' : process.env.SHELL || '/bin/sh'}, cwd: ${process.cwd()}\nInstance: ${path.basename(instanceDir)}, instanceDir: ${instanceDir}`;
    res.json({ systemMd, env });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Tools ---
app.get('/api/tools', (req, res) => {
  const { instanceDir } = resolve(req.query.instance);
  const toolsDir = path.join(instanceDir, 'tools');
  const configPath = path.join(instanceDir, 'tools.json');

  let config = { disabled: [], overrides: {} };
  try { config = { disabled: [], overrides: {}, ...JSON.parse(fs.readFileSync(configPath, 'utf-8')) }; } catch {}

  const { getBuiltins } = require('../brain');
  const builtins = getBuiltins(instanceDir).map(t => ({
    name: t.name, description: t.description, input_schema: t.input_schema,
  }));

  const custom = [];
  try {
    for (const f of fs.readdirSync(toolsDir).filter(f => f.endsWith('.js'))) {
      const code = tryRead(path.join(toolsDir, f)) || '';
      let name = f.replace(/\.js$/, ''), description = '', input_schema = {};
      try {
        const fp = path.join(toolsDir, f);
        delete require.cache[require.resolve(fp)];
        const mod = require(fp);
        if (mod.name) name = mod.name;
        if (mod.description) description = mod.description;
        if (mod.input_schema) input_schema = mod.input_schema;
      } catch {}
      custom.push({ name, file: f, description, input_schema, code });
    }
  } catch {}

  res.json({ config, builtins, custom });
});

// --- Self save ---
app.post('/api/self-save', (req, res) => {
  const { instance, suffix, content } = req.body;
  if (!instance || !suffix || typeof content !== 'string') return res.status(400).json({ error: 'instance, suffix, content required' });
  const { instanceDir } = resolve(instance);
  try {
    ensureInstance(instanceDir);
    const filePath = path.join(instanceDir, suffix);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content.replace(/\r\n/g, '\n'), 'utf-8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Room save ---
app.post('/api/room-save', (req, res) => {
  const { name, suffix, content } = req.body;
  if (!name || !suffix || typeof content !== 'string') return res.status(400).json({ error: 'name, suffix, content required' });
  try {
    fs.mkdirSync(roomsDir, { recursive: true });
    fs.writeFileSync(path.join(roomsDir, name + suffix), content.replace(/\r\n/g, '\n'), 'utf-8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- History ---
function parseHistoryDir(histDir) {
  try {
    const files = fs.readdirSync(histDir).filter(f => f.endsWith('.md')).sort();
    return files.map(f => {
      const raw = fs.readFileSync(path.join(histDir, f), 'utf-8');
      const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
      const meta = {};
      if (m) {
        for (const line of m[1].split('\n')) {
          const kv = line.match(/^(\w+):\s*(.+)$/);
          if (kv) {
            let val = kv[2].trim();
            if (val.startsWith('[') && val.endsWith(']'))
              val = val.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
            meta[kv[1]] = val;
          }
        }
      }
      return { file: f, title: meta.title || f, entities: meta.entities || [], story: m ? m[2] : raw };
    });
  } catch { return []; }
}

app.get('/api/history', (req, res) => {
  const { instanceDir } = resolve(req.query.instance);
  res.json(parseHistoryDir(path.join(instanceDir, 'history')));
});

// --- Story events: get events for a specific commit interval ---
app.get('/api/story-events', (req, res) => {
  const { instanceDir } = resolve(req.query.instance);
  const index = parseInt(req.query.index); // 1-based
  if (!index || index < 1) return res.status(400).json({ error: 'index required (1-based)' });
  try {
    const events = readEvents(instanceDir);
    // Find all successful commits
    const commitIndices = [];
    for (let i = 0; i < events.length; i++) {
      if (events[i].type === 'action' && events[i].tool === 'commit' && !events[i].error) {
        commitIndices.push(i);
      }
    }
    if (index > commitIndices.length) return res.json([]);
    const start = index === 1 ? 0 : commitIndices[index - 2] + 1;
    const end = commitIndices[index - 1]; // exclusive of commit itself
    res.json(events.slice(start, end));
  } catch { res.json([]); }
});

// --- Delete commit: remove a commit event + its history file ---
app.delete('/api/commit', (req, res) => {
  const { instance, index } = req.body;
  if (!instance || !index || index < 1) return res.status(400).json({ error: 'instance and index required (1-based)' });
  const { key, eventsDir, instanceDir } = resolve(instance);
  if (loops.has(key)) return res.status(409).json({ error: 'loop running, stop first' });
  try {
    const events = readEvents(instanceDir);
    // Find all successful commits
    const commitEvents = [];
    for (const e of events) {
      if (e.type === 'action' && e.tool === 'commit' && !e.error) commitEvents.push(e);
    }
    if (index > commitEvents.length) return res.status(404).json({ error: 'commit not found' });

    const commit = commitEvents[index - 1];
    // Delete commit event file
    const eventPath = path.join(eventsDir, commit._file);
    if (fs.existsSync(eventPath)) fs.unlinkSync(eventPath);

    // Delete corresponding history file
    const histDir = path.join(instanceDir, 'history');
    const histFile = String(index).padStart(3, '0') + '.md';
    const histPath = path.join(histDir, histFile);
    if (fs.existsSync(histPath)) fs.unlinkSync(histPath);

    res.json({ ok: true, deleted: 1 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Mental stories: find stories related to a mental across all instances ---
app.get('/api/mental-stories', (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const allStories = [];
    const instances = fs.readdirSync(instancesDir, { withFileTypes: true })
      .filter(d => d.isDirectory()).map(d => d.name);
    for (const inst of instances) {
      const evDir = path.join(instancesDir, inst, 'events');
      let events;
      try { events = readEvents(path.join(instancesDir, inst)); } catch { continue; }
      let segStart = 0, commitNum = 0;
      for (let i = 0; i < events.length; i++) {
        const e = events[i];
        if (e.type === 'action' && e.tool === 'commit' && !e.error) {
          commitNum++;
          const segment = events.slice(segStart, i);
          const hasMental = segment.some(ev =>
            ev.type === 'action' && (ev.tool === 'mental' || ev.tool === 'links') && ev.input &&
            (ev.input.content != null || ev.input.old != null || ev.input.delete) &&
            ev.input.name === name
          );
          if (hasMental) {
            // Read story from history file
            const histDir = path.join(instancesDir, inst, 'history');
            const items = parseHistoryDir(histDir);
            const story = items[commitNum - 1];
            allStories.push({
              instance: inst, index: commitNum,
              title: story?.title || e.input?.title || 'untitled',
              story: story?.story || e.input?.story || '',
              entities: story?.entities || []
            });
          }
          segStart = i + 1;
        }
      }
    }
    res.json(allStories);
  } catch { res.json([]); }
});

// --- Screenshot ---
const { getScreenshot } = require('../../../../scripts/screenshot');

app.get('/api/screenshot', async (req, res) => {
  try {
    const b64 = await getScreenshot();
    if (!b64) return res.status(500).json({ error: 'screenshot unavailable' });
    res.json({ image: b64, timestamp: Date.now() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Branch fork ---
app.post('/api/branch', (req, res) => {
  const { instance, branchName, at } = req.body;
  if (!instance || !branchName || !at) return res.status(400).json({ error: 'instance, branchName, at required' });
  const { instanceDir } = resolve(instance);
  const safeName = (branchName || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
  if (!safeName || safeName === '.' || safeName === '..') return res.status(400).json({ error: 'invalid branchName' });
  const branchDir = path.join(instanceDir, 'events', safeName);
  if (fs.existsSync(branchDir)) return res.status(409).json({ error: 'branch already exists' });
  fs.mkdirSync(path.join(branchDir, 'events'), { recursive: true });
  fs.mkdirSync(path.join(branchDir, 'history'), { recursive: true });
  fs.writeFileSync(path.join(branchDir, '.dusty.json'), JSON.stringify({
    events: 'events/',
    fork: { instance: '../..', at }
  }, null, 2));
  res.json({ ok: true, branchKey: `${instance}/${safeName}` });
});

// --- Branch delete ---
app.delete('/api/branch', async (req, res) => {
  const { instance, branchName } = req.body;
  if (!instance || !branchName) return res.status(400).json({ error: 'instance, branchName required' });
  const safeName = (branchName || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
  if (!safeName || safeName === '.' || safeName === '..') return res.status(400).json({ error: 'invalid branchName' });
  const { key, instanceDir } = resolve(instance);
  const branchDir = path.join(instanceDir, 'events', safeName);
  if (!fs.existsSync(branchDir)) return res.status(404).json({ error: 'branch not found' });
  // 停止该分支的 loop（如有）
  const branchKey = `${instance}/${safeName}`;
  const entry = loops.get(branchKey);
  if (entry) { entry.controller.abort(); await entry.done; }
  // 递归删除分支目录
  try { fs.rmSync(branchDir, { recursive: true, force: true }); } catch (e) { return res.status(500).json({ error: e.message }); }
  res.json({ ok: true });
});

// --- Branches tree ---
app.get('/api/branches', (req, res) => {
  const { instanceDir } = resolve(req.query.instance || '');
  function scan(dir) {
    const branches = [];
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const subDir = path.join(dir, entry.name);
        let config;
        try { config = JSON.parse(fs.readFileSync(path.join(subDir, '.dusty.json'), 'utf-8')); } catch { continue; }
        if (!config.fork) continue;
        branches.push({
          name: entry.name,
          at: config.fork.at,
          children: scan(path.join(subDir, 'events'))
        });
      }
    } catch {}
    return branches;
  }
  res.json(scan(path.join(instanceDir, 'events')));
});

// --- Zenmux Subscription proxy ---
app.get('/api/zenmux/subscription', async (req, res) => {
  const apiKey = process.env.ZENMUX_MANAGEMENT_API_KEY;
  if (!apiKey) return res.json({ available: false, reason: 'not_configured' });
  try {
    const baseUrl = process.env.ZENMUX_API_URL || 'https://zenmux.ai/api/v1';
    const r = await fetch(`${baseUrl}/management/subscription/detail`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    const data = await r.json();
    res.json({ available: true, ...data });
  } catch (e) {
    res.json({ available: true, error: e.message });
  }
});

let server = null;
let wss = null;
if (require.main === module) {
  const PORT = process.env.MENTAL_PORT || 3003;
  server = http.createServer(app);

  wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/api/terminal') {
      // 复用 Basic Auth 鉴权（WS 升级不经过 Express 中间件）
      // 优先检查 Authorization header，再fallback到 ?auth= 查询参数
      let authed = false;
      const authHeader = request.headers.authorization;
      if (authHeader && authHeader.startsWith('Basic ')) {
        const [user, pass] = Buffer.from(authHeader.slice(6), 'base64').toString().split(':');
        if (user === AUTH_USER && pass === AUTH_PASS) authed = true;
      }
      if (!authed) {
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
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', handleConnection);

  server.listen(PORT, '0.0.0.0', () => console.log('Mental Web running at http://0.0.0.0:' + PORT));
}

module.exports = { app, loops, get server() { return server; } };
