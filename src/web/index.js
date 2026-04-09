require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const path = require('path');
const fs = require('fs');
const express = require('express');
const { readEvents, writeEvent } = require('../core/event');
const { loop } = require('../core/loop');
const createDefaultAgent = require('../agent/default');
const createDocAgent = require('../agent/doc');

function createAgent(instanceDir) {
  if (fs.existsSync(path.join(instanceDir, 'doc.md'))) {
    return createDocAgent(instanceDir);
  }
  return createDefaultAgent(instanceDir);
}

const instancesRoot = path.join(__dirname, '../../instances');

const loops = new Map();

function resolve(name) {
  const safe = (name || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
  const key = safe && safe !== '.' && safe !== '..' ? safe : 'default';
  const instanceDir = path.join(instancesRoot, key);
  const eventsDir = path.join(instanceDir, 'events');
  return { key, instanceDir, eventsDir };
}

function ensureDirs({ eventsDir }) {
  fs.mkdirSync(eventsDir, { recursive: true });
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/instances', (req, res) => {
  try {
    const dirs = fs.readdirSync(instancesRoot, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort();
    res.json(dirs);
  } catch (e) {
    res.json([]);
  }
});

app.post('/api/instances', (req, res) => {
  const { name, agent } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const { instanceDir, eventsDir } = resolve(name);
  ensureDirs({ eventsDir });
  if (agent === 'doc') {
    const docPath = path.join(instanceDir, 'doc.md');
    if (!fs.existsSync(docPath)) fs.writeFileSync(docPath, '');
  }
  res.json({ ok: true });
});

app.get('/api/events', (req, res) => {
  const { key, eventsDir } = resolve(req.query.instance);
  res.json({ events: readEvents(eventsDir), running: loops.has(key) });
});

app.post('/api/events', async (req, res) => {
  const { content } = req.body;

  const { key, instanceDir, eventsDir } = resolve(req.query.instance);
  ensureDirs({ eventsDir });
  if (content) {
    writeEvent(eventsDir, { type: 'user', content });
  } else {
    // Retry: remove trailing error events before restarting the loop
    const events = readEvents(eventsDir);
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type !== 'error') break;
      fs.unlinkSync(path.join(eventsDir, events[i]._file));
    }
  }
  res.json({ ok: true });

  if (loops.has(key)) return;

  const hooks = createAgent(instanceDir);
  const controller = new AbortController();
  const done = (async () => {
    try {
      for await (const turn of loop({ instanceDir, signal: controller.signal, hooks })) {
      }
    } catch (e) {
      if (e.name !== 'AbortError') console.error('Loop error:', e.message);
    } finally {
      loops.delete(key);
    }
  })();
  loops.set(key, { controller, done });
});

app.get('/api/instance-info', (req, res) => {
  const { instanceDir } = resolve(req.query.instance);
  const agent = fs.existsSync(path.join(instanceDir, 'doc.md')) ? 'doc' : 'default';
  res.json({ agent });
});

app.get('/api/doc', (req, res) => {
  const { instanceDir } = resolve(req.query.instance);
  const docPath = path.join(instanceDir, 'doc.md');
  try {
    res.json({ content: fs.readFileSync(docPath, 'utf-8') });
  } catch (e) {
    res.json({ content: null });
  }
});

app.get('/api/usage', (req, res) => {
  const { instanceDir } = resolve(req.query.instance);
  const usageFile = path.join(instanceDir, 'usage.json');
  try {
    res.json(JSON.parse(fs.readFileSync(usageFile, 'utf-8')));
  } catch (e) {
    res.json([]);
  }
});

app.get('/api/file', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'path required' });
  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(filePath, { withFileTypes: true })
        .map(d => ({ name: d.name, isDirectory: d.isDirectory() }))
        .sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      res.json({ type: 'directory', path: filePath, entries });
    } else {
      const content = fs.readFileSync(filePath, 'utf-8');
      res.json({ type: 'file', path: filePath, content, size: stat.size });
    }
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.delete('/api/loop', async (req, res) => {
  const { key } = resolve(req.query.instance);
  const entry = loops.get(key);
  if (entry) {
    entry.controller.abort();
    await entry.done;
  }
  res.json({ ok: true });
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log('Dusty4 Web running at http://localhost:' + PORT);
  });
}

module.exports = { app, loops };
