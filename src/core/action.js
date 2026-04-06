const { writeEvent } = require('./event');

async function executeTool(name, input, ctrl, tools, eventsDir) {
  const tool = tools.find(t => t.name === name);
  if (!tool) return { output: 'Unknown tool: ' + name, error: true };
  try {
    const output = await tool.execute(input, ctrl, eventsDir);
    return { output, error: false };
  } catch (e) {
    return { output: 'Error: ' + e.message, error: true };
  }
}

async function run(stream, eventsDir, ctrl, tools, signal) {
  const turn = Date.now();
  const output = [];
  let usage = null;
  let hasToolCalls = false;

  for await (const evt of stream) {
    if (signal && signal.aborted) break;
    if (evt.type === 'text_block') {
      output.push(evt);
      writeEvent(eventsDir, {
        type: 'action', turn,
        tool: 'speak', toolUseId: 'text_' + Date.now(),
        input: {}, output: evt.text,
      });
    } else if (evt.type === 'tool_call') {
      hasToolCalls = true;
      const result = await executeTool(evt.name, evt.input, ctrl, tools, eventsDir);
      output.push({ type: 'tool_use', id: evt.id, name: evt.name, input: evt.input });
      writeEvent(eventsDir, {
        type: 'action', turn,
        tool: evt.name, toolUseId: evt.id,
        input: evt.input, output: result.output,
        ...(result.error ? { error: true } : {}),
      });
    } else if (evt.type === 'usage') {
      usage = evt.usage;
    } else if (evt.type === 'error') {
      writeEvent(eventsDir, { type: 'error', message: evt.message });
      ctrl.stop();
    }
  }

  if (!hasToolCalls) {
    if (output.length === 0 && usage) {
      writeEvent(eventsDir, { type: 'error', message: 'Empty response from API' });
    }
    ctrl.stop();
  }

  return { output, usage };
}

module.exports = { run };
