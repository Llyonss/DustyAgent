const fs = require('fs');
const path = require('path');

// --- YAML front matter parser (hand-rolled, no deps) ---

function parseFrontMatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: content };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (!kv) continue;
    let val = kv[2].trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      val = val.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
    }
    meta[kv[1]] = val;
  }
  return { meta, body: m[2] };
}

// --- File helpers ---

function tryRead(filePath) {
  try { return fs.readFileSync(filePath, 'utf-8'); } catch { return null; }
}

function scanMdFiles(dir) {
  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.md'))
      .sort()
      .map(f => {
        const content = fs.readFileSync(path.join(dir, f), 'utf-8');
        const { meta, body } = parseFrontMatter(content);
        return { name: f.replace(/\.md$/, ''), meta, body, file: f };
      });
  } catch { return []; }
}

function scanChapters(chaptersDir) {
  const chapters = [];
  try {
    for (const vol of fs.readdirSync(chaptersDir).sort()) {
      const volDir = path.join(chaptersDir, vol);
      if (!fs.statSync(volDir).isDirectory()) continue;
      const files = fs.readdirSync(volDir).filter(f => f.endsWith('.md')).sort();
      for (const f of files) chapters.push({ volume: vol, file: f, name: f.replace(/\.md$/, '') });
    }
  } catch {}
  return chapters;
}

// --- Snapshot ---

function buildSnapshot(instanceDir) {
  const outline = tryRead(path.join(instanceDir, 'outline.md'));
  const style = tryRead(path.join(instanceDir, 'style.md'));
  const allEntities = scanMdFiles(path.join(instanceDir, 'world', 'entities'));
  const allRelations = scanMdFiles(path.join(instanceDir, 'world', 'relations'));

  const entities = allEntities.filter(e => e.meta.status === 'active');
  const relations = allRelations.filter(r => r.meta.status === 'active');
  const chapters = scanChapters(path.join(instanceDir, 'chapters'));
  const histories = scanMdFiles(path.join(instanceDir, 'history'));

  return { outline, style, entities, relations, chapters, histories };
}

function writeSnapshot(instanceDir, snapshot) {
  fs.writeFileSync(
    path.join(instanceDir, '.context-snapshot.json'),
    JSON.stringify(snapshot, null, 2)
  );
}

function loadSnapshot(instanceDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(instanceDir, '.context-snapshot.json'), 'utf-8'));
  } catch { return null; }
}

function ensureSnapshot(instanceDir) {
  let snap = loadSnapshot(instanceDir);
  if (!snap) {
    snap = buildSnapshot(instanceDir);
    writeSnapshot(instanceDir, snap);
  }
  return snap;
}

// --- Context injection (snapshot → message prefix) ---

function buildContextMessages(snapshot) {
  const sections = [];

  // Histories (titles only — use recall/read for details)
  if (snapshot.histories && snapshot.histories.length > 0) {
    const items = snapshot.histories.map((h, i) => {
      const title = h.meta?.title || h.meta?.summary || h.name;
      return `- v${i + 1}: ${title}`;
    }).join('\n');
    sections.push(`## 过往经历\n${items}\n\n（需要详情时用 recall 工具查看 history/ 目录下的对应文件）`);
  }

  if (snapshot.outline) sections.push(`## 大纲\n${snapshot.outline}`);
  if (snapshot.style) sections.push(`## 文风\n${snapshot.style}`);

  if (snapshot.entities && snapshot.entities.length > 0) {
    const cards = snapshot.entities.map(e => `### ${e.name}\n${e.body}`).join('\n\n');
    sections.push(`## 活跃实体\n${cards}`);
  }

  if (snapshot.relations && snapshot.relations.length > 0) {
    const cards = snapshot.relations.map(r => {
      const inv = Array.isArray(r.meta?.involves) ? r.meta.involves.join(', ') : '';
      return `### ${r.name}${inv ? ` (${inv})` : ''}\n${r.body}`;
    }).join('\n\n');
    sections.push(`## 活跃关联\n${cards}`);
  }

  // Chapter list (names only, no content)
  if (snapshot.chapters && snapshot.chapters.length > 0) {
    const list = snapshot.chapters.map(c => `- ${c.volume}/${c.file}`).join('\n');
    sections.push(`## 已有章节\n${list}\n\n（需要时用 read 工具查看章节内容）`);
  }

  if (sections.length === 0) return [];

  const text = sections.join('\n\n---\n\n');
  return [
    { role: 'user', content: [{ type: 'text', text: `以下是你的工作上下文（从快照读取，本次会话内冻结不变，commit 后刷新）：\n\n${text}` }] },
    { role: 'assistant', content: [{ type: 'text', text: '收到，我已了解当前工作上下文。' }] },
  ];
}

module.exports = { parseFrontMatter, buildSnapshot, writeSnapshot, loadSnapshot, ensureSnapshot, buildContextMessages, scanMdFiles, scanChapters, tryRead };
