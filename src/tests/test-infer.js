const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

// We need to set env vars BEFORE requiring infer.js, because
// the Anthropic client is lazily created with these values.
// We'll set LLM_BASE_URL to point to our mock server.

let server;
let serverPort;
let serverHandler; // set per-test to control response

function sseEvent(data) {
  // Anthropic SSE format: "event: <type>\ndata: <json>\n\n"
  return `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`;
}

// Build a typical Anthropic SSE response for a text-only reply
function textResponseSSE(text, { toolUseId, toolName, toolInput, inputTokens = 100, outputTokens = 20 } = {}) {
  const chunks = [];
  chunks.push(sseEvent({
    type: 'message_start',
    message: {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      content: [],
      model: 'test-model',
      usage: { input_tokens: inputTokens, output_tokens: 0 },
    },
  }));
  chunks.push(sseEvent({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  }));
  // Split text into two deltas for realism
  const mid = Math.floor(text.length / 2);
  chunks.push(sseEvent({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: text.slice(0, mid) },
  }));
  chunks.push(sseEvent({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: text.slice(mid) },
  }));
  chunks.push(sseEvent({
    type: 'content_block_stop',
    index: 0,
  }));
  chunks.push(sseEvent({
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: outputTokens },
  }));
  chunks.push(sseEvent({ type: 'message_stop' }));
  return chunks.join('');
}

function toolCallResponseSSE(toolId, toolName, toolInputJson, { text = null, inputTokens = 100, outputTokens = 30 } = {}) {
  const chunks = [];
  let blockIndex = 0;

  chunks.push(sseEvent({
    type: 'message_start',
    message: {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      content: [],
      model: 'test-model',
      usage: { input_tokens: inputTokens, output_tokens: 0 },
    },
  }));

  // Optional text block before tool call
  if (text) {
    chunks.push(sseEvent({
      type: 'content_block_start',
      index: blockIndex,
      content_block: { type: 'text', text: '' },
    }));
    chunks.push(sseEvent({
      type: 'content_block_delta',
      index: blockIndex,
      delta: { type: 'text_delta', text },
    }));
    chunks.push(sseEvent({
      type: 'content_block_stop',
      index: blockIndex,
    }));
    blockIndex++;
  }

  // Tool call block
  chunks.push(sseEvent({
    type: 'content_block_start',
    index: blockIndex,
    content_block: { type: 'tool_use', id: toolId, name: toolName, input: {} },
  }));
  chunks.push(sseEvent({
    type: 'content_block_delta',
    index: blockIndex,
    delta: { type: 'input_json_delta', partial_json: toolInputJson.slice(0, 5) },
  }));
  if (toolInputJson.length > 5) {
    chunks.push(sseEvent({
      type: 'content_block_delta',
      index: blockIndex,
      delta: { type: 'input_json_delta', partial_json: toolInputJson.slice(5) },
    }));
  }
  chunks.push(sseEvent({
    type: 'content_block_stop',
    index: blockIndex,
  }));

  chunks.push(sseEvent({
    type: 'message_delta',
    delta: { stop_reason: 'tool_use', stop_sequence: null },
    usage: { output_tokens: outputTokens },
  }));
  chunks.push(sseEvent({ type: 'message_stop' }));
  return chunks.join('');
}

before(async () => {
  server = http.createServer((req, res) => {
    // Collect body (we don't really need it, but consume it)
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (serverHandler) {
        serverHandler(req, res, body);
      } else {
        res.writeHead(500);
        res.end('No handler set');
      }
    });
  });

  await new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      serverPort = server.address().port;
      // Set env vars for the infer module
      process.env.LLM_API_KEY = 'test-key';
      process.env.LLM_MODEL = 'test-model';
      process.env.LLM_BASE_URL = `http://127.0.0.1:${serverPort}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
});

// Collect all items from an async generator
async function collect(gen) {
  const items = [];
  for await (const item of gen) items.push(item);
  return items;
}

describe('infer', () => {
  // We require infer lazily so env vars are already set
  function getInfer() {
    // Clear the module cache so it picks up fresh env/client
    delete require.cache[require.resolve('../core/infer')];
    return require('../core/infer').infer;
  }

  it('yields text_block for text-only response', async () => {
    serverHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(textResponseSSE('Hello world'));
    };

    const infer = getInfer();
    const items = await collect(infer(
      { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
      {}
    ));

    const textBlocks = items.filter(i => i.type === 'text_block');
    assert.strictEqual(textBlocks.length, 1);
    assert.strictEqual(textBlocks[0].text, 'Hello world');

    const usages = items.filter(i => i.type === 'usage');
    assert.strictEqual(usages.length, 1);
    assert.strictEqual(usages[0].usage.input_tokens, 100);
    assert.strictEqual(usages[0].usage.output_tokens, 20);
  });

  it('yields tool_call with parsed JSON input', async () => {
    const inputObj = { command: 'echo hello', timeout: 30 };
    serverHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(toolCallResponseSSE('tc_1', 'cmd', JSON.stringify(inputObj)));
    };

    const infer = getInfer();
    const items = await collect(infer(
      { messages: [{ role: 'user', content: [{ type: 'text', text: 'run it' }] }] },
      {}
    ));

    const toolCalls = items.filter(i => i.type === 'tool_call');
    assert.strictEqual(toolCalls.length, 1);
    assert.strictEqual(toolCalls[0].id, 'tc_1');
    assert.strictEqual(toolCalls[0].name, 'cmd');
    assert.deepStrictEqual(toolCalls[0].input, inputObj);
  });

  it('yields both text_block and tool_call when response has both', async () => {
    const inputObj = { path: 'file.txt' };
    serverHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(toolCallResponseSSE('tc_1', 'read', JSON.stringify(inputObj), { text: 'Let me read that file.' }));
    };

    const infer = getInfer();
    const items = await collect(infer(
      { messages: [{ role: 'user', content: [{ type: 'text', text: 'read file.txt' }] }] },
      {}
    ));

    const textBlocks = items.filter(i => i.type === 'text_block');
    const toolCalls = items.filter(i => i.type === 'tool_call');
    assert.strictEqual(textBlocks.length, 1);
    assert.strictEqual(textBlocks[0].text, 'Let me read that file.');
    assert.strictEqual(toolCalls.length, 1);
    assert.strictEqual(toolCalls[0].name, 'read');
  });

  it('yields error on HTTP error (non-200)', async () => {
    serverHandler = (_req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Internal server error' } }));
    };

    const infer = getInfer();
    const items = await collect(infer(
      { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
      {}
    ));

    const errors = items.filter(i => i.type === 'error');
    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].message.length > 0);
  });

  it('handles empty tool input (no input_json_delta)', async () => {
    // Tool call with no JSON deltas — should parse as {}
    serverHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const chunks = [];
      chunks.push(sseEvent({
        type: 'message_start',
        message: { id: 'msg_test', type: 'message', role: 'assistant', content: [], model: 'test-model', usage: { input_tokens: 50, output_tokens: 0 } },
      }));
      chunks.push(sseEvent({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'tc_empty', name: 'stop', input: {} },
      }));
      // No input_json_delta events
      chunks.push(sseEvent({ type: 'content_block_stop', index: 0 }));
      chunks.push(sseEvent({
        type: 'message_delta',
        delta: { stop_reason: 'tool_use' },
        usage: { output_tokens: 5 },
      }));
      chunks.push(sseEvent({ type: 'message_stop' }));
      res.end(chunks.join(''));
    };

    const infer = getInfer();
    const items = await collect(infer(
      { messages: [{ role: 'user', content: [{ type: 'text', text: 'stop' }] }] },
      {}
    ));

    const toolCalls = items.filter(i => i.type === 'tool_call');
    assert.strictEqual(toolCalls.length, 1);
    assert.deepStrictEqual(toolCalls[0].input, {});
  });

  it('merges usage from message_start and message_delta', async () => {
    serverHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(textResponseSSE('test', { inputTokens: 150, outputTokens: 42 }));
    };

    const infer = getInfer();
    const items = await collect(infer(
      { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
      {}
    ));

    const usage = items.find(i => i.type === 'usage').usage;
    assert.strictEqual(usage.input_tokens, 150);
    assert.strictEqual(usage.output_tokens, 42);
  });

  it('yields error when connection fails', async () => {
    // Point to a port that's not listening
    const origBase = process.env.LLM_BASE_URL;
    process.env.LLM_BASE_URL = 'http://127.0.0.1:1';

    const infer = getInfer();
    const items = await collect(infer(
      { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
      {}
    ));

    process.env.LLM_BASE_URL = origBase;

    const errors = items.filter(i => i.type === 'error');
    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].message.length > 0);
  });

  it('respects abort signal', { timeout: 5000 }, async () => {
    const ac = new AbortController();

    serverHandler = (req, res) => {
      // Simulate a hanging/slow SSE stream
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sseEvent({
        type: 'message_start',
        message: { id: 'msg_test', type: 'message', role: 'assistant', content: [], model: 'test-model', usage: { input_tokens: 10, output_tokens: 0 } },
      }));
      // Don't end the response — let it hang
      // Clean up when client disconnects
      req.on('close', () => res.end());
    };

    const infer = getInfer();

    // Abort after a short delay
    setTimeout(() => ac.abort(), 100);

    const items = await collect(infer(
      { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
      { signal: ac.signal }
    ));

    // Should not yield an error (aborted signals are silently returned)
    // or yield an error — either way it should complete without hanging
    assert.ok(true, 'infer completed after abort');
  });

  it('yields error when tool input JSON is malformed', async () => {
    serverHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const chunks = [];
      chunks.push(sseEvent({
        type: 'message_start',
        message: { id: 'msg_test', type: 'message', role: 'assistant', content: [], model: 'test-model', usage: { input_tokens: 50, output_tokens: 0 } },
      }));
      chunks.push(sseEvent({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'tc_bad', name: 'cmd', input: {} },
      }));
      // Send malformed JSON fragments
      chunks.push(sseEvent({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"command":' },
      }));
      chunks.push(sseEvent({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '<<INVALID>>' },
      }));
      // content_block_stop triggers JSON.parse on the malformed string
      chunks.push(sseEvent({ type: 'content_block_stop', index: 0 }));
      chunks.push(sseEvent({
        type: 'message_delta',
        delta: { stop_reason: 'tool_use' },
        usage: { output_tokens: 5 },
      }));
      chunks.push(sseEvent({ type: 'message_stop' }));
      res.end(chunks.join(''));
    };

    const infer = getInfer();
    const items = await collect(infer(
      { messages: [{ role: 'user', content: [{ type: 'text', text: 'run it' }] }] },
      {}
    ));

    // JSON.parse fails inside the try block, caught and yielded as error
    const errors = items.filter(i => i.type === 'error');
    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].message.includes('JSON'), `Expected JSON parse error, got: ${errors[0].message}`);
    // Should NOT yield a tool_call
    const toolCalls = items.filter(i => i.type === 'tool_call');
    assert.strictEqual(toolCalls.length, 0);
    // Should NOT yield usage (error causes early return)
    const usages = items.filter(i => i.type === 'usage');
    assert.strictEqual(usages.length, 0);
  });

  it('sends correct request body to API', async () => {
    let capturedBody;
    serverHandler = (_req, res, body) => {
      capturedBody = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(textResponseSSE('ok'));
    };

    const infer = getInfer();
    const prompt = {
      system: [{ type: 'text', text: 'You are helpful' }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      tools: [{ name: 'cmd', description: 'run command', input_schema: { type: 'object' } }],
    };

    await collect(infer(prompt, {}));

    assert.strictEqual(capturedBody.model, 'test-model');
    assert.strictEqual(capturedBody.max_tokens, 8192);
    assert.strictEqual(capturedBody.stream, true);
    assert.deepStrictEqual(capturedBody.system, prompt.system);
    assert.deepStrictEqual(capturedBody.messages, prompt.messages);
    assert.deepStrictEqual(capturedBody.tools, prompt.tools);
  });
});
