const fs = require('fs');
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
  const errors = [];
  let usage = null;
  let hasToolCalls = false;

  // Track active blocks: id → { file, raw, tool, isExec }
  const active = new Map();

  function isExecutable(toolName) {
    return tools.some(t => t.name === toolName);
  }

  for await (const evt of stream) {
    if (signal && signal.aborted) break;

    if (evt.type === 'delta') {
      let entry = active.get(evt.id);
      if (!entry) {
        const isExec = isExecutable(evt.tool);
        const result = writeEvent(eventsDir, {
          type: 'action', turn,
          tool: evt.tool, toolUseId: evt.id,
          input: isExec ? (evt.content || '') : {},
          output: isExec ? '' : (evt.content || ''),
        });
        entry = { file: result.file, raw: evt.content || '', tool: evt.tool, isExec };
        active.set(evt.id, entry);
      } else {
        entry.raw += evt.content || '';
        const event = JSON.parse(fs.readFileSync(entry.file, 'utf-8'));
        if (entry.isExec) {
          event.input = entry.raw;
        } else {
          event.output = entry.raw;
        }
        fs.writeFileSync(entry.file, JSON.stringify(event, null, 2));
      }

    } else if (evt.type === 'action') {
      const entry = active.get(evt.id);
      const file = entry ? entry.file : null;

      if (isExecutable(evt.tool)) {
        hasToolCalls = true;

        // Update with parsed input
        if (file) {
          const event = JSON.parse(fs.readFileSync(file, 'utf-8'));
          event.input = evt.input;
          fs.writeFileSync(file, JSON.stringify(event, null, 2));
        }

        // Execute tool
        const result = await executeTool(evt.tool, evt.input, ctrl, tools, eventsDir);
        output.push({ type: 'tool_use', id: evt.id, name: evt.tool, input: evt.input });

        if (file) {
          const event = JSON.parse(fs.readFileSync(file, 'utf-8'));
          event.output = result.output;
          if (result.error) event.error = true;
          fs.writeFileSync(file, JSON.stringify(event, null, 2));
        } else {
          writeEvent(eventsDir, {
            type: 'action', turn,
            tool: evt.tool, toolUseId: evt.id,
            input: evt.input, output: result.output,
            ...(result.error ? { error: true } : {}),
          });
        }
      } else {
        // speak / thinking / other non-executable — just finalize
        if (file) {
          const event = JSON.parse(fs.readFileSync(file, 'utf-8'));
          event.output = evt.output != null ? evt.output : (entry ? entry.raw : '');
          fs.writeFileSync(file, JSON.stringify(event, null, 2));
        } else if (evt.output) {
          writeEvent(eventsDir, {
            type: 'action', turn,
            tool: evt.tool, toolUseId: evt.id,
            input: {}, output: evt.output,
          });
        }
        if (evt.tool === 'speak') {
          output.push({ type: 'text_block', text: evt.output });
        }
      }

      active.delete(evt.id);

    } else if (evt.type === 'usage') {
      usage = evt.usage;
    } else if (evt.type === 'error') {
      errors.push(evt.message);
      console.error('Error:', evt.message);
      writeEvent(eventsDir, { type: 'error', message: evt.message });
      ctrl.stop();
    }
  }

  if (!hasToolCalls) {
    if (output.length === 0 && usage) {
      const msg = 'Empty response from API';
      errors.push(msg);
      console.error('Error:', msg);
      writeEvent(eventsDir, { type: 'error', message: msg });
    }
    ctrl.stop();
  }

  return { output, usage, errors };
}

module.exports = { run };
