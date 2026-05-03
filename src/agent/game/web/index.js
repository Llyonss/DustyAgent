require('dotenv').config({ path: require('path').join(__dirname, '../../../../.env') });

const path = require('path');
const fs = require('fs');
const express = require('express');
const { readEvents, writeEvent } = require('../../../core/event');
const { loop } = require('../../../core/loop');
const createGameAgent = require('../brain');
const { splitGrid, extractFrames, removeBg } = require('../brain/tools');
const mediaTools = require('../../../hooks/tool-media');

const workspaceRoot = path.join(__dirname, '../../../../game');
fs.mkdirSync(workspaceRoot, { recursive: true });

let agentLoop = null;

function eventsDir() {
  const d = path.join(workspaceRoot, 'events');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/workspace', express.static(workspaceRoot));

// --- Files ---
app.get('/api/files', (req, res) => {
  const exts = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm']);
  const files = [];
  function scan(dir, rel) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'events') continue;
      const full = path.join(dir, entry.name);
      const r = rel ? rel + '/' + entry.name : entry.name;
      if (entry.isDirectory()) scan(full, r);
      else if (exts.has(path.extname(entry.name).toLowerCase())) {
        const stat = fs.statSync(full);
        files.push({ name: r, path: full, size: stat.size, mtime: stat.mtimeMs });
      }
    }
  }
  scan(workspaceRoot, '');
  files.sort((a, b) => b.mtime - a.mtime);
  res.json(files);
});

// --- Split ---
app.post('/api/split', async (req, res) => {
  try {
    const { image, rows, cols } = req.body;
    const outputs = await splitGrid(image, rows, cols);
    res.json({ outputs });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Remove BG ---
app.post('/api/remove-bg', async (req, res) => {
  try {
    const { image, threshold, cutoff, mode } = req.body;
    const output = await removeBg(image, threshold || 80, cutoff || 128, mode || 'ai');
    res.json({ output });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Extract ---
app.post('/api/extract', async (req, res) => {
  try {
    const { video, fps } = req.body;
    const outputs = extractFrames(video, fps);
    res.json({ outputs });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Skills ---
const skillsDir = path.join(workspaceRoot, 'skills');
fs.mkdirSync(skillsDir, { recursive: true });

app.get('/api/skills', (req, res) => {
  const files = fs.readdirSync(skillsDir).filter(f => f.endsWith('.md')).sort();
  const skills = files.map(f => ({
    name: f.replace(/\.md$/, ''),
    content: fs.readFileSync(path.join(skillsDir, f), 'utf-8'),
  }));
  res.json(skills);
});

app.put('/api/skills', (req, res) => {
  const { name, content } = req.body;
  if (!name || !content) return res.status(400).json({ error: 'name and content required' });
  fs.writeFileSync(path.join(skillsDir, name + '.md'), content);
  res.json({ ok: true });
});

app.delete('/api/skills', (req, res) => {
  const name = req.query.name;
  if (!name) return res.status(400).json({ error: 'name required' });
  const p = path.join(skillsDir, name + '.md');
  if (fs.existsSync(p)) fs.unlinkSync(p);
  res.json({ ok: true });
});

// --- Upload ---
app.put('/api/upload', (req, res) => {
  const name = (req.query.name || '').replace(/[<>:"|?*\x00-\x1f]/g, '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const filePath = path.join(workspaceRoot, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    fs.writeFileSync(filePath, Buffer.concat(chunks));
    res.json({ ok: true, path: filePath });
  });
});

// --- Chat ---
app.get('/api/events', (req, res) => {
  try {
    res.json({ events: readEvents(eventsDir()), running: !!agentLoop });
  } catch { res.json({ events: [], running: false }); }
});

app.post('/api/events', async (req, res) => {
  const { content } = req.body;
  if (content) writeEvent(eventsDir(), { type: 'user', content });
  res.json({ ok: true });

  if (agentLoop) return;

  const hooks = createGameAgent(workspaceRoot);
  const controller = new AbortController();
  const done = (async () => {
    try {
      for await (const turn of loop({ instanceDir: workspaceRoot, signal: controller.signal, hooks })) {}
    } catch (e) {
      if (e.name !== 'AbortError') console.error('Loop error:', e.message);
    } finally { agentLoop = null; }
  })();
  agentLoop = { controller, done };
});

app.delete('/api/loop', async (req, res) => {
  if (agentLoop) { agentLoop.controller.abort(); await agentLoop.done; }
  res.json({ ok: true });
});

// --- Generate Image (interleaved image-text) ---
const { GoogleGenAI } = require('@google/genai');
const MIME_MAP = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

function readImageData(filePath) {
  const p = path.normalize(filePath);
  if (!fs.existsSync(p)) throw new Error('Image not found: ' + p);
  const ext = path.extname(p).toLowerCase();
  if (!MIME_MAP[ext]) throw new Error('Unsupported format: ' + ext);
  return { data: fs.readFileSync(p).toString('base64'), mimeType: MIME_MAP[ext] };
}

let _genClient;
function genClient() {
  if (!_genClient) {
    _genClient = new GoogleGenAI({
      apiKey: process.env.LLM_API_KEY,
      vertexai: true,
      httpOptions: { apiVersion: 'v1', baseUrl: 'https://zenmux.ai/api/vertex-ai' },
    });
  }
  return _genClient;
}

// 解析 prompt 中的 [1] [2] 引用，构建图文交织 parts
function buildInterleavedParts(prompt, images) {
  if (!images || images.length === 0) return prompt; // 纯文本

  // 预读所有图片
  const imgParts = images.map(imgPath => {
    const { data, mimeType } = readImageData(imgPath);
    return { inlineData: { data, mimeType } };
  });

  // 按 [N] 拆分 prompt
  const parts = [];
  const regex = /\[(\d+)\]/g;
  let lastIdx = 0;
  let match;
  let hasRef = false;

  while ((match = regex.exec(prompt)) !== null) {
    const refNum = parseInt(match[1], 10);
    if (refNum < 1 || refNum > images.length) continue; // 无效引用跳过

    hasRef = true;
    // 添加引用前的文字
    const textBefore = prompt.slice(lastIdx, match.index);
    if (textBefore) parts.push({ text: textBefore });
    // 添加图片
    parts.push(imgParts[refNum - 1]);
    lastIdx = regex.lastIndex;
  }

  // 尾部文字
  const tail = prompt.slice(lastIdx);
  if (tail) parts.push({ text: tail });

  // 如果 prompt 里没有 [N] 引用，退回旧模式：图片在前，文字在后
  if (!hasRef) {
    return [...imgParts, { text: prompt }];
  }

  return parts;
}

app.post('/api/generate-image', async (req, res) => {
  const { prompt, images, options } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  const ts = Date.now();
  const outName = `gen_${ts}.png`;
  const outPath = path.join(workspaceRoot, outName);
  const opts = options || {};
  const imageConfig = {};
  if (opts.aspectRatio) imageConfig.aspectRatio = opts.aspectRatio;
  if (opts.imageSize) imageConfig.imageSize = opts.imageSize;

  try {
    const contents = buildInterleavedParts(prompt, images || []);
    const client = genClient();
    const response = await client.models.generateContent({
      model: 'google/gemini-3-pro-image-preview',
      contents,
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
        ...(Object.keys(imageConfig).length > 0 ? { imageConfig } : {}),
      },
    });

    const parts = response.candidates?.[0]?.content?.parts || [];
    const texts = [];
    let saved = false;
    for (const part of parts) {
      if (part.text) texts.push(part.text);
      if (part.inlineData && part.inlineData.data) {
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, Buffer.from(part.inlineData.data, 'base64'));
        saved = true;
      }
    }
    if (!saved) throw new Error('No image generated. ' + (texts.join(' ') || 'Empty response.'));

    res.json({ ok: true, path: outPath, name: outName, message: texts.join('\n') || '' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Upload temp ref image (base64) ---
app.post('/api/upload-ref', (req, res) => {
  const { data, name } = req.body;
  if (!data || !name) return res.status(400).json({ error: 'data and name required' });
  const buf = Buffer.from(data, 'base64');
  const refName = `ref_${Date.now()}_${name}`;
  const refPath = path.join(workspaceRoot, refName);
  fs.writeFileSync(refPath, buf);
  res.json({ ok: true, path: refPath, name: refName });
});

// --- Workspace path ---
app.get('/api/workspace-path', (req, res) => {
  res.json({ path: workspaceRoot });
});

if (require.main === module) {
  const PORT = process.env.GAME_PORT || 3004;
  app.listen(PORT, '0.0.0.0', () => console.log('Game Asset Tool running at http://0.0.0.0:' + PORT));
}

module.exports = { app };
