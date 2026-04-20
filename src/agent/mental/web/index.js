require('dotenv').config({ path: require('path').join(__dirname, '../../../../.env') });

const path = require('path');
const fs = require('fs');
const express = require('express');
const { readEvents, writeEvent } = require('../../../core/event');
const { loop } = require('../../../core/loop');
const createMentalAgent = require('../brain');

const mentalRoot = path.join(__dirname, '../../../../mental');
const roomsDir = path.join(mentalRoot, 'rooms');
const instancesDir = path.join(mentalRoot, 'instances');
const loops = new Map();

function ensureDirs() {
  fs.mkdirSync(roomsDir, { recursive: true });
  fs.mkdirSync(instancesDir, { recursive: true });
}
ensureDirs();

function resolve(name) {
  const safe = (name || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
  const key = safe && safe !== '.' && safe !== '..' ? safe : 'default';
  const instanceDir = path.join(instancesDir, key);
  const eventsDir = path.join(instanceDir, 'events');
  return { key, instanceDir, eventsDir };
}

function ensureInstance(instanceDir) {
  fs.mkdirSync(path.join(instanceDir, 'events'), { recursive: true });
  fs.mkdirSync(path.join(instanceDir, 'history'), { recursive: true });
}

const app = express();
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

// --- Events ---
app.get('/api/events', (req, res) => {
  const { key, eventsDir } = resolve(req.query.instance);
  try {
    res.json({ events: readEvents(eventsDir), running: loops.has(key) });
  } catch { res.json({ events: [], running: false }); }
});

app.post('/api/events', async (req, res) => {
  const { content, retry } = req.body;
  const { key, instanceDir, eventsDir } = resolve(req.query.instance);
  ensureInstance(instanceDir);

  if (retry) {
    const events = readEvents(eventsDir);
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type !== 'error') break;
      fs.unlinkSync(path.join(eventsDir, events[i]._file));
    }
  }

  if (content) writeEvent(eventsDir, { type: 'user', content });
  res.json({ ok: true });

  if (loops.has(key)) return;

  const hooks = createMentalAgent(instanceDir);
  const controller = new AbortController();
  const done = (async () => {
    try {
      for await (const turn of loop({ instanceDir, signal: controller.signal, hooks })) {}
    } catch (e) {
      if (e.name !== 'AbortError') console.error('Loop error:', e.message);
    } finally { loops.delete(key); }
  })();
  loops.set(key, { controller, done });
});

app.delete('/api/loop', async (req, res) => {
  const { key } = resolve(req.query.instance);
  const entry = loops.get(key);
  if (entry) { entry.controller.abort(); await entry.done; }
  res.json({ ok: true });
});

// --- Rooms (global) ---
app.get('/api/rooms', (req, res) => {
  try {
    const files = fs.readdirSync(roomsDir).filter(f => f.endsWith('.md'));
    const rooms = files.map(f => {
      const name = f.replace(/\.md$/, '');
      const linksFile = path.join(roomsDir, name + '.links');
      let links = null;
      try { links = fs.readFileSync(linksFile, 'utf-8'); } catch {}
      return { name, hasLinks: !!links };
    }).sort((a, b) => a.name.localeCompare(b.name));
    res.json(rooms);
  } catch { res.json([]); }
});

app.get('/api/room', (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const md = fs.readFileSync(path.join(roomsDir, name + '.md'), 'utf-8');
    let links = null;
    try { links = fs.readFileSync(path.join(roomsDir, name + '.links'), 'utf-8'); } catch {}
    res.json({ name, content: md, links });
  } catch (e) { res.status(404).json({ error: e.message }); }
});

// --- Instance data ---
app.get('/api/instance', (req, res) => {
  const { instanceDir } = resolve(req.query.name);
  try {
    let selfMd = null, selfLinks = null;
    try { selfMd = fs.readFileSync(path.join(instanceDir, 'self.md'), 'utf-8'); } catch {}
    try { selfLinks = fs.readFileSync(path.join(instanceDir, 'self.links'), 'utf-8'); } catch {}
    res.json({ selfMd, selfLinks });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Self save (instance private room) ---
app.post('/api/self-save', (req, res) => {
  const { instance, suffix, content } = req.body;
  if (!instance || !suffix || typeof content !== 'string') return res.status(400).json({ error: 'instance, suffix, content required' });
  const { instanceDir } = resolve(instance);
  try {
    ensureInstance(instanceDir);
    fs.writeFileSync(path.join(instanceDir, suffix), content.replace(/\r\n/g, '\n'), 'utf-8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/history', (req, res) => {
  const { instanceDir } = resolve(req.query.instance);
  const historyDir = path.join(instanceDir, 'history');
  try {
    const files = fs.readdirSync(historyDir).filter(f => f.endsWith('.md')).sort();
    const items = files.map(f => {
      const raw = fs.readFileSync(path.join(historyDir, f), 'utf-8');
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
    res.json(items);
  } catch { res.json([]); }
});

// --- Room save (from frontend editor) ---
app.post('/api/room-save', (req, res) => {
  const { name, suffix, content } = req.body;
  if (!name || !suffix || typeof content !== 'string') return res.status(400).json({ error: 'name, suffix, content required' });
  try {
    fs.mkdirSync(roomsDir, { recursive: true });
    fs.writeFileSync(path.join(roomsDir, name + suffix), content.replace(/\r\n/g, '\n'), 'utf-8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- File read/write ---
app.get('/api/file', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'path required' });
  try { res.json({ content: fs.readFileSync(filePath, 'utf-8') }); }
  catch (e) { res.status(404).json({ error: e.message }); }
});

app.post('/api/file', (req, res) => {
  const { path: filePath, content } = req.body;
  if (!filePath || typeof content !== 'string') return res.status(400).json({ error: 'path and content required' });
  try {
    fs.writeFileSync(filePath, content.replace(/\r\n/g, '\n'), 'utf-8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

if (require.main === module) {
  const PORT = process.env.MENTAL_PORT || 3003;
  app.listen(PORT, '0.0.0.0', () => console.log('Mental Web running at http://0.0.0.0:' + PORT));
}

module.exports = { app, loops };
