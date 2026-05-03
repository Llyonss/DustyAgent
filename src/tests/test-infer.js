const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server;
let serverPort;
let serverHandler;

function sseEvent(data) {
  return `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`;
}

function textResponseSSE(text, { inputTokens = 100, outputTokens = 20 } = {}) {
  const chunks = [];
  chunks.push(sseEvent({ type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', content: [], model: 'test-model', usage: { input_tokens: inputTokens, output_tokens: 0 } } }));
  chunks.push(sseEvent({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }));
  const mid = Math.floor(text.length / 2);
  chunks.push(sseEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(0, mid) } }));
  chunks.push(sseEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(mid) } }));
  chunks.push(sseEvent({ type: 'content_block_stop', index: 0 }));
  chunks.push(sseEvent({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: outputTokens } }));
  chunks.push(sseEvent({ type: 'message_stop' }));
  return chunks.join('');
}

function toolCallResponseSSE(toolId, toolName, toolInputJson, { text = null, inputTokens = 100, outputTokens = 30 } = {}) {
  const chunks = [];
  let blockIndex = 0;
  chunks.push(sseEvent({ type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', content: [], model: 'test-model', usage: { input_tokens: inputTokens, output_tokens: 0 } } }));
  if (text) {
    chunks.push(sseEvent({ type: 'content_block_start', index: blockIndex, content_block: { type: 'text', text: '' } }));
    chunks.push(sseEvent({ type: 'content_block_delta', index: blockIndex, delta: { type: 'text_delta', text } }));
    chunks.push(sseEvent({ type: 'content_block_stop', index: blockIndex }));
    blockIndex++;
  }
  chunks.push(sseEvent({ type: 'content_block_start', index: blockIndex, content_block: { type: 'tool_use', id: toolId, name: toolName, input: {} } }));
  chunks.push(sseEvent({ type: 'content_block_delta', index: blockIndex, delta: { type: 'input_json_delta', partial_json: toolInputJson.slice(0, 5) } }));
  if (toolInputJson.length > 5) {
    chunks.push(sseEvent({ type: 'content_block_delta', index: blockIndex, delta: { type: 'input_json_delta', partial_json: toolInputJson.slice(5) } }));
  }
  chunks.push(sseEvent({ type: 'content_block_stop', index: blockIndex }));
  chunks.push(sseEvent({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: outputTokens } }));
  chunks.push(sseEvent({ type: 'message_stop' }));
  return chunks.join('');
}

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => { serverHandler ? serverHandler(req, res, body) : (res.writeHead(500), res.end()); });
  });
  await new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      serverPort = server.address().port;
      process.env.LLM_API_KEY = 'test-key';
      process.env.LLM_MODEL = 'test-model';
      process.env.LLM_BASE_URL = `http://127.0.0.1:${serverPort}`;
      resolve();
    });
  });
});

after(async () => { await new Promise(resolve => server.close(resolve)); });

async function collect(gen) { const items = []; for await (const item of gen) items.push(item); return items; }

describe('infer', () => {
  function getInfer() {
    // Clear caches
    Object.keys(require.cache).forEach(key => {
      if (key.includes('core')) delete require.cache[key];
    });
    return require('../core/infer').infer;
  }

  const userEvents = [{ type: 'user', content: 'hi' }];

  it('yields action(speak) for text-only response', async () => {
    serverHandler = (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(textResponseSSE('Hello world')); };
    const infer = getInfer();
    const items = await collect(infer(userEvents, {}));
    const actions = items.filter(i => i.type === 'action' && i.tool === 'speak');
    assert.strictEqual(actions.length, 1);
    assert.strictEqual(actions[0].output, 'Hello world');
    const usages = items.filter(i => i.type === 'usage');
    assert.strictEqual(usages.length, 1);
  });

  it('yields delta(speak) for streaming text', async () => {
    serverHandler = (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(textResponseSSE('Hello')); };
    const infer = getInfer();
    const items = await collect(infer(userEvents, {}));
    const deltas = items.filter(i => i.type === 'delta' && i.tool === 'speak');
    assert.ok(deltas.length >= 1);
    assert.strictEqual(deltas.map(d => d.content).join(''), 'Hello');
  });

  it('yields action(tool) with parsed input for tool call', async () => {
    const inputObj = { command: 'echo hello', timeout: 30 };
    serverHandler = (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(toolCallResponseSSE('tc_1', 'cmd', JSON.stringify(inputObj))); };
    const infer = getInfer();
    const items = await collect(infer(userEvents, {}));
    const actions = items.filter(i => i.type === 'action' && i.tool === 'cmd');
    assert.strictEqual(actions.length, 1);
    assert.strictEqual(actions[0].id, 'tc_1');
    assert.deepStrictEqual(actions[0].input, inputObj);
  });

  it('yields both speak and tool actions when response has both', async () => {
    serverHandler = (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(toolCallResponseSSE('tc_1', 'read', '{"path":"f.txt"}', { text: 'Let me read.' })); };
    const infer = getInfer();
    const items = await collect(infer(userEvents, {}));
    const speaks = items.filter(i => i.type === 'action' && i.tool === 'speak');
    const tools = items.filter(i => i.type === 'action' && i.tool === 'read');
    assert.strictEqual(speaks.length, 1);
    assert.strictEqual(tools.length, 1);
  });

  it('yields error on HTTP error', async () => {
    serverHandler = (_req, res) => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'fail' } })); };
    const infer = getInfer();
    const items = await collect(infer(userEvents, {}));
    assert.ok(items.some(i => i.type === 'error'));
  });

  it('handles empty tool input', async () => {
    serverHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const chunks = [];
      chunks.push(sseEvent({ type: 'message_start', message: { id: 'msg', type: 'message', role: 'assistant', content: [], model: 'test', usage: { input_tokens: 50, output_tokens: 0 } } }));
      chunks.push(sseEvent({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tc', name: 'stop', input: {} } }));
      chunks.push(sseEvent({ type: 'content_block_stop', index: 0 }));
      chunks.push(sseEvent({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } }));
      chunks.push(sseEvent({ type: 'message_stop' }));
      res.end(chunks.join(''));
    };
    const infer = getInfer();
    const items = await collect(infer(userEvents, {}));
    const actions = items.filter(i => i.type === 'action' && i.tool === 'stop');
    assert.strictEqual(actions.length, 1);
    assert.deepStrictEqual(actions[0].input, {});
  });

  it('merges usage', async () => {
    serverHandler = (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(textResponseSSE('test', { inputTokens: 150, outputTokens: 42 })); };
    const infer = getInfer();
    const items = await collect(infer(userEvents, {}));
    const usage = items.find(i => i.type === 'usage').usage;
    assert.strictEqual(usage.input_tokens, 150);
    assert.strictEqual(usage.output_tokens, 42);
  });

  it('yields error when connection fails', async () => {
    const origBase = process.env.LLM_BASE_URL;
    process.env.LLM_BASE_URL = 'http://127.0.0.1:1';
    const infer = getInfer();
    const items = await collect(infer(userEvents, {}));
    process.env.LLM_BASE_URL = origBase;
    assert.ok(items.some(i => i.type === 'error'));
  });

  it('respects abort signal', { timeout: 5000 }, async () => {
    const ac = new AbortController();
    serverHandler = (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sseEvent({ type: 'message_start', message: { id: 'msg', type: 'message', role: 'assistant', content: [], model: 'test', usage: { input_tokens: 10, output_tokens: 0 } } }));
      req.on('close', () => res.end());
    };
    const infer = getInfer();
    setTimeout(() => ac.abort(), 100);
    const items = await collect(infer(userEvents, { signal: ac.signal }));
    assert.ok(true, 'completed after abort');
  });

  it('yields error on malformed tool JSON', async () => {
    serverHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const chunks = [];
      chunks.push(sseEvent({ type: 'message_start', message: { id: 'msg', type: 'message', role: 'assistant', content: [], model: 'test', usage: { input_tokens: 50, output_tokens: 0 } } }));
      chunks.push(sseEvent({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tc', name: 'cmd', input: {} } }));
      chunks.push(sseEvent({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{invalid' } }));
      chunks.push(sseEvent({ type: 'content_block_stop', index: 0 }));
      chunks.push(sseEvent({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } }));
      chunks.push(sseEvent({ type: 'message_stop' }));
      res.end(chunks.join(''));
    };
    const infer = getInfer();
    const items = await collect(infer(userEvents, {}));
    assert.ok(items.some(i => i.type === 'error' && i.message.includes('JSON')));
    assert.ok(!items.some(i => i.type === 'action' && i.tool === 'cmd'));
  });

  it('sends correct request body', async () => {
    let capturedBody;
    serverHandler = (_req, res, body) => { capturedBody = JSON.parse(body); res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(textResponseSSE('ok')); };
    const infer = getInfer();
    await collect(infer(userEvents, { system: [{ type: 'text', text: 'You are helpful' }], tools: [{ name: 'cmd', description: 'run', input_schema: { type: 'object' } }] }));
    assert.strictEqual(capturedBody.model, 'test-model');
    assert.ok(capturedBody.messages.length > 0);
    assert.ok(capturedBody.system);
    assert.ok(capturedBody.tools);
  });
});
