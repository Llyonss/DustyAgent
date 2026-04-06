require('dotenv').config({ path: require('path').join(__dirname, '../../../.env') });

const fs = require('fs');
const path = require('path');
const { readEvents, writeEvent } = require('../../core/event');
const { loop } = require('../../core/loop');
const toolLoop = require('../../hooks/tool-loop');
const toolCmd = require('../../hooks/tool-cmd');
const toolFile = require('../../hooks/tool-file');

const allTools = [...toolLoop, ...toolCmd, ...toolFile];
const stopTool = allTools.find(t => t.name === 'stop');
const readTool = allTools.find(t => t.name === 'read');
const writeTool = allTools.find(t => t.name === 'write');
const cmdTool = allTools.find(t => t.name === 'cmd');
const editTool = allTools.find(t => t.name === 'edit');

function plannerHooks(planPath) {
  const guardedWrite = {
    ...writeTool,
    description: 'Write the plan.json file. Only this file can be written.',
    execute: async (input, ctrl) => {
      if (path.resolve(input.path) !== path.resolve(planPath)) {
        return 'Error: You can only write to ' + planPath;
      }
      return writeTool.execute(input, ctrl);
    },
  };

  return {
    system: () => {
      const plan = fs.existsSync(planPath) ? fs.readFileSync(planPath, 'utf-8') : '[]';
      return [{ type: 'text', text: `You are a planning AI. Your job is to discuss requirements with the user and produce a Blueprint (plan.json).

A Blueprint is a JSON array. Each entry has:
- path: file path
- intent: what this file is and why it exists  
- materials: array of { type: "note", content } or { type: "file", path, note }

Current Blueprint:
${plan}

Rules:
- Read files to understand the project, but only write to the plan file.
- Output text to discuss with the user. Call 'stop' when waiting for input.`, cache_control: { type: 'ephemeral' } }];
    },
    tools: () => [readTool, guardedWrite, stopTool],
  };
}

function builderHooks(planPath, outputDir) {
  return {
    system: () => {
      const plan = JSON.parse(fs.readFileSync(planPath, 'utf-8'));
      const done = [];
      const todo = [];
      for (const entry of plan) {
        if (fs.existsSync(path.join(outputDir, entry.path))) {
          done.push(entry.path);
        } else {
          todo.push(entry.path);
        }
      }

      return [{ type: 'text', text: `You are a builder AI. You create project files according to a Blueprint.

Blueprint:
${JSON.stringify(plan, null, 2)}

Completed: ${done.length ? done.join(', ') : '(none)'}
Todo: ${todo.length ? todo.join(', ') : '(all done)'}
Output directory: ${outputDir}

Rules:
- Work through the todo list in order. For each file, read its materials, then write the file.
- Write files to the output directory (e.g. ${outputDir}/<path>).
- You can read any file, and use cmd if needed.
- When all files are done, call stop.`, cache_control: { type: 'ephemeral' } }];
    },
    tools: () => [readTool, writeTool, cmdTool, editTool, stopTool],
  };
}

async function main() {
  const [command, planPath, outputDir] = process.argv.slice(2);

  if (!command || !planPath) {
    console.error('Usage:\n  node index.js plan <plan.json>\n  node index.js build <plan.json> <output-dir>');
    process.exit(1);
  }

  const resolvedPlan = path.resolve(planPath);
  const instanceDir = path.join(__dirname, '../../../instances/blueprint-' + command);
  const eventsDir = path.join(instanceDir, 'events');
  fs.mkdirSync(eventsDir, { recursive: true });

  const createLog = require('../../hooks/output-log');
  const log = createLog(instanceDir);

  let hooks;
  if (command === 'plan') {
    hooks = plannerHooks(resolvedPlan);
  } else if (command === 'build') {
    if (!outputDir) { console.error('build requires output-dir'); process.exit(1); }
    hooks = builderHooks(resolvedPlan, path.resolve(outputDir));
    const events = readEvents(eventsDir);
    if (events.length === 0) {
      writeEvent(eventsDir, { type: 'user', content: 'Start building. Follow the Blueprint and create all todo files.' });
    }
  } else {
    console.error('Unknown command: ' + command);
    process.exit(1);
  }

  hooks.output = (turn) => log.output(turn);

  console.log(`\n[blueprint:${command}] Starting...\n`);
  for await (const turn of loop({ instanceDir, hooks })) {
    for (const block of turn.output) {
      if (block.type === 'text_block') process.stdout.write(block.text);
    }
  }

  console.log(`\n[blueprint:${command}] Done.`);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
