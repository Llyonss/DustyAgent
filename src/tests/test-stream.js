const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { run } = require('../core/action');
const { readEvents } = require('../core/event');

function tmpDir() {
  const dir = path.join(os.tmpdir(), 'dusty4-stream-' + Date.now());
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Simulate a streaming infer generator that yields text_delta then text_block
async function* fakeStream(chunks, delayMs = 50) {
  for (const chunk of chunks) {
    yield chunk;
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
  }
  yield { type: 'usage', usage: { input_tokens: 10, output_tokens: 5 } };
}

test('streaming speak: intermediate reads see partial text', async () => {
  const dir = tmpDir();
  let running = true;
  const ctrl = { stop: () => { running = false; }, events: [] };

  const chunks = [
    { type: 'text_delta', text: 'Hello ' },
    { type: 'text_delta', text: 'world ' },
    { type: 'text_delta', text: '!' },
    { type: 'text_block', text: 'Hello world !' },
  ];

  // Collect intermediate snapshots while action.run processes stream
  const snapshots = [];
  const pollInterval = setInterval(() => {
    const events = readEvents(dir);
    const speaks = events.filter(e => e.tool === 'speak');
    if (speaks.length > 0) {
      const output = speaks[0].output;
      // Only record if different from last snapshot
      if (snapshots.length === 0 || snapshots[snapshots.length - 1] !== output) {
        snapshots.push(output);
      }
    }
  }, 10); // poll every 10ms to catch changes

  await run(fakeStream(chunks, 50), dir, ctrl, [], null);
  // Wait a bit for final poll
  await new Promise(r => setTimeout(r, 30));
  clearInterval(pollInterval);

  console.log('Snapshots captured:', snapshots);

  // Should have at least 2 different snapshots (partial + final)
  assert.ok(snapshots.length >= 2, 
    `Expected at least 2 snapshots but got ${snapshots.length}: ${JSON.stringify(snapshots)}`);
  
  // Final snapshot should be the complete text
  assert.strictEqual(snapshots[snapshots.length - 1], 'Hello world !');

  fs.rmSync(dir, { recursive: true });
});

test('streaming tool: intermediate reads see input being built', async () => {
  const dir = tmpDir();
  let running = true;
  const ctrl = { stop: () => { running = false; }, events: [] };

  const chunks = [
    { type: 'tool_start', id: 'tool_1', name: 'cmd' },
    { type: 'tool_delta', partial_json: '{"com' },
    { type: 'tool_delta', partial_json: 'mand":' },
    { type: 'tool_delta', partial_json: '"echo hi"}' },
    { type: 'tool_call', id: 'tool_1', name: 'cmd', input: { command: 'echo hi' } },
  ];

  const tools = [{
    name: 'cmd',
    execute: async () => 'hi',
  }];

  const snapshots = [];
  const pollInterval = setInterval(() => {
    const events = readEvents(dir);
    const toolEvts = events.filter(e => e.tool === 'cmd');
    if (toolEvts.length > 0) {
      const snap = { input: toolEvts[0].input, output: toolEvts[0].output };
      const key = JSON.stringify(snap);
      if (snapshots.length === 0 || JSON.stringify(snapshots[snapshots.length - 1]) !== key) {
        snapshots.push(snap);
      }
    }
  }, 10);

  await run(fakeStream(chunks, 50), dir, ctrl, tools, null);
  await new Promise(r => setTimeout(r, 30));
  clearInterval(pollInterval);

  console.log('Tool snapshots:', JSON.stringify(snapshots));

  // Should see at least: empty input → partial input → final with output
  assert.ok(snapshots.length >= 2,
    `Expected at least 2 tool snapshots but got ${snapshots.length}: ${JSON.stringify(snapshots)}`);

  // Final should have parsed input and output
  const last = snapshots[snapshots.length - 1];
  assert.deepStrictEqual(last.input, { command: 'echo hi' });
  assert.strictEqual(last.output, 'hi');

  fs.rmSync(dir, { recursive: true });
});
