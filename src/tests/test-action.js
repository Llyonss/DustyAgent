const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { run } = require('../core/action');
const { readEvents } = require('../core/event');

let tmpDir;
let eventsDir;
let ctrl;
let stopped;
let waitedMs;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dusty4-test-action-'));
  eventsDir = path.join(tmpDir, 'events');
  stopped = false;
  waitedMs = 0;
  ctrl = {
    stop: () => { stopped = true; },
    wait: (seconds) => { waitedMs = seconds * 1000; },
  };
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Helper: create an async generator from an array
async function* streamFrom(items) {
  for (const item of items) yield item;
}

describe('run', () => {
  it('handles text_block — writes speak event and returns output', async () => {
    const stream = streamFrom([
      { type: 'text_block', text: 'Hello world' },
      { type: 'usage', usage: { input_tokens: 10, output_tokens: 5 } },
    ]);

    const { output, usage } = await run(stream, eventsDir, ctrl, []);

    assert.strictEqual(output.length, 1);
    assert.deepStrictEqual(output[0], { type: 'text_block', text: 'Hello world' });
    assert.deepStrictEqual(usage, { input_tokens: 10, output_tokens: 5 });

    const events = readEvents(eventsDir);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'action');
    assert.strictEqual(events[0].tool, 'speak');
    assert.strictEqual(events[0].output, 'Hello world');
  });

  it('implicit stop when no tool calls', async () => {
    const stream = streamFrom([
      { type: 'text_block', text: 'just text' },
      { type: 'usage', usage: {} },
    ]);

    await run(stream, eventsDir, ctrl, []);
    assert.ok(stopped, 'ctrl.stop() should be called when no tool calls');
  });

  it('does not implicit stop when there are tool calls', async () => {
    const tools = [{
      name: 'echo',
      execute: async (input) => input.msg,
    }];
    const stream = streamFrom([
      { type: 'tool_call', id: 'tc_1', name: 'echo', input: { msg: 'hi' } },
      { type: 'usage', usage: {} },
    ]);

    await run(stream, eventsDir, ctrl, tools);
    assert.ok(!stopped, 'ctrl.stop() should NOT be called when there are tool calls');
  });

  it('executes tool and writes action event with input/output', async () => {
    const tools = [{
      name: 'greet',
      execute: async (input) => `Hello, ${input.name}!`,
    }];
    const stream = streamFrom([
      { type: 'tool_call', id: 'tc_1', name: 'greet', input: { name: 'Alice' } },
      { type: 'usage', usage: {} },
    ]);

    const { output } = await run(stream, eventsDir, ctrl, tools);

    assert.strictEqual(output.length, 1);
    assert.strictEqual(output[0].type, 'tool_use');
    assert.strictEqual(output[0].name, 'greet');
    assert.deepStrictEqual(output[0].input, { name: 'Alice' });

    const events = readEvents(eventsDir);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'action');
    assert.strictEqual(events[0].tool, 'greet');
    assert.strictEqual(events[0].output, 'Hello, Alice!');
    assert.deepStrictEqual(events[0].input, { name: 'Alice' });
    assert.strictEqual(events[0].toolUseId, 'tc_1');
  });

  it('returns "Unknown tool" for unregistered tool', async () => {
    const stream = streamFrom([
      { type: 'tool_call', id: 'tc_1', name: 'nonexistent', input: {} },
      { type: 'usage', usage: {} },
    ]);

    await run(stream, eventsDir, ctrl, []);

    const events = readEvents(eventsDir);
    assert.strictEqual(events[0].output, 'Unknown tool: nonexistent');
  });

  it('catches tool execution errors', async () => {
    const tools = [{
      name: 'fail',
      execute: async () => { throw new Error('boom'); },
    }];
    const stream = streamFrom([
      { type: 'tool_call', id: 'tc_1', name: 'fail', input: {} },
      { type: 'usage', usage: {} },
    ]);

    await run(stream, eventsDir, ctrl, tools);

    const events = readEvents(eventsDir);
    assert.strictEqual(events[0].output, 'Error: boom');
  });

  it('handles error event — writes error and stops', async () => {
    const stream = streamFrom([
      { type: 'error', message: 'API failed' },
    ]);

    await run(stream, eventsDir, ctrl, []);

    assert.ok(stopped);
    const events = readEvents(eventsDir);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'error');
    assert.strictEqual(events[0].message, 'API failed');
  });

  it('all events in same run share the same turn timestamp', async () => {
    const tools = [{
      name: 'noop',
      execute: async () => 'ok',
    }];
    const stream = streamFrom([
      { type: 'text_block', text: 'hi' },
      { type: 'tool_call', id: 'tc_1', name: 'noop', input: {} },
      { type: 'tool_call', id: 'tc_2', name: 'noop', input: {} },
      { type: 'usage', usage: {} },
    ]);

    await run(stream, eventsDir, ctrl, tools);

    const events = readEvents(eventsDir);
    assert.strictEqual(events.length, 3);
    const turns = events.map(e => e.turn);
    assert.ok(turns.every(t => t === turns[0]), 'All events should share same turn');
  });

  it('passes ctrl to tool execute — tool can stop the loop', async () => {
    const tools = [{
      name: 'stopper',
      execute: async (_input, c) => { c.stop(); return 'stopped'; },
    }];
    const stream = streamFrom([
      { type: 'tool_call', id: 'tc_1', name: 'stopper', input: {} },
      { type: 'usage', usage: {} },
    ]);

    await run(stream, eventsDir, ctrl, tools);
    assert.ok(stopped);
  });

  it('text + tool_call mixed — correct output order', async () => {
    const tools = [{
      name: 'echo',
      execute: async (input) => input.msg,
    }];
    const stream = streamFrom([
      { type: 'text_block', text: 'thinking' },
      { type: 'tool_call', id: 'tc_1', name: 'echo', input: { msg: 'hi' } },
      { type: 'text_block', text: 'more thoughts' },
      { type: 'usage', usage: {} },
    ]);

    const { output } = await run(stream, eventsDir, ctrl, tools);

    assert.strictEqual(output.length, 3);
    assert.strictEqual(output[0].type, 'text_block');
    assert.strictEqual(output[1].type, 'tool_use');
    assert.strictEqual(output[2].type, 'text_block');
  });

  it('signal abort during tool execution skips subsequent events', { timeout: 5000 }, async () => {
    const ac = new AbortController();
    const executed = [];

    const tools = [{
      name: 'slow',
      execute: async (input) => {
        executed.push(input.id);
        if (input.id === 'first') {
          // Simulate a slow tool; abort while it's running
          await new Promise(r => setTimeout(r, 100));
          ac.abort();
          await new Promise(r => setTimeout(r, 100));
        }
        return 'done';
      },
    }];

    const stream = streamFrom([
      { type: 'tool_call', id: 'tc_1', name: 'slow', input: { id: 'first' } },
      { type: 'tool_call', id: 'tc_2', name: 'slow', input: { id: 'second' } },
      { type: 'usage', usage: {} },
    ]);

    const { output } = await run(stream, eventsDir, ctrl, tools, ac.signal);

    // The first tool should have executed, the second should be skipped
    assert.ok(executed.includes('first'), 'First tool should have executed');
    assert.ok(!executed.includes('second'), 'Second tool should NOT have executed after abort');
    assert.strictEqual(output.length, 1, 'Only the first tool_use should be in output');
  });
});
