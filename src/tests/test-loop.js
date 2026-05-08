const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { writeEvent } = require('../core/event');

function tmpInstance() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-test-'));
  fs.mkdirSync(path.join(dir, 'events'), { recursive: true });
  return dir;
}

function mockInferModule(responses) {
  let callIndex = 0;
  return {
    infer: async function*(events, opts) {
      const response = responses[callIndex++] || responses[responses.length - 1];
      for (const evt of response) yield evt;
    },
  };
}

function setupLoop(responses) {
  const mock = mockInferModule(responses);
  const inferPath = require.resolve('../core/infer');
  require.cache[inferPath] = { id: inferPath, filename: inferPath, loaded: true, exports: mock };
  delete require.cache[require.resolve('../core/loop')];
  return require('../core/loop').loop;
}

function teardown() {
  delete require.cache[require.resolve('../core/infer')];
  delete require.cache[require.resolve('../core/loop')];
}

function speakDone(id, output) {
  return [
    { type: 'delta', start: true, id, tool: 'speak' },
    { type: 'delta', done: true, id, tool: 'speak', output },
  ];
}

function toolDone(id, name, input) {
  return [
    { type: 'delta', start: true, id, tool: name },
    { type: 'delta', done: true, id, tool: name, input },
  ];
}

function response(usage) {
  return { type: 'response', usage: usage || {} };
}

describe('loop', () => {
  it('text-only response causes implicit stop after one turn', async () => {
    const dir = tmpInstance();
    writeEvent(path.join(dir, 'events'), { type: 'user', content: 'hi' });
    const loop = setupLoop([[
      ...speakDone('s1', 'Hello'),
      response({ input_tokens: 10, output_tokens: 5 }),
    ]]);
    const turns = [];
    for await (const turn of loop({ instanceDir: dir, hooks: {} })) turns.push(turn);
    assert.strictEqual(turns.length, 1);
    teardown();
  });

  it('tool call keeps loop running, second text-only turn stops', async () => {
    const dir = tmpInstance();
    writeEvent(path.join(dir, 'events'), { type: 'user', content: 'do it' });
    const tools = [{ name: 'cmd', description: 'run', input_schema: { type: 'object' }, execute: async () => 'done' }];
    const loop = setupLoop([
      [...toolDone('t1', 'cmd', { command: 'ls' }), response({})],
      [...speakDone('s1', 'Done'), response({})],
    ]);
    const turns = [];
    for await (const turn of loop({ instanceDir: dir, hooks: { tools: () => tools } })) turns.push(turn);
    assert.strictEqual(turns.length, 2);
    teardown();
  });

  it('hooks.system is passed through', async () => {
    const dir = tmpInstance();
    writeEvent(path.join(dir, 'events'), { type: 'user', content: 'hi' });
    let capturedSystem;
    const mock = {
      infer: async function*(events, opts) {
        capturedSystem = opts.system;
        yield { type: 'delta', start: true, id: 's1', tool: 'speak' };
        yield { type: 'delta', done: true, id: 's1', tool: 'speak', output: 'ok' };
        yield { type: 'response', usage: {} };
      },
    };
    const inferPath = require.resolve('../core/infer');
    require.cache[inferPath] = { id: inferPath, filename: inferPath, loaded: true, exports: mock };
    delete require.cache[require.resolve('../core/loop')];
    const loop = require('../core/loop').loop;
    for await (const t of loop({ instanceDir: dir, hooks: { system: () => [{ type: 'text', text: 'Be helpful' }] } })) {}
    assert.ok(capturedSystem.some(b => b.text === 'Be helpful'));
    teardown();
  });

  it('hooks.events filters events', async () => {
    const dir = tmpInstance();
    const eventsDir = path.join(dir, 'events');
    writeEvent(eventsDir, { type: 'user', content: 'old' });
    writeEvent(eventsDir, { type: 'user', content: 'new' });
    let capturedEvents;
    const mock = {
      infer: async function*(events, opts) {
        capturedEvents = events;
        yield { type: 'delta', start: true, id: 's1', tool: 'speak' };
        yield { type: 'delta', done: true, id: 's1', tool: 'speak', output: 'ok' };
        yield { type: 'response', usage: {} };
      },
    };
    const inferPath = require.resolve('../core/infer');
    require.cache[inferPath] = { id: inferPath, filename: inferPath, loaded: true, exports: mock };
    delete require.cache[require.resolve('../core/loop')];
    const loop = require('../core/loop').loop;
    for await (const t of loop({ instanceDir: dir, hooks: { events: async (events) => events.slice(-1) } })) {}
    assert.strictEqual(capturedEvents.length, 1);
    assert.strictEqual(capturedEvents[0].content, 'new');
    teardown();
  });

  it('error in infer stops the loop', async () => {
    const dir = tmpInstance();
    writeEvent(path.join(dir, 'events'), { type: 'user', content: 'hi' });
    const loop = setupLoop([[
      { type: 'error', message: 'API is down' },
    ]]);
    const turns = [];
    for await (const turn of loop({ instanceDir: dir, hooks: {} })) turns.push(turn);
    assert.strictEqual(turns.length, 1);
    assert.ok(turns[0].response.errors.length > 0);
    teardown();
  });

  it('signal abort stops the loop', async () => {
    const dir = tmpInstance();
    writeEvent(path.join(dir, 'events'), { type: 'user', content: 'hi' });
    const ac = new AbortController();
    const loop = setupLoop([[
      ...speakDone('s1', 'ok'),
      response({}),
    ]]);
    ac.abort();
    const turns = [];
    for await (const turn of loop({ instanceDir: dir, signal: ac.signal, hooks: {} })) turns.push(turn);
    assert.strictEqual(turns.length, 0);
    teardown();
  });
});
