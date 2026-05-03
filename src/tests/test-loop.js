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

// Mock infer: yields predefined events per call
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
  // Inject mock into require cache
  const inferPath = require.resolve('../core/infer');
  require.cache[inferPath] = { id: inferPath, filename: inferPath, loaded: true, exports: mock };
  delete require.cache[require.resolve('../core/loop')];
  return require('../core/loop').loop;
}

function teardown() {
  delete require.cache[require.resolve('../core/infer')];
  delete require.cache[require.resolve('../core/loop')];
}

describe('loop', () => {
  it('text-only response causes implicit stop after one turn', async () => {
    const dir = tmpInstance();
    writeEvent(path.join(dir, 'events'), { type: 'user', content: 'hi' });
    const loop = setupLoop([[
      { type: 'action', id: 's1', tool: 'speak', output: 'Hello' },
      { type: 'usage', usage: { input_tokens: 10, output_tokens: 5 } },
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
      [{ type: 'action', id: 't1', tool: 'cmd', input: { command: 'ls' } }, { type: 'usage', usage: {} }],
      [{ type: 'action', id: 's1', tool: 'speak', output: 'Done' }, { type: 'usage', usage: {} }],
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
        yield { type: 'action', id: 's1', tool: 'speak', output: 'ok' };
        yield { type: 'usage', usage: {} };
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
        yield { type: 'action', id: 's1', tool: 'speak', output: 'ok' };
        yield { type: 'usage', usage: {} };
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
    assert.ok(turns[0].errors.length > 0);
    teardown();
  });

  it('signal abort stops the loop', async () => {
    const dir = tmpInstance();
    writeEvent(path.join(dir, 'events'), { type: 'user', content: 'hi' });
    const ac = new AbortController();
    const loop = setupLoop([[
      { type: 'action', id: 's1', tool: 'speak', output: 'ok' },
      { type: 'usage', usage: {} },
    ]]);
    ac.abort();
    const turns = [];
    for await (const turn of loop({ instanceDir: dir, signal: ac.signal, hooks: {} })) turns.push(turn);
    assert.strictEqual(turns.length, 0);
    teardown();
  });
});
