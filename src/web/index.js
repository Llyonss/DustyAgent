require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const path = require('path');
const fs = require('fs');
const express = require('express');
const { readEvents, writeEvent } = require('../core/event');
const { writeLog } = require('../core/log');
const { loop } = require('../core/loop');

const instancesRoot = path.join(__dirname, '../../instances');
fs.mkdirSync(instancesRoot, { recursive: true });

const loops = new Map(); // instance名 → AbortController

function resolve(name) {
  const safe = (name || 'default').replace(/[^a-zA-Z0-9_-]/g, '');
  const instanceDir = path.join(instancesRoot, safe || 'default');
  const eventsDir = path.join(instanceDir, 'events');
  const logDir = path.join(instanceDir, 'logs');
  fs.mkdirSync(eventsDir, { recursive: true });
  return { key: safe || 'default', instanceDir, eventsDir, logDir };
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/instances', (req, res) => {
  const dirs = fs.readdirSync(instancesRoot, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();
  res.json(dirs);
});

app.get('/api/events', (req, res) => {
  const { key, eventsDir } = resolve(req.query.instance);
  res.json({ events: readEvents(eventsDir), running: loops.has(key) });
});

app.post('/api/events', async (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });

  const { key, instanceDir, eventsDir, logDir } = resolve(req.query.instance);
  writeEvent(eventsDir, { type: 'user', content });
  res.json({ ok: true });

  if (loops.has(key)) return;

  const controller = new AbortController();
  loops.set(key, controller);
  (async () => {
    try {
      for await (const turn of loop({ instanceDir, signal: controller.signal })) {
        writeLog(logDir, turn);
      }
    } catch (e) {
      if (e.name !== 'AbortError') console.error('Loop error:', e.message);
    } finally {
      loops.delete(key);
    }
  })();
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

app.delete('/api/loop', (req, res) => {
  const { key } = resolve(req.query.instance);
  const controller = loops.get(key);
  if (controller) controller.abort();
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Dusty4 Web running at http://localhost:' + PORT);
});
