const { getToolMap } = require('./tool');
const { writeEvent } = require('./event');

async function executeTool(name, input, ctrl) {
  const tool = getToolMap()[name];
  if (!tool) return 'Unknown tool: ' + name;
  try {
    return await tool.execute(input, ctrl);
  } catch (e) {
    return 'Error: ' + e.message;
  }
}

async function run(stream, eventsDir, ctrl) {
  const turn = Date.now();
  const output = [];
  let usage = null;
  let hasToolCalls = false;

  for await (const evt of stream) {
    if (evt.type === 'text_block') {
      output.push(evt);
      writeEvent(eventsDir, {
        type: 'action', turn,
        tool: 'speak', toolUseId: 'text_' + Date.now(),
        input: {}, output: evt.text,
      });
    } else if (evt.type === 'tool_call') {
      hasToolCalls = true;
      const result = await executeTool(evt.name, evt.input, ctrl);
      output.push({ type: 'tool_use', id: evt.id, name: evt.name, input: evt.input });
      writeEvent(eventsDir, {
        type: 'action', turn,
        tool: evt.name, toolUseId: evt.id,
        input: evt.input, output: result,
      });
    } else if (evt.type === 'usage') {
      usage = evt.usage;
    }
  }

  if (!hasToolCalls) {
    ctrl.stop();
  }

  return { output, usage };
}

module.exports = { run };
