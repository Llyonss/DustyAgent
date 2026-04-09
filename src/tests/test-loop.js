const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { writeEvent, readEvents } = require('../core/event');

// We mock infer at the module level by replacing the require cache
// so loop.js picks up our mock instead of the real one.

let tmpDir;
let instanceDir;
let eventsDir;

// Mock infer responses queue — each call to infer() pops the next one
let inferQueue = [];

// Replace infer module with mock
const inferModulePath = require.resolve('../core/infer');

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dusty4-test-loop-'));
  instanceDir = tmpDir;
  eventsDir = path.join(instanceDir, 'events');
  fs.mkdirSync(eventsDir, { recursive: true });
  inferQueue = [];

  // Install mock infer
  require.cache[inferModulePath] = {
    id: inferModulePath,
    filename: inferModulePath,
    loaded: true,
    exports: {
      infer: async function* (_prompt, _opts) {
        const response = inferQueue.shift();
        if (!response) {
          yield { type: 'error', message: 'No mock response in queue' };
          return;
        }
        for (const item of response) {
          yield item;
        }
      },
    },
  };

  // Clear loop module cache so it picks up the mocked infer
  delete require.cache[require.resolve('../core/loop')];
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  // Restore
  delete require.cache[inferModulePath];
  delete require.cache[require.resolve('../core/loop')];
});

function getLoop() {
  return require('../core/loop').loop;
}

// Collect all turns from the loop generator
async function collectTurns(gen) {
  const turns = [];
  for await (const turn of gen) turns.push(turn);
  return turns;
}

describe('loop', () => {
  it('text-only response causes implicit stop after one turn', async () => {
    writeEvent(eventsDir, { type: 'user', content: 'hello' });

    inferQueue.push([
      { type: 'text_block', text: 'Hi there!' },
      { type: 'usage', usage: { input_tokens: 10, output_tokens: 5 } },
    ]);

    const loop = getLoop();
    const turns = await collectTurns(loop({ instanceDir }));

    assert.strictEqual(turns.length, 1);
    assert.strictEqual(turns[0].output.length, 1);
    assert.strictEqual(turns[0].output[0].text, 'Hi there!');
    assert.ok(turns[0].duration >= 0);
  });

  it('tool call keeps loop running, second text-only turn stops', async () => {
    writeEvent(eventsDir, { type: 'user', content: 'list files' });

    // Turn 1: tool call
    inferQueue.push([
      { type: 'tool_call', id: 'tc_1', name: 'cmd', input: { command: 'ls' } },
      { type: 'usage', usage: { input_tokens: 50, output_tokens: 20 } },
    ]);

    // Turn 2: text only → implicit stop
    inferQueue.push([
      { type: 'text_block', text: 'Here are the files.' },
      { type: 'usage', usage: { input_tokens: 80, output_tokens: 15 } },
    ]);

    const tools = [{
      name: 'cmd',
      description: 'run command',
      input_schema: { type: 'object', properties: { command: { type: 'string' } } },
      execute: async () => 'file1.txt\nfile2.txt',
    }];

    const loop = getLoop();
    const turns = await collectTurns(loop({
      instanceDir,
      hooks: { tools: () => tools },
    }));

    assert.strictEqual(turns.length, 2);
  });

  it('stop tool explicitly stops the loop', async () => {
    writeEvent(eventsDir, { type: 'user', content: 'done' });

    inferQueue.push([
      { type: 'tool_call', id: 'tc_1', name: 'stop', input: {} },
      { type: 'usage', usage: {} },
    ]);

    const tools = [{
      name: 'stop',
      description: 'stop',
      input_schema: { type: 'object' },
      execute: async (_input, ctrl) => { ctrl.stop(); return 'Stopped'; },
    }];

    const loop = getLoop();
    const turns = await collectTurns(loop({
      instanceDir,
      hooks: { tools: () => tools },
    }));

    assert.strictEqual(turns.length, 1);
  });

  it('signal abort stops the loop', async () => {
    writeEvent(eventsDir, { type: 'user', content: 'go' });

    const ac = new AbortController();

    // This response will be consumed, but we abort before next turn
    inferQueue.push([
      { type: 'tool_call', id: 'tc_1', name: 'do_abort', input: {} },
      { type: 'usage', usage: {} },
    ]);

    // Push a second response that should never be consumed
    inferQueue.push([
      { type: 'text_block', text: 'should not reach' },
      { type: 'usage', usage: {} },
    ]);

    const tools = [{
      name: 'do_abort',
      description: 'triggers abort',
      input_schema: { type: 'object' },
      execute: async () => { ac.abort(); return 'ok'; },
    }];

    const loop = getLoop();
    const turns = await collectTurns(loop({
      instanceDir,
      signal: ac.signal,
      hooks: { tools: () => tools },
    }));

    // loop checks signal.aborted after run() returns but before yield,
    // so the first turn is not yielded. 0 turns is correct.
    assert.ok(turns.length <= 1, 'Should have at most 1 turn');
    // The second response should NOT have been consumed
    assert.strictEqual(inferQueue.length, 1, 'Second infer call should not happen');
  });

  it('hooks.system is passed to prompt', async () => {
    writeEvent(eventsDir, { type: 'user', content: 'hi' });

    inferQueue.push([
      { type: 'text_block', text: 'ok' },
      { type: 'usage', usage: {} },
    ]);

    const loop = getLoop();
    const turns = await collectTurns(loop({
      instanceDir,
      hooks: {
        system: () => [{ type: 'text', text: 'You are a test bot' }],
      },
    }));

    // loop.js appends instance info block after hooks.system
    const system = turns[0].prompt.system;
    assert.strictEqual(system[0].type, 'text');
    assert.strictEqual(system[0].text, 'You are a test bot');
    assert.strictEqual(system.length, 2);
    assert.ok(system[1].text.includes('Instance:'));
  });

  it('hooks.tools are included in prompt with cache_control on last', async () => {
    writeEvent(eventsDir, { type: 'user', content: 'hi' });

    inferQueue.push([
      { type: 'text_block', text: 'ok' },
      { type: 'usage', usage: {} },
    ]);

    const tools = [
      { name: 'cmd', description: 'run command', input_schema: { type: 'object' }, execute: async () => '' },
      { name: 'read', description: 'read file', input_schema: { type: 'object' }, execute: async () => '' },
    ];

    const loop = getLoop();
    const turns = await collectTurns(loop({
      instanceDir,
      hooks: { tools: () => tools },
    }));

    const promptTools = turns[0].prompt.tools;
    assert.strictEqual(promptTools.length, 2);
    assert.strictEqual(promptTools[0].name, 'cmd');
    assert.ok(!promptTools[0].cache_control, 'First tool should not have cache_control');
    assert.deepStrictEqual(promptTools[1].cache_control, { type: 'ephemeral' });
    // execute should be stripped from prompt tools
    assert.ok(!promptTools[0].execute);
    assert.ok(!promptTools[1].execute);
  });

  it('hooks.events filters events', async () => {
    writeEvent(eventsDir, { type: 'user', content: 'old message' });
    writeEvent(eventsDir, { type: 'user', content: 'new message' });

    inferQueue.push([
      { type: 'text_block', text: 'ok' },
      { type: 'usage', usage: {} },
    ]);

    const loop = getLoop();
    const turns = await collectTurns(loop({
      instanceDir,
      hooks: {
        events: (events) => events.slice(-1), // Only keep last event
      },
    }));

    // The prompt messages should only have the last user message
    const userTexts = turns[0].prompt.messages
      .filter(m => m.role === 'user')
      .flatMap(m => m.content)
      .filter(c => c.type === 'text')
      .map(c => c.text);
    assert.ok(userTexts.includes('new message'));
    assert.ok(!userTexts.includes('old message'));
  });

  it('hooks.messages transforms messages', async () => {
    writeEvent(eventsDir, { type: 'user', content: 'hi' });

    inferQueue.push([
      { type: 'text_block', text: 'ok' },
      { type: 'usage', usage: {} },
    ]);

    const loop = getLoop();
    const turns = await collectTurns(loop({
      instanceDir,
      hooks: {
        messages: (msgs) => {
          // Prepend a context message
          return [
            { role: 'user', content: [{ type: 'text', text: 'context: testing' }] },
            { role: 'assistant', content: [{ type: 'text', text: 'understood' }] },
            ...msgs,
          ];
        },
      },
    }));

    const msgs = turns[0].prompt.messages;
    assert.strictEqual(msgs[0].content[0].text, 'context: testing');
    assert.strictEqual(msgs[1].content[0].text, 'understood');
  });

  it('hooks.output is called with each turn', async () => {
    writeEvent(eventsDir, { type: 'user', content: 'hi' });

    inferQueue.push([
      { type: 'text_block', text: 'ok' },
      { type: 'usage', usage: { input_tokens: 1 } },
    ]);

    const outputCalls = [];
    const loop = getLoop();
    await collectTurns(loop({
      instanceDir,
      hooks: {
        output: (turn) => outputCalls.push(turn),
      },
    }));

    assert.strictEqual(outputCalls.length, 1);
    assert.ok(outputCalls[0].prompt);
    assert.ok(outputCalls[0].output);
    assert.ok(outputCalls[0].duration >= 0);
  });

  it('error in infer stops the loop', async () => {
    writeEvent(eventsDir, { type: 'user', content: 'hi' });

    inferQueue.push([
      { type: 'error', message: 'API is down' },
    ]);

    const loop = getLoop();
    const turns = await collectTurns(loop({ instanceDir }));

    assert.strictEqual(turns.length, 1);

    // Error event should be written
    const events = readEvents(eventsDir);
    const errorEvents = events.filter(e => e.type === 'error');
    assert.strictEqual(errorEvents.length, 1);
    assert.strictEqual(errorEvents[0].message, 'API is down');
  });

  it('wait tool pauses before next turn', async () => {
    writeEvent(eventsDir, { type: 'user', content: 'go' });

    // Turn 1: wait tool
    inferQueue.push([
      { type: 'tool_call', id: 'tc_1', name: 'wait_tool', input: { seconds: 0.05 } },
      { type: 'usage', usage: {} },
    ]);

    // Turn 2: text → stop
    inferQueue.push([
      { type: 'text_block', text: 'done waiting' },
      { type: 'usage', usage: {} },
    ]);

    const tools = [{
      name: 'wait_tool',
      description: 'wait',
      input_schema: { type: 'object' },
      execute: async (input, ctrl) => { ctrl.wait(input.seconds); return 'waiting'; },
    }];

    const loop = getLoop();
    const start = Date.now();
    const turns = await collectTurns(loop({
      instanceDir,
      hooks: { tools: () => tools },
    }));
    const elapsed = Date.now() - start;

    assert.strictEqual(turns.length, 2);
    // Should have waited at least ~50ms
    assert.ok(elapsed >= 40, `Expected >= 40ms elapsed, got ${elapsed}ms`);
  });
});
