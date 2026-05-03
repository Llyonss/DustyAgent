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
const { foldTasks } = require('../../../hooks/task-fold');

function resolveTools(builtins, instanceDir) {
  const configPath = path.join(instanceDir, 'tools.json');
  const toolsDir = path.join(instanceDir, 'tools');
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

function getBuiltins(instanceDir) {
  const mentalRoot = path.join(instanceDir, '..', '..');
  return [
    ...createMentalTools(instanceDir, mentalRoot),
    ...toolLoop, ...toolCmd, ...toolFile, ...toolMedia, ...eyeTools,
    taskTool,
  ];
}

function createAgent(instanceDir) {
  const log = createLog(instanceDir);
  const builtinTools = getBuiltins(instanceDir);

  return {
    system: createSystem(instanceDir),
    tools: () => resolveTools(builtinTools, instanceDir),
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
    createStop: () => () => {},
  };
}

module.exports = createAgent;
module.exports.getBuiltins = getBuiltins;
