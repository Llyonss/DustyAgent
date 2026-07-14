// Agent 数据与启动脚本。listen.js 在 Web 系统启动时 require 一次。
const path = require('path');
const fs = require('fs');

module.exports = function ({ app, ctx, ensureInstance }) {
  const defaultSystem = path.join(__dirname, '../brain/system-default.md');
  const read = p => { try { return fs.readFileSync(p, 'utf-8'); } catch { return ''; } };

  function create(name, parent) {
    name = ctx.safe(name); parent = ctx.safe(parent);
    if (!name) throw Object.assign(new Error('name required'), { status: 400 });
    if (ctx.container(name)) throw Object.assign(new Error('name exists'), { status: 409 });
    if (parent && !ctx.readGroup(parent) && !ctx.readAgent(parent)) throw Object.assign(new Error('parent not found'), { status: 404 });
    const dir = ctx.agentDir(name);
    fs.mkdirSync(path.join(dir, 'tools'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'agent.json'), JSON.stringify({ name, parent }, null, 2), 'utf-8');
    fs.writeFileSync(path.join(dir, 'wiki.md'), '', 'utf-8');
    fs.writeFileSync(path.join(dir, 'system.md'), read(defaultSystem), 'utf-8');
    fs.writeFileSync(path.join(dir, 'model.json'), '{}', 'utf-8');
    fs.writeFileSync(path.join(dir, 'tools.json'), JSON.stringify({ disabled: ['mental', 'commit', 'history', 'task', 'loop', 'image', 'video'] }, null, 2), 'utf-8');
    fs.writeFileSync(path.join(dir, 'listen.js'), '// 系统启动时运行一次\n', 'utf-8');
  }

  app.post('/api/agent', (req, res) => {
    try { create(req.body.name, req.body.parent); res.json({ ok: true }); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.delete('/api/agent', (req, res) => {
    const name = ctx.safe(req.body.name), agent = ctx.readAgent(name);
    if (!agent) return res.status(404).json({ error: 'not found' });
    const nodes = [...ctx.allGroups(), ...ctx.allAgents(), ...ctx.allSystems()];
    let chats = []; try { chats = fs.readdirSync(ctx.instancesDir, { withFileTypes: true }).filter(x => x.isDirectory()).map(x => ctx.readChat(x.name)); } catch {}
    if ([...nodes, ...chats].some(n => n.parent === name)) return res.status(409).json({ error: '请先删除子节点' });
    try { fs.rmSync(ctx.agentDir(name), { recursive: true, force: true }); } catch {}
    res.json({ ok: true });
  });
  app.post('/api/agent/chat', (req, res) => {
    const parent = ctx.safe(req.body.parent), name = ctx.safe(req.body.name);
    if (!ctx.readAgent(parent)) return res.status(404).json({ error: 'agent not found' });
    if (!name) return res.status(400).json({ error: 'name required' });
    const dir = ctx.instanceDir(name);
    if (fs.existsSync(dir)) return res.status(409).json({ error: 'chat exists' });
    ensureInstance(dir);
    fs.writeFileSync(path.join(dir, 'instance.json'), JSON.stringify({ name, parent }, null, 2), 'utf-8');
    ctx.initializeChatWiki(dir, parent);
    res.json({ ok: true });
  });

  function runListeners() {
    for (const agent of ctx.allAgents()) {
      const file = path.join(ctx.agentDir(agent.name), 'listen.js');
      if (!fs.existsSync(file)) continue;
      try { require(file); } catch (e) { console.error(`[agent:${agent.name}] listen.js:`, e); }
    }
  }

  return { create, runListeners };
};
