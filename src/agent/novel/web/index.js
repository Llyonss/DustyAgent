require('dotenv').config({ path: require('path').join(__dirname, '../../../../.env') });

const path = require('path');
const fs = require('fs');
const express = require('express');
const { readEvents, writeEvent } = require('../../../core/event');
const { loop } = require('../../../core/loop');
const createNovelAgent = require('../brain');
const { scanMdFiles, scanChapters, tryRead, parseFrontMatter } = require('../brain/context');

const novelsRoot = path.join(__dirname, '../../../../novels');
const loops = new Map();

function resolve(name) {
  const safe = (name || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
  const key = safe && safe !== '.' && safe !== '..' ? safe : 'default';
  const instanceDir = path.join(novelsRoot, key);
  const eventsDir = path.join(instanceDir, 'events');
  return { key, instanceDir, eventsDir };
}

function ensureDirs(instanceDir) {
  const dirs = [
    'events', 'world/entities', 'world/relations', 'chapters/v1', 'history',
  ];
  for (const d of dirs) fs.mkdirSync(path.join(instanceDir, d), { recursive: true });
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Novel list ---
app.get('/api/novels', (req, res) => {
  try {
    const dirs = fs.readdirSync(novelsRoot, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name).sort();
    res.json(dirs);
  } catch { res.json([]); }
});

app.post('/api/novels', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const { instanceDir } = resolve(name);
  ensureDirs(instanceDir);
  res.json({ ok: true });
});

// --- Events ---
app.get('/api/events', (req, res) => {
  const { key, eventsDir } = resolve(req.query.novel);
  try {
    res.json({ events: readEvents(eventsDir), running: loops.has(key) });
  } catch { res.json({ events: [], running: false }); }
});

app.post('/api/events', async (req, res) => {
  const { content, retry } = req.body;
  const { key, instanceDir, eventsDir } = resolve(req.query.novel);
  ensureDirs(instanceDir);

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

  const hooks = createNovelAgent(instanceDir);
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
  const { key } = resolve(req.query.novel);
  const entry = loops.get(key);
  if (entry) { entry.controller.abort(); await entry.done; }
  res.json({ ok: true });
});

// --- Novel data (dashboard) ---
app.get('/api/novel-data', (req, res) => {
  const { instanceDir } = resolve(req.query.novel);
  try {
    const outline = tryRead(path.join(instanceDir, 'outline.md'));
    const style = tryRead(path.join(instanceDir, 'style.md'));
    const entities = scanMdFiles(path.join(instanceDir, 'world', 'entities'));
    const relations = scanMdFiles(path.join(instanceDir, 'world', 'relations'));
    const histories = scanMdFiles(path.join(instanceDir, 'history'));
    const chapters = scanChapters(path.join(instanceDir, 'chapters'));

    res.json({ outline, style, entities, relations, histories, chapters });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- File read/write (reuse from main web) ---
app.get('/api/file', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'path required' });
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ content });
  } catch (e) { res.status(404).json({ error: e.message }); }
});

app.post('/api/file', (req, res) => {
  const { path: filePath, content } = req.body;
  if (!filePath || typeof content !== 'string') return res.status(400).json({ error: 'path and content required' });
  try {
    fs.writeFileSync(filePath, content.replace(/\r\n/g, '\n'), 'utf-8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Novel path (for frontend to construct file paths) ---
app.get('/api/novel-path', (req, res) => {
  const { instanceDir } = resolve(req.query.novel);
  res.json({ path: instanceDir });
});

// --- Usage ---
app.get('/api/usage', (req, res) => {
  const { instanceDir } = resolve(req.query.novel);
  try { res.json(JSON.parse(fs.readFileSync(path.join(instanceDir, 'usage.json'), 'utf-8'))); }
  catch { res.json([]); }
});

if (require.main === module) {
  const PORT = process.env.NOVEL_PORT || 3001;
  app.listen(PORT, '0.0.0.0', () => console.log('Novel Web running at http://0.0.0.0:' + PORT));
}

module.exports = { app, loops };
