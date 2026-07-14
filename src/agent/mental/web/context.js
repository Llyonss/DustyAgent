// 统一上下文树：Group / Agent 是容器，Chat 是叶子；所有关系只由子节点 parent 表达。
const path = require('path');
const fs = require('fs');
const { writeEvent } = require('../../../core/event');

module.exports = function ({ app, mentalRoot }) {
  const groupsDir = path.join(mentalRoot, 'groups');
  const agentsDir = path.join(mentalRoot, 'agents');
  const systemsDir = path.join(mentalRoot, 'systems');
  const instancesDir = path.join(mentalRoot, 'instances');

  const read = p => { try { return fs.readFileSync(p, 'utf-8'); } catch { return null; } };
  const safe = s => {
    const v = (s || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
    return v && v !== '.' && v !== '..' ? v : '';
  };
  const groupFile = name => path.join(groupsDir, safe(name) + '.md');
  const agentDir = name => path.join(agentsDir, safe(name));
  const instanceDir = name => path.join(instancesDir, safe(name));

  function parseGroup(raw, fallback) {
    if (raw == null) return null;
    const out = { type: 'group', name: fallback, parent: '', wiki: '', legacyChats: [] };
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!m) { out.wiki = raw; return out; }
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^(\w+)\s*:\s*(.*)$/); if (!kv) continue;
      const v = kv[2].trim();
      if (kv[1] === 'name') out.name = v || fallback;
      if (kv[1] === 'parent') out.parent = v;
      if (kv[1] === 'chats') {
        try { out.legacyChats = JSON.parse(v); } catch { out.legacyChats = v ? v.split(',').map(x => x.trim()).filter(Boolean) : []; }
      }
    }
    out.wiki = m[2];
    return out;
  }
  function readGroup(name) { name = safe(name); return name ? parseGroup(read(groupFile(name)), name) : null; }
  function writeGroup(g) {
    fs.mkdirSync(groupsDir, { recursive: true });
    fs.writeFileSync(groupFile(g.name), `---\nname: ${g.name}\nparent: ${g.parent || ''}\n---\n${g.wiki || ''}`, 'utf-8');
  }
  function allGroups() {
    let files = []; try { files = fs.readdirSync(groupsDir).filter(f => f.endsWith('.md')); } catch {}
    return files.map(f => parseGroup(read(path.join(groupsDir, f)), f.slice(0, -3))).filter(Boolean);
  }
  function readAgent(name) {
    name = safe(name); if (!name) return null;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(agentDir(name), 'agent.json'), 'utf-8'));
      return { type: 'agent', name, parent: safe(data.parent), wiki: read(path.join(agentDir(name), 'wiki.md')) || '' };
    } catch { return null; }
  }
  function writeAgent(agent) {
    const dir = agentDir(agent.name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'agent.json'), JSON.stringify({ name: agent.name, parent: agent.parent || '' }, null, 2), 'utf-8');
    if (agent.wiki != null) fs.writeFileSync(path.join(dir, 'wiki.md'), agent.wiki, 'utf-8');
  }
  function allAgents() {
    let dirs = []; try { dirs = fs.readdirSync(agentsDir, { withFileTypes: true }).filter(x => x.isDirectory()); } catch {}
    return dirs.map(x => readAgent(x.name)).filter(Boolean);
  }
  function systemDir(name) { return path.join(systemsDir, safe(name)); }
  function readSystem(name) {
    name = safe(name); if (!name) return null;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(systemDir(name), 'meta.json'), 'utf-8'));
      return { type: 'system', name, label: typeof meta.name === 'string' && meta.name.trim() ? meta.name.trim() : name, parent: safe(meta.parent) };
    } catch { return null; }
  }
  function writeSystem(system) {
    const dir = systemDir(system.name);
    fs.mkdirSync(dir, { recursive: true });
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf-8')); } catch {}
    meta.name = typeof meta.name === 'string' && meta.name.trim() ? meta.name : system.name;
    meta.parent = system.parent || '';
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
  }
  function allSystems() {
    let dirs = []; try { dirs = fs.readdirSync(systemsDir, { withFileTypes: true }).filter(x => x.isDirectory()); } catch {}
    return dirs.map(x => readSystem(x.name)).filter(Boolean);
  }
  function readChat(name) {
    name = safe(name); if (!name) return null;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(instanceDir(name), 'instance.json'), 'utf-8'));
      return { type: 'chat', name, parent: safe(data.parent) };
    } catch { return { type: 'chat', name, parent: '' }; }
  }
  function allChats() {
    let dirs = []; try { dirs = fs.readdirSync(instancesDir, { withFileTypes: true }).filter(x => x.isDirectory()); } catch {}
    return dirs.map(x => readChat(x.name));
  }
  function parentContainers() { return [...allGroups(), ...allAgents()]; }
  function containers() { return [...parentContainers(), ...allSystems()]; }
  function container(name) { return readGroup(name) || readAgent(name) || readSystem(name); }
  function parentContainer(name) { return readGroup(name) || readAgent(name); }
  function nameTaken(name) { return !!container(name); }
  function validParent(parent) { return !parent || !!parentContainer(parent); }
  function wouldCycle(name, parent) {
    const seen = new Set([name]); let cur = parent;
    while (cur) { if (seen.has(cur)) return true; seen.add(cur); cur = container(cur)?.parent || ''; }
    return false;
  }

  // 兼容旧 groups/*.md 的 chats：只迁移成 Chat.instance.json，随后移除父端 chats。
  function migrateLegacyChats() {
    for (const g of allGroups()) {
      if (!g.legacyChats.length) continue;
      for (const chat of g.legacyChats) {
        const dir = instanceDir(chat); if (!fs.existsSync(dir)) continue;
        const meta = path.join(dir, 'instance.json');
        if (!fs.existsSync(meta)) fs.writeFileSync(meta, JSON.stringify({ name: chat, parent: g.name }, null, 2), 'utf-8');
      }
      writeGroup(g);
    }
  }
  migrateLegacyChats();

  function ancestorChain(start) {
    const out = [], seen = new Set(); let cur = safe(start);
    while (cur && !seen.has(cur)) { seen.add(cur); const n = container(cur); if (!n) break; out.unshift(n); cur = n.parent; }
    return out;
  }
  function nearestAgentForChat(chat) {
    let cur = readChat(chat)?.parent || ''; const seen = new Set();
    while (cur && !seen.has(cur)) { seen.add(cur); const n = container(cur); if (!n) break; if (n.type === 'agent') return n; cur = n.parent; }
    return null;
  }
  function configDirForChat(chat) { const a = nearestAgentForChat(chat); return a ? agentDir(a.name) : instanceDir(chat); }
  function wikiChain(parent) {
    return ancestorChain(parent).map(n => ({
      name: n.name,
      type: n.type,
      file: n.type === 'group' ? groupFile(n.name) : path.join(agentDir(n.name), 'wiki.md'),
      wiki: n.type === 'group' ? (readGroup(n.name)?.wiki || '') : (readAgent(n.name)?.wiki || ''),
    }));
  }
  function contextForChat(chat) {
    const parent = readChat(chat)?.parent; if (!parent) return null;
    const chain = wikiChain(parent); if (!chain.length) return null;
    return { groupsDir, groupName: chain[chain.length - 1].name, chain };
  }
  function initializeChatWiki(chatDir, parent) {
    const chain = wikiChain(parent); if (!chain.length) return;
    const eventsDir = path.join(chatDir, 'events');
    const turn = Date.now();
    for (const node of chain) {
      writeEvent(eventsDir, {
        type: 'action', turn, tool: 'context', toolUseId: `init_wiki_${node.type}_${node.name}`,
        input: { name: node.name },
        output: node.wiki && node.wiki.trim() ? node.wiki : `(${node.type === 'agent' ? 'Agent' : '分组'}「${node.name}」wiki 为空)`,
      });
    }
  }
  function moveNode(type, name, parent) {
    name = safe(name); parent = safe(parent);
    if (!validParent(parent)) throw Object.assign(new Error('parent not found'), { status: 404 });
    if ((type === 'group' || type === 'agent' || type === 'system') && wouldCycle(name, parent)) throw Object.assign(new Error('不能移动到自身或后代下'), { status: 409 });
    if (type === 'group') { const n = readGroup(name); if (!n) throw Object.assign(new Error('not found'), { status: 404 }); n.parent = parent; writeGroup(n); }
    else if (type === 'agent') { const n = readAgent(name); if (!n) throw Object.assign(new Error('not found'), { status: 404 }); n.parent = parent; writeAgent(n); }
    else if (type === 'system') { const n = readSystem(name); if (!n) throw Object.assign(new Error('not found'), { status: 404 }); n.parent = parent; writeSystem(n); }
    else if (type === 'chat') {
      const n = readChat(name); if (!n || !fs.existsSync(instanceDir(name))) throw Object.assign(new Error('not found'), { status: 404 });
      fs.writeFileSync(path.join(instanceDir(name), 'instance.json'), JSON.stringify({ name, parent }, null, 2), 'utf-8');
    } else throw Object.assign(new Error('invalid type'), { status: 400 });
  }

  app.get('/api/ctx/tree', (req, res) => res.json([...containers(), ...allChats()].map(({ type, name, label, parent }) => ({ type, name, ...(label ? { label } : {}), parent }))));
  app.get('/api/ctx/system/files', (req, res) => {
    const name = safe(req.query.name), system = readSystem(name);
    if (!system) return res.status(404).json({ error: 'not found' });
    const root = systemDir(name);
    function scan(dir, rel = '') {
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
      return entries.filter(e => !(rel === '' && e.name === 'meta.json')).map(e => {
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return { type: 'dir', name: e.name, path: childRel, children: scan(full, childRel) };
        return { type: 'file', name: e.name, path: path.relative(path.join(mentalRoot, '..'), full).replace(/\\/g, '/') };
      }).sort((a, b) => a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name));
    }
    res.json({ entries: scan(root) });
  });
  app.post('/api/ctx/system', (req, res) => {
    const name = safe(req.body.name), parent = safe(req.body.parent);
    if (!name) return res.status(400).json({ error: 'name required' });
    if (nameTaken(name) || fs.existsSync(systemDir(name))) return res.status(409).json({ error: 'name exists' });
    if (!validParent(parent)) return res.status(404).json({ error: 'parent not found' });
    writeSystem({ name, parent }); res.json({ ok: true });
  });
  app.delete('/api/ctx/system', (req, res) => {
    const name = safe(req.body.name), system = readSystem(name); if (!system) return res.status(404).json({ error: 'not found' });
    if ([...containers(), ...allChats()].some(n => n.parent === name)) return res.status(409).json({ error: '请先删除子节点' });
    try { fs.rmSync(systemDir(name), { recursive: true, force: true }); } catch {}
    res.json({ ok: true });
  });
  app.post('/api/ctx/group', (req, res) => {
    const name = safe(req.body.name), parent = safe(req.body.parent);
    if (!name) return res.status(400).json({ error: 'name required' });
    if (nameTaken(name)) return res.status(409).json({ error: 'name exists' });
    if (!validParent(parent)) return res.status(404).json({ error: 'parent not found' });
    if (wouldCycle(name, parent)) return res.status(409).json({ error: 'cycle' });
    writeGroup({ name, parent, wiki: '' }); res.json({ ok: true });
  });
  app.delete('/api/ctx/group', (req, res) => {
    const name = safe(req.body.name), g = readGroup(name); if (!g) return res.status(404).json({ error: 'not found' });
    if ([...containers(), ...allChats()].some(n => n.parent === name)) return res.status(409).json({ error: '请先删除子节点' });
    try { fs.unlinkSync(groupFile(name)); } catch {} res.json({ ok: true });
  });
  app.get('/api/ctx/wiki', (req, res) => {
    const n = parentContainer(req.query.name); if (!n) return res.status(404).json({ error: 'not found' });
    res.json({ content: n.wiki || '', type: n.type });
  });
  app.post('/api/ctx/wiki', (req, res) => {
    const n = parentContainer(req.body.name); if (!n) return res.status(404).json({ error: 'not found' });
    n.wiki = (req.body.content || '').replace(/\r\n/g, '\n');
    if (n.type === 'group') writeGroup(n); else writeAgent(n);
    res.json({ ok: true });
  });
  app.post('/api/ctx/move', (req, res) => {
    try { moveNode(req.body.type, req.body.name, req.body.parent); res.json({ ok: true }); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  return { groupsDir, agentsDir, systemsDir, instancesDir, readGroup, writeGroup, allGroups, readAgent, writeAgent, allAgents, readSystem, writeSystem, allSystems, readChat, container, ancestorChain, wikiChain, initializeChatWiki, nearestAgentForChat, configDirForChat, contextForChat, moveNode, safe, agentDir, systemDir, instanceDir };
};
