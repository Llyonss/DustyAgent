const { describe, it } = require('node:test');
const assert = require('node:assert');

// Test match() directly — the SSE→event translation, which is the unit we care about.
// HTTP integration is covered by action.js tests.

describe('anthropic match()', () => {
  function getMatch() {
    delete require.cache[require.resolve('../core/providers/anthropic')];
    return require('../core/providers/anthropic').match;
  }

  it('yields delta(start) for content_block_start (text)', () => {
    const match = getMatch();
    const ctx = { block:null, id:null, content:'', json:'', usage:{} };
    const results = [...match(
      { type:'content_block_start', index:0, content_block:{ type:'text', text:'' } },
      ctx
    )];
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].type, 'delta');
    assert.strictEqual(results[0].start, true);
    assert.strictEqual(results[0].tool, 'speak');
  });

  it('yields delta(start) for content_block_start (tool_use)', () => {
    const match = getMatch();
    const ctx = { block:null, id:null, content:'', json:'', usage:{} };
    const results = [...match(
      { type:'content_block_start', index:0, content_block:{ type:'tool_use', id:'tc1', name:'cmd', input:{} } },
      ctx
    )];
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].type, 'delta');
    assert.strictEqual(results[0].start, true);
    assert.strictEqual(results[0].tool, 'cmd');
    assert.strictEqual(results[0].id, 'tc1');
  });

  it('yields delta(content) for text_delta', () => {
    const match = getMatch();
    const ctx = { block:{ type:'text' }, id:'text_0', content:'', json:'', usage:{} };
    const results = [...match(
      { type:'content_block_delta', index:0, delta:{ type:'text_delta', text:'Hello' } },
      ctx
    )];
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].type, 'delta');
    assert.strictEqual(results[0].content, 'Hello');
    assert.strictEqual(results[0].tool, 'speak');
  });

  it('yields delta(done,output) for content_block_stop (text)', () => {
    const match = getMatch();
    const ctx = { block:{ type:'text' }, id:'text_0', content:'Hello world', json:'', usage:{} };
    const results = [...match(
      { type:'content_block_stop', index:0 },
      ctx
    )];
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].type, 'delta');
    assert.strictEqual(results[0].done, true);
    assert.strictEqual(results[0].output, 'Hello world');
  });

  it('yields delta(done,input) for content_block_stop (tool_use)', () => {
    const match = getMatch();
    const ctx = { block:{ type:'tool_use', name:'cmd' }, id:'tc1', json:'{"command":"ls"}', content:'', usage:{} };
    const results = [...match(
      { type:'content_block_stop', index:0 },
      ctx
    )];
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].type, 'delta');
    assert.strictEqual(results[0].done, true);
    assert.deepStrictEqual(results[0].input, { command:'ls' });
  });

  it('yields delta for thinking block', () => {
    const match = getMatch();
    const ctx = { block:null, id:null, content:'', json:'', usage:{} };
    // start
    const r1 = [...match({ type:'content_block_start', index:0, content_block:{ type:'thinking', thinking:'' } }, ctx)];
    assert.strictEqual(r1[0].tool, 'thinking');
    assert.strictEqual(r1[0].start, true);
    // delta
    const r2 = [...match({ type:'content_block_delta', index:0, delta:{ type:'thinking_delta', thinking:'hmm' } }, ctx)];
    assert.strictEqual(r2[0].tool, 'thinking');
    assert.strictEqual(r2[0].content, 'hmm');
    // done
    const r3 = [...match({ type:'content_block_stop', index:0 }, ctx)];
    assert.strictEqual(r3[0].done, true);
    assert.strictEqual(r3[0].output, 'hmm');
  });

  it('yields error on malformed JSON in tool_use', () => {
    const match = getMatch();
    const ctx = { block:{ type:'tool_use', name:'cmd' }, id:'tc1', json:'{bad', content:'', usage:{} };
    const results = [...match({ type:'content_block_stop', index:0 }, ctx)];
    assert.ok(results.some(r => r.type === 'error'));
  });

  it('accumulates usage from message_start + message_delta', () => {
    const match = getMatch();
    const ctx = { block:null, id:null, content:'', json:'', usage:{} };
    [...match({ type:'message_start', message:{ usage:{ input_tokens:100, output_tokens:0 } } }, ctx)];
    [...match({ type:'message_delta', delta:{}, usage:{ output_tokens:42 } }, ctx)];
    assert.strictEqual(ctx.usage.input_tokens, 100);
    assert.strictEqual(ctx.usage.output_tokens, 42);
  });
});

describe('openai match()', () => {
  function getMatch() {
    delete require.cache[require.resolve('../core/providers/openai')];
    return require('../core/providers/openai').match;
  }

  function newCtx() {
    const ts = Date.now();
    return {
      tools: new Map(),
      text:'', thinking:'',
      textId:'speak_'+ts, thinkId:'thinking_'+ts,
      usage:{},
    };
  }

  it('yields delta(start+content) for text content', () => {
    const match = getMatch();
    const ctx = newCtx();
    const results = [];
    for (const y of match({ choices:[{ delta:{ content:'Hello' } }] }, ctx)) results.push(y);
    assert.strictEqual(results.length, 2); // start + content
    assert.strictEqual(results[0].start, true);
    assert.strictEqual(results[0].tool, 'speak');
    assert.strictEqual(results[1].content, 'Hello');
  });

  it('yields delta(done,output) on finish_reason', () => {
    const match = getMatch();
    const ctx = newCtx();
    ctx.text = 'Hello';
    const results = [...match({ choices:[{ finish_reason:'stop', delta:{} }] }, ctx)];
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].done, true);
    assert.strictEqual(results[0].output, 'Hello');
  });

  it('yields delta(start+delta+done) for tool_call', () => {
    const match = getMatch();
    const ctx = newCtx();
    // first delta → start
    const r1 = [...match({ choices:[{ delta:{ tool_calls:[{ index:0, id:'tc1', function:{ name:'cmd', arguments:'{"cmd"' } }] } }] }, ctx)];
    assert.ok(r1.some(r => r.start && r.tool === 'cmd'));
    // finish_reason → done with parsed input
    ctx.tools.get(0).args = '{"command":"ls"}';
    const r2 = [...match({ choices:[{ finish_reason:'tool_calls', delta:{} }] }, ctx)];
    assert.strictEqual(r2.length, 1);
    assert.strictEqual(r2[0].done, true);
    assert.deepStrictEqual(r2[0].input, { command:'ls' });
  });

  it('accumulates usage from final chunk', () => {
    const match = getMatch();
    const ctx = newCtx();
    [...match({ usage:{ prompt_tokens:100, completion_tokens:50 } }, ctx)];
    assert.strictEqual(ctx.usage.input_tokens, 100);
    assert.strictEqual(ctx.usage.output_tokens, 50);
  });
});
