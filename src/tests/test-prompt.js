const { describe, it } = require('node:test');
const assert = require('node:assert');
const { groupEvents } = require('../core/prompt');

describe('groupEvents', () => {
  it('returns [(session started)] when events are empty', () => {
    const groups = groupEvents([]);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].type, 'user');
    assert.deepStrictEqual(groups[0].parts, ['(session started)']);
  });

  it('prepends (session started) when first event is not user', () => {
    const groups = groupEvents([
      { type: 'action', turn: 1, tool: 'speak', toolUseId: 'a', input: {}, output: 'Hi' },
    ]);
    assert.strictEqual(groups[0].type, 'user');
    assert.deepStrictEqual(groups[0].parts, ['(session started)']);
    assert.strictEqual(groups[1].type, 'turn');
  });

  it('creates user group from user event', () => {
    const groups = groupEvents([{ type: 'user', content: 'hello' }]);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].type, 'user');
    assert.deepStrictEqual(groups[0].parts, ['hello']);
  });

  it('merges consecutive user events', () => {
    const groups = groupEvents([
      { type: 'user', content: 'a' },
      { type: 'user', content: 'b' },
    ]);
    assert.strictEqual(groups.length, 1);
    assert.deepStrictEqual(groups[0].parts, ['a', 'b']);
  });

  it('groups actions by turn', () => {
    const groups = groupEvents([
      { type: 'user', content: 'hi' },
      { type: 'action', turn: 1, tool: 'speak', toolUseId: 'a', input: {}, output: 'Hello' },
      { type: 'action', turn: 1, tool: 'cmd', toolUseId: 'b', input: { command: 'ls' }, output: 'files' },
    ]);
    assert.strictEqual(groups.length, 2);
    assert.strictEqual(groups[1].type, 'turn');
    assert.strictEqual(groups[1].turn, 1);
    assert.strictEqual(groups[1].actions.length, 2);
  });

  it('absorbs following user into tool-calling turn as followUp', () => {
    const groups = groupEvents([
      { type: 'user', content: 'hi' },
      { type: 'action', turn: 1, tool: 'cmd', toolUseId: 'a', input: {}, output: 'ok' },
      { type: 'user', content: 'next' },
    ]);
    assert.strictEqual(groups.length, 2);
    assert.strictEqual(groups[1].followUp, 'next');
  });

  it('does NOT absorb user after speak-only turn', () => {
    const groups = groupEvents([
      { type: 'user', content: 'hi' },
      { type: 'action', turn: 1, tool: 'speak', toolUseId: 'a', input: {}, output: 'Hello' },
      { type: 'user', content: 'next' },
    ]);
    assert.strictEqual(groups.length, 3);
    assert.strictEqual(groups[1].followUp, undefined);
    assert.strictEqual(groups[2].type, 'user');
  });

  it('handles multiple turns', () => {
    const groups = groupEvents([
      { type: 'user', content: 'q1' },
      { type: 'action', turn: 1, tool: 'speak', toolUseId: 'a', input: {}, output: 'a1' },
      { type: 'user', content: 'q2' },
      { type: 'action', turn: 2, tool: 'cmd', toolUseId: 'b', input: {}, output: 'r2' },
      { type: 'user', content: 'q3' },
    ]);
    assert.strictEqual(groups.length, 4); // user, turn1, user, turn2(+followUp)
    assert.strictEqual(groups[3].followUp, 'q3');
  });

  it('skips unknown event types', () => {
    const groups = groupEvents([
      { type: 'user', content: 'hi' },
      { type: 'error', message: 'oops' },
      { type: 'user', content: 'again' },
    ]);
    assert.strictEqual(groups.length, 1);
    assert.deepStrictEqual(groups[0].parts, ['hi', 'again']);
  });

  it('does not absorb user after thinking-only turn', () => {
    const groups = groupEvents([
      { type: 'user', content: 'hi' },
      { type: 'action', turn: 1, tool: 'thinking', toolUseId: 'a', input: {}, output: 'hmm' },
      { type: 'action', turn: 1, tool: 'speak', toolUseId: 'b', input: {}, output: 'Hello' },
      { type: 'user', content: 'next' },
    ]);
    assert.strictEqual(groups[1].followUp, undefined);
    assert.strictEqual(groups[2].type, 'user');
  });
});
