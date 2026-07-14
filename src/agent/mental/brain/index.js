const path = require('path');
const fs = require('fs');
const createSystem = require('./system');
const createMentalTools = require('./tools');
// context.js kept for tryRead/parseFrontMatter utilities

const toolLoop = require('../../../hooks/tool-loop');
const toolCmd = require('../../../hooks/tool-cmd');
const toolFile = require('../../../hooks/tool-file');
const toolMedia = require('../../../hooks/tool-media');
const { tools: eyeTools, injectEyeEvents } = require('../../../hooks/tool-eye');
const createLog = require('../../../hooks/output-log');
const taskTool = require('../../../hooks/tool-task');
const createSkillTool = require('../../../hooks/tool-skill');
const { foldTasks } = require('../../../hooks/task-fold');

function tryRead(p) {
  try { return fs.readFileSync(p, 'utf-8'); } catch { return null; }
}

function resolveTools(builtins, instanceDir, configDir = instanceDir) {
  const configPath = path.join(configDir, 'tools.json');
  const toolsDir = path.join(configDir, 'tools');
  let config = {};
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch {}
  const disabled = new Set(config.disabled || []);
  const overrides = config.overrides || {};
  const result = new Map();
  for (const t of builtins) result.set(t.name, { ...t });
  try {
    for (const f of fs.readdirSync(toolsDir).filter(f => f.endsWith('.js'))) {
      try {
        const fullPath = path.join(toolsDir, f);
        delete require.cache[require.resolve(fullPath)];
        const tool = require(fullPath);
        if (tool.name) result.set(tool.name, tool);
      } catch {}
    }
  } catch {}
  for (const [name, ov] of Object.entries(overrides)) {
    const t = result.get(name);
    if (!t) continue;
    if (ov.description != null) t.description = ov.description;
    if (ov.input_schema != null) t.input_schema = ov.input_schema;
  }
  for (const name of disabled) result.delete(name);
  return [...result.values()];
}

// —— 分组上下文工具（context）——
// contextInfo: { groupsDir, groupName, chain: [{ name, file, wiki }] }（chain 根在前本组在后）
// groupName 可能为 null（普通实例仍可用 list / name 访问任意分组）
function parseGroupMeta(raw, fallbackName) {
  const meta = { name: fallbackName, parent: '', wiki: '' };
  if (raw == null) return null;
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (m) {
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^(\w+)\s*:\s*(.*)$/);
      if (!kv) continue;
      const [, k, v] = kv;
      if (k === 'name') meta.name = v.trim();
      else if (k === 'parent') meta.parent = v.trim();

    }
    meta.wiki = m[2];
  } else meta.wiki = raw;
  return meta;
}
function createContextTool(groupsDir, currentGroup, chain, agentsDir) {
  const sanitize = (s) => (s || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
  const gFile = (n) => path.join(groupsDir, sanitize(n) + '.md');
  const aDir = (n) => path.join(agentsDir, sanitize(n));
  const readG = (n) => {
    const name = sanitize(n), group = parseGroupMeta(tryRead(gFile(name)), name);
    if (group) return { ...group, type: 'group' };
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(aDir(name), 'agent.json'), 'utf-8'));
      return { name, parent: meta.parent || '', wiki: tryRead(path.join(aDir(name), 'wiki.md')) || '', type: 'agent' };
    } catch { return null; }
  };
  const writeG = (g) => {
    if (g.type === 'agent') { fs.writeFileSync(path.join(aDir(g.name), 'wiki.md'), g.wiki || '', 'utf-8'); return; }
    fs.mkdirSync(groupsDir, { recursive: true });
    fs.writeFileSync(gFile(g.name), `---\nname: ${g.name}\nparent: ${g.parent || ''}\n---\n${g.wiki || ''}`, 'utf-8');
  };
  return {
    name: 'context',
    description: `上下文工具——读写分组 wiki（本次工作的活文档与继承的长期知识）。

分组构成一棵树，每个分组一份 wiki。本对话所属分组的 wiki 是活文档；沿父链继承的上层 wiki 是长期知识。
把结论、进展、决策写回 wiki，下次对话开局会自动读到整条链路。

list=true — 树形列出所有分组。
（不传参）— 读取当前分组 wiki。
chain=true — 读取当前链路所有分组 wiki（根→本组）。
name="分组名" — 读/写指定分组 wiki。
set="内容" — 整体重写；select="旧段"+set="新段" — 局部替换。默认操作当前分组，可配 name 指定。`,
    input_schema: {
      type: 'object',
      properties: {
        list: { type: 'boolean', description: '树形列出所有分组' },
        chain: { type: 'boolean', description: '读取当前链路所有分组 wiki' },
        name: { type: 'string', description: '分组名。不传=当前分组' },
        set: { type: 'string', description: '写入内容（整体重写）' },
        select: { type: 'string', description: '圈定旧文本（配合 set 局部替换）' },
      },
    },
    execute: async (input) => {
      // —— list：拼树 ——
      if (input.list) {
        let files = [], agentNames = [];
        try { files = fs.readdirSync(groupsDir).filter(f => f.endsWith('.md')); } catch {}
        try { agentNames = fs.readdirSync(agentsDir, { withFileTypes: true }).filter(x => x.isDirectory()).map(x => x.name); } catch {}
        const groups = [
          ...files.map(f => readG(f.replace(/\.md$/, ''))),
          ...agentNames.map(readG),
        ].filter(Boolean);
        if (!groups.length) return '(无上下文节点)';
        const byParent = {};
        for (const g of groups) (byParent[g.parent || ''] = byParent[g.parent || []] || []).push(g);
        for (const k in byParent) byParent[k].sort((a, b) => a.name.localeCompare(b.name));
        const lines = [];
        const walk = (parent, depth) => {
          for (const g of (byParent[parent] || [])) {
            lines.push('  '.repeat(depth) + (g.type === 'agent' ? '🤖 ' : '📁 ') + g.name);
            walk(g.name, depth + 1);
          }
        };
        walk('', 0);
        return lines.join('\n');
      }
      // —— chain：整条链路 ——
      if (input.chain) {
        if (!chain || !chain.length) return '(当前对话不属于任何分组)';
        return chain.map(c => `# [${c.name}]\n${(readG(c.name)?.wiki || '').trim() || '(空)'}`).join('\n\n');
      }
      // —— 确定目标分组 ——
      const target = input.name || currentGroup;
      if (!target) return '错误：未指定分组，且当前对话不属于任何分组。';
      const g = readG(target);
      if (!g) return `错误：分组「${target}」不存在。`;
      // —— 写入 ——
      if (input.set != null && input.select) {
        const raw = g.wiki || '';
        if (!raw.includes(input.select)) return '错误：未找到指定文本。';
        if (raw.split(input.select).length - 1 > 1) return '错误：匹配到多处，请提供更多上下文。';
        g.wiki = raw.replace(input.select, input.set);
        writeG(g);
        return 'ok';
      }
      if (input.set != null) { g.wiki = input.set; writeG(g); return 'ok'; }
      // —— 读取 ——
      return g.wiki && g.wiki.trim() ? g.wiki : `(分组「${target}」wiki 为空)`;
    },
  };
}

function getBuiltins(instanceDir, hooks, mentalRoot, contextInfo) {
  // 旧实例：instances/<name> → 往上两级是 mentalRoot。
  mentalRoot = mentalRoot || path.join(instanceDir, '..', '..');
  const groupsDir = (contextInfo && contextInfo.groupsDir) || path.join(mentalRoot, 'groups');
  const agentsDir = path.join(mentalRoot, 'agents');
  const tools = [
    ...createMentalTools(instanceDir, mentalRoot, hooks),
    ...toolLoop, ...toolCmd, ...toolFile, ...toolMedia, ...eyeTools,
    taskTool,
    createSkillTool(mentalRoot),
    // context 工具始终可用；有 contextInfo 时锚定当前分组
    createContextTool(groupsDir, contextInfo ? contextInfo.groupName : null, contextInfo ? contextInfo.chain : null, agentsDir),
  ];
  return tools;
}

// createAgent(instanceDir, opts)
// configDir 可与 instanceDir 分离：Agent 配置共享，对话事件独立。
function createAgent(instanceDir, opts = {}) {
  const { hooks, mentalRoot, extraEnv, contextInfo } = opts;
  const configDir = opts.configDir || instanceDir;
  const log = createLog(instanceDir);
  const builtinTools = getBuiltins(instanceDir, hooks, mentalRoot, contextInfo);

  return {
    system: createSystem(configDir, extraEnv, instanceDir),
    model: () => { try { return JSON.parse(fs.readFileSync(path.join(configDir, 'model.json'), 'utf-8')); } catch { return {}; } },
    tools: () => resolveTools(builtinTools, instanceDir, configDir),
    events: async (events) => {
      let last = -1;
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].type === 'action' && events[i].tool === 'commit' && !events[i].error) { last = i; break; }
      }
      const filtered = last >= 0 ? events.slice(last + 1) : events;
      const folded = foldTasks(filtered);
      return injectEyeEvents(folded);
    },
    output: (turn) => log.output(turn),
    stop: (restart) => {},
  };
}

module.exports = createAgent;
module.exports.getBuiltins = getBuiltins;
