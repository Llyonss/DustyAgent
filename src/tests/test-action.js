const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { run } = require('../core/action');
const { readEvents } = require('../core/event');

function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'action-test-'));
  fs.mkdirSync(path.join(dir, 'events'));
  return dir;
}

async function* gen(events) { for (const e of events) yield e; }

const noopCtrl = { stop: () => {}, wait: () => {}, signal: undefined };

describe('run', () => {
  it('handles speak block — writes speak event and returns output', async () => {
    const dir = tmpDir();
    const { output } = await run(gen([
      { type: 'delta', start: true, id: 's1', tool: 'speak' },
      { type: 'delta', id: 's1', tool: 'speak', content: 'Hello ' },
      { type: 'delta', id: 's1', tool: 'speak', content: 'world' },
      { type: 'delta', done: true, id: 's1', tool: 'speak', output: 'Hello world' },
      { type: 'response', usage: { input_tokens: 10, output_tokens: 5 } },
    ]), path.join(dir, 'events'), { ...noopCtrl }, [], undefined);
    assert.strictEqual(output.length, 1);
    assert.strictEqual(output[0].type, 'text_block');
    assert.strictEqual(output[0].text, 'Hello world');
    const events = readEvents(dir);
    const speak = events.find(e => e.tool === 'speak');
    assert.ok(speak);
    assert.strictEqual(speak.output, 'Hello world');
  });

  it('implicit stop when no tool calls', async () => {
    const dir = tmpDir();
    let stopped = false;
    const ctrl = { ...noopCtrl, stop: () => { stopped = true; } };
    await run(gen([
      { type: 'delta', start: true, id: 's1', tool: 'speak' },
      { type: 'delta', done: true, id: 's1', tool: 'speak', output: 'Hi' },
      { type: 'response', usage: {} },
    ]), path.join(dir, 'events'), ctrl, [], undefined);
    assert.ok(stopped);
  });

  it('does not implicit stop when there are tool calls', async () => {
    const dir = tmpDir();
    let stopped = false;
    const ctrl = { ...noopCtrl, stop: () => { stopped = true; } };
    const tools = [{ name: 'cmd', execute: async () => 'ok' }];
    await run(gen([
      { type: 'delta', start: true, id: 't1', tool: 'cmd' },
      { type: 'delta', done: true, id: 't1', tool: 'cmd', input: { command: 'ls' } },
      { type: 'response', usage: {} },
    ]), path.join(dir, 'events'), ctrl, tools, undefined);
    assert.ok(!stopped);
  });

  it('executes tool and writes action event', async () => {
    const dir = tmpDir();
    const tools = [{ name: 'cmd', execute: async (input) => 'result: ' + input.command }];
    const { output } = await run(gen([
      { type: 'delta', start: true, id: 't1', tool: 'cmd' },
      { type: 'delta', id: 't1', tool: 'cmd', content: '{"command":"ls"}' },
      { type: 'delta', done: true, id: 't1', tool: 'cmd', input: { command: 'ls' } },
      { type: 'response', usage: {} },
    ]), path.join(dir, 'events'), { ...noopCtrl }, tools, undefined);
    assert.strictEqual(output[0].type, 'tool_use');
    assert.strictEqual(output[0].name, 'cmd');
    const events = readEvents(dir);
    const action = events.find(e => e.tool === 'cmd');
    assert.ok(action);
    assert.deepStrictEqual(action.input, { command: 'ls' });
    assert.strictEqual(action.output, 'result: ls');
  });

  it('catches tool execution errors', async () => {
    const dir = tmpDir();
    const tools = [{ name: 'cmd', execute: async () => { throw new Error('fail'); } }];
    await run(gen([
      { type: 'delta', start: true, id: 't1', tool: 'cmd' },
      { type: 'delta', done: true, id: 't1', tool: 'cmd', input: {} },
      { type: 'response', usage: {} },
    ]), path.join(dir, 'events'), { ...noopCtrl }, tools, undefined);
    const events = readEvents(dir);
    const action = events.find(e => e.tool === 'cmd');
    assert.ok(action.error);
    assert.ok(action.output.includes('fail'));
  });

  it('handles error event — writes error and stops', async () => {
    const dir = tmpDir();
    let stopped = false;
    const ctrl = { ...noopCtrl, stop: () => { stopped = true; } };
    const { errors } = await run(gen([
      { type: 'error', message: 'API failed' },
    ]), path.join(dir, 'events'), ctrl, [], undefined);
    assert.ok(stopped);
    assert.strictEqual(errors.length, 1);
    const events = readEvents(dir);
    assert.ok(events.some(e => e.type === 'error'));
  });

  it('thinking block is persisted without execution', async () => {
    const dir = tmpDir();
    await run(gen([
      { type: 'delta', start: true, id: 'th1', tool: 'thinking' },
      { type: 'delta', id: 'th1', tool: 'thinking', content: 'hmm' },
      { type: 'delta', done: true, id: 'th1', tool: 'thinking', output: 'hmm let me think' },
      { type: 'delta', start: true, id: 's1', tool: 'speak' },
      { type: 'delta', done: true, id: 's1', tool: 'speak', output: 'Hello' },
      { type: 'response', usage: {} },
    ]), path.join(dir, 'events'), { ...noopCtrl }, [], undefined);
    const events = readEvents(dir);
    const thinking = events.find(e => e.tool === 'thinking');
    assert.ok(thinking);
    assert.strictEqual(thinking.output, 'hmm let me think');
  });

  it('empty response writes error event', async () => {
    const dir = tmpDir();
    let stopped = false;
    const ctrl = { ...noopCtrl, stop: () => { stopped = true; } };
    const { errors } = await run(gen([
      { type: 'response', usage: { input_tokens: 100, output_tokens: 1 } },
    ]), path.join(dir, 'events'), ctrl, [], undefined);
    assert.ok(stopped);
    assert.ok(errors.length > 0);
  });
});
