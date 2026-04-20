const { describe, it } = require('node:test');
const assert = require('node:assert');
const { buildMessages } = require('../core/prompt');

describe('buildMessages', () => {
  it('inserts (session started) when events are empty', () => {
    const msgs = buildMessages([]);
    assert.strictEqual(msgs.length, 1);
    assert.strictEqual(msgs[0].role, 'user');
    assert.strictEqual(msgs[0].content[0].text, '(session started)');
  });

  it('inserts (session started) when first event is not user', () => {
    const events = [
      { type: 'action', turn: 1, tool: 'speak', toolUseId: 'text_1', input: {}, output: 'hello' },
    ];
    const msgs = buildMessages(events);
    assert.strictEqual(msgs[0].role, 'user');
    assert.strictEqual(msgs[0].content[0].text, '(session started)');
  });

  it('builds user message from user event', () => {
    const events = [
      { type: 'user', content: 'hello' },
    ];
    const msgs = buildMessages(events);
    assert.strictEqual(msgs.length, 1);
    assert.strictEqual(msgs[0].role, 'user');
    assert.strictEqual(msgs[0].content[0].text, 'hello');
  });

  it('merges consecutive user events into one message', () => {
    const events = [
      { type: 'user', content: 'line1' },
      { type: 'user', content: 'line2' },
    ];
    const msgs = buildMessages(events);
    assert.strictEqual(msgs.length, 1);
    assert.strictEqual(msgs[0].content.length, 2);
    assert.strictEqual(msgs[0].content[0].text, 'line1');
    assert.strictEqual(msgs[0].content[1].text, 'line2');
  });

  it('groups actions by turn into assistant message', () => {
    const events = [
      { type: 'user', content: 'hi' },
      { type: 'action', turn: 100, tool: 'speak', toolUseId: 'text_1', input: {}, output: 'thinking...' },
      { type: 'action', turn: 100, tool: 'cmd', toolUseId: 'tool_1', input: { command: 'ls' }, output: 'file.txt' },
    ];
    const msgs = buildMessages(events);
    // user, assistant, user (tool_result)
    assert.strictEqual(msgs.length, 3);

    const assistant = msgs[1];
    assert.strictEqual(assistant.role, 'assistant');
    assert.strictEqual(assistant.content.length, 2);
    assert.strictEqual(assistant.content[0].type, 'text');
    assert.strictEqual(assistant.content[0].text, 'thinking...');
    assert.strictEqual(assistant.content[1].type, 'tool_use');
    assert.strictEqual(assistant.content[1].name, 'cmd');

    const toolResult = msgs[2];
    assert.strictEqual(toolResult.role, 'user');
    assert.strictEqual(toolResult.content[0].type, 'tool_result');
    assert.strictEqual(toolResult.content[0].tool_use_id, 'tool_1');
    assert.strictEqual(toolResult.content[0].content, 'file.txt');
  });

  it('speak-only action produces assistant message without tool_result', () => {
    const events = [
      { type: 'user', content: 'hi' },
      { type: 'action', turn: 100, tool: 'speak', toolUseId: 'text_1', input: {}, output: 'hello!' },
    ];
    const msgs = buildMessages(events);
    // user, assistant (no tool_result since speak is not a real tool)
    assert.strictEqual(msgs.length, 2);
    assert.strictEqual(msgs[1].role, 'assistant');
    assert.strictEqual(msgs[1].content[0].type, 'text');
  });

  it('merges user event after tool_result into same user message', () => {
    const events = [
      { type: 'user', content: 'start' },
      { type: 'action', turn: 100, tool: 'cmd', toolUseId: 'tool_1', input: { command: 'ls' }, output: 'ok' },
      { type: 'user', content: 'next question' },
    ];
    const msgs = buildMessages(events);
    // user, assistant, user (tool_result + user text merged)
    assert.strictEqual(msgs.length, 3);
    const lastUser = msgs[2];
    assert.strictEqual(lastUser.role, 'user');
    assert.strictEqual(lastUser.content.length, 2);
    assert.strictEqual(lastUser.content[0].type, 'tool_result');
    assert.strictEqual(lastUser.content[1].type, 'text');
    assert.strictEqual(lastUser.content[1].text, 'next question');
  });

  it('handles multiple turns correctly', () => {
    const events = [
      { type: 'user', content: 'q1' },
      { type: 'action', turn: 100, tool: 'speak', toolUseId: 'text_1', input: {}, output: 'a1' },
      { type: 'user', content: 'q2' },
      { type: 'action', turn: 200, tool: 'speak', toolUseId: 'text_2', input: {}, output: 'a2' },
    ];
    const msgs = buildMessages(events);
    // user(q1), assistant(a1), user(q2), assistant(a2)
    assert.strictEqual(msgs.length, 4);
    assert.strictEqual(msgs[0].role, 'user');
    assert.strictEqual(msgs[1].role, 'assistant');
    assert.strictEqual(msgs[2].role, 'user');
    assert.strictEqual(msgs[3].role, 'assistant');
  });

  it('adds cache_control to last block of last user message', () => {
    const events = [
      { type: 'user', content: 'hello' },
    ];
    const msgs = buildMessages(events);
    const lastMsg = msgs[msgs.length - 1];
    const lastBlock = lastMsg.content[lastMsg.content.length - 1];
    assert.deepStrictEqual(lastBlock.cache_control, { type: 'ephemeral', ttl: '5m' });
  });

  it('cache_control is on last user message even with tool_results', () => {
    const events = [
      { type: 'user', content: 'start' },
      { type: 'action', turn: 100, tool: 'cmd', toolUseId: 'tool_1', input: { command: 'ls' }, output: 'ok' },
    ];
    const msgs = buildMessages(events);
    const lastUser = msgs[msgs.length - 1];
    assert.strictEqual(lastUser.role, 'user');
    const lastBlock = lastUser.content[lastUser.content.length - 1];
    assert.deepStrictEqual(lastBlock.cache_control, { type: 'ephemeral', ttl: '5m' });
  });

  it('handles tool output that is null', () => {
    const events = [
      { type: 'user', content: 'go' },
      { type: 'action', turn: 100, tool: 'stop', toolUseId: 'tool_1', input: {}, output: null },
    ];
    const msgs = buildMessages(events);
    const toolResult = msgs[2].content[0];
    assert.strictEqual(toolResult.content, '');
  });

  it('skips unknown event types', () => {
    const events = [
      { type: 'user', content: 'hi' },
      { type: 'error', message: 'oops' },
      { type: 'action', turn: 100, tool: 'speak', toolUseId: 'text_1', input: {}, output: 'hey' },
    ];
    const msgs = buildMessages(events);
    // user, assistant — error event is skipped
    assert.strictEqual(msgs.length, 2);
  });

  it('multiple tool calls in same turn produce multiple tool_results', () => {
    const events = [
      { type: 'user', content: 'go' },
      { type: 'action', turn: 100, tool: 'read', toolUseId: 'tool_1', input: { path: 'a.txt' }, output: 'aaa' },
      { type: 'action', turn: 100, tool: 'read', toolUseId: 'tool_2', input: { path: 'b.txt' }, output: 'bbb' },
    ];
    const msgs = buildMessages(events);
    // user, assistant (2 tool_use), user (2 tool_result)
    assert.strictEqual(msgs.length, 3);
    assert.strictEqual(msgs[1].content.length, 2);
    assert.strictEqual(msgs[2].content.length, 2);
    assert.strictEqual(msgs[2].content[0].tool_use_id, 'tool_1');
    assert.strictEqual(msgs[2].content[1].tool_use_id, 'tool_2');
  });
});
