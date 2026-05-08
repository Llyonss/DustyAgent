const { writeEvent, beginAction, appendAction, finishAction } = require('./event');

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

async function run(stream, eventsDir, ctrl, tools, signal, turnId) {
  const turn = turnId || Date.now();
  const output = [];
  const errors = [];
  let response = null;
  let hasToolCalls = false;
  const active = new Map();

  function executable(name) { return tools.some(t => t.name === name); }

  for await (const evt of stream) {
    if (signal?.aborted) break;

    // ═══ δ(start) ═══
    if (evt.type === 'delta' && evt.start) {
      const isExec = executable(evt.tool);
      const handle = beginAction(eventsDir, { turn, tool: evt.tool, toolUseId: evt.id, toInput: isExec });
      active.set(evt.id, handle);
      continue;
    }

    // ═══ δ(done) ═══
    if (evt.type === 'delta' && evt.done) {
      const handle = active.get(evt.id);

      if (executable(evt.tool)) {
        hasToolCalls = true;
        finishAction(handle, { input: evt.input });
        const result = await executeTool(evt.tool, evt.input, ctrl, tools, eventsDir);
        finishAction(handle, { output: result.output, error: result.error || undefined });
        output.push({ type: 'tool_use', id: evt.id, name: evt.tool, input: evt.input });
      } else {
        finishAction(handle, { output: evt.output != null ? evt.output : handle.raw });
        if (evt.tool === 'speak') output.push({ type: 'text_block', text: evt.output });
      }
      active.delete(evt.id);
      continue;
    }

    // ═══ δ(增量) ═══
    if (evt.type === 'delta') {
      const handle = active.get(evt.id);
      if (!handle) continue;
      appendAction(handle, evt.content);
      continue;
    }

    // ═══ request ═══
    if (evt.type === 'request') {
      continue;
    }

    // ═══ response ═══
    if (evt.type === 'response') {
      response = evt;
      continue;
    }

    // ═══ error ═══
    if (evt.type === 'error') {
      errors.push(evt.message);
      console.error('Error:', evt.message);
      writeEvent(eventsDir, { type: 'error', message: evt.message });
      ctrl.stop();
      continue;
    }
  }

  if (!hasToolCalls) {
    if (output.length === 0 && response?.usage) {
      const msg = 'Empty response from API';
      errors.push(msg);
      console.error('Error:', msg);
      writeEvent(eventsDir, { type: 'error', message: msg });
    }
    ctrl.stop();
  }

  return { output, response, errors };
}

module.exports = { run };
