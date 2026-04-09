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

  // Track streaming speak event
  let speakFile = null;
  let speakText = '';

  // Track active tool blocks: id -> { file, inputRaw }
  const activeTools = new Map();

  for await (const evt of stream) {
    if (signal && signal.aborted) break;

    if (evt.type === 'text_delta') {
      speakText += evt.text;
      if (!speakFile) {
        // Create the speak event file
        const result = writeEvent(eventsDir, {
          type: 'action', turn,
          tool: 'speak', toolUseId: 'text_' + Date.now(),
          input: {}, output: speakText,
        });
        speakFile = result.file;
      } else {
        // Update existing speak event file in-place
        const event = JSON.parse(fs.readFileSync(speakFile, 'utf-8'));
        event.output = speakText;
        fs.writeFileSync(speakFile, JSON.stringify(event, null, 2));
      }
    } else if (evt.type === 'text_block') {
      // Final text — ensure the speak event has the complete text
      if (speakFile) {
        const event = JSON.parse(fs.readFileSync(speakFile, 'utf-8'));
        event.output = evt.text;
        fs.writeFileSync(speakFile, JSON.stringify(event, null, 2));
      } else if (evt.text) {
        writeEvent(eventsDir, {
          type: 'action', turn,
          tool: 'speak', toolUseId: 'text_' + Date.now(),
          input: {}, output: evt.text,
        });
      }
      output.push(evt);
      // Reset for next text block
      speakFile = null;
      speakText = '';
    } else if (evt.type === 'tool_start') {
      hasToolCalls = true;
      // Create event file immediately with empty input/output
      const result = writeEvent(eventsDir, {
        type: 'action', turn,
        tool: evt.name, toolUseId: evt.id,
        input: '', output: '',
      });
      activeTools.set(evt.id, { file: result.file, inputRaw: '' });
    } else if (evt.type === 'tool_delta') {
      // Find the active tool by scanning activeTools (latest one)
      const last = [...activeTools.values()].pop();
      if (last) {
        last.inputRaw += evt.partial_json;
        // Update event file in-place with raw input
        const event = JSON.parse(fs.readFileSync(last.file, 'utf-8'));
        event.input = last.inputRaw;
        fs.writeFileSync(last.file, JSON.stringify(event, null, 2));
      }
    } else if (evt.type === 'tool_call') {
      hasToolCalls = true;
      const active = activeTools.get(evt.id);
      const file = active ? active.file : null;

      // Update event file with parsed input before execution
      if (file) {
        const event = JSON.parse(fs.readFileSync(file, 'utf-8'));
        event.input = evt.input;
        fs.writeFileSync(file, JSON.stringify(event, null, 2));
      }

      const result = await executeTool(evt.name, evt.input, ctrl, tools, eventsDir);
      output.push({ type: 'tool_use', id: evt.id, name: evt.name, input: evt.input });

      // Update event file with output (or write new one if no file tracked)
      if (file) {
        const event = JSON.parse(fs.readFileSync(file, 'utf-8'));
        event.output = result.output;
        if (result.error) event.error = true;
        fs.writeFileSync(file, JSON.stringify(event, null, 2));
      } else {
        writeEvent(eventsDir, {
          type: 'action', turn,
          tool: evt.name, toolUseId: evt.id,
          input: evt.input, output: result.output,
          ...(result.error ? { error: true } : {}),
        });
      }

      activeTools.delete(evt.id);
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
