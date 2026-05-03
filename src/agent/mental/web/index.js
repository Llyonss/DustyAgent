require('dotenv').config({ path: require('path').join(__dirname, '../../../../.env') });

const path = require('path');
const fs = require('fs');
const express = require('express');
const { readEvents, writeEvent } = require('../../../core/event');
const { loop } = require('../../../core/loop');
const createMentalAgent = require('../brain');


const mentalRoot = path.join(__dirname, '../../../../mental');
const roomsDir = path.join(mentalRoot, 'space');
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
  const { key, eventsDir } = resolve(req.query.instance);
  try {
    res.json({ events: readEvents(eventsDir), running: loops.has(key) });
  } catch { res.json({ events: [], running: false }); }
});

app.delete('/api/events', (req, res) => {
  const { instance, file, mode } = req.body;
  if (!instance || !file || !mode) return res.status(400).json({ error: 'instance, file, mode required' });
  const { key, eventsDir } = resolve(instance);
  // 运行中禁止删除
  if (loops.has(key)) return res.status(409).json({ error: 'loop running, stop first' });
  try {
    const events = readEvents(eventsDir);
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
    const events = readEvents(eventsDir);
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
  const { eventsDir } = resolve(req.query.instance);
  const index = parseInt(req.query.index); // 1-based
  if (!index || index < 1) return res.status(400).json({ error: 'index required (1-based)' });
  try {
    const events = readEvents(eventsDir);
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
      try { events = readEvents(evDir); } catch { continue; }
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

if (require.main === module) {
  const PORT = process.env.MENTAL_PORT || 3003;
  app.listen(PORT, '0.0.0.0', () => console.log('Mental Web running at http://0.0.0.0:' + PORT));
}

module.exports = { app, loops };
