const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

let tmpDir;
const toolFile = require('../hooks/tool-file');

function getTool(name) {
  return toolFile.find(t => t.name === name);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dusty4-test-file-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('read', () => {
  it('returns raw file content without line numbers', async () => {
    const fp = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(fp, 'hello\nworld');
    const result = await getTool('read').execute({ path: fp });
    assert.ok(result.startsWith('hello\nworld'));
    // should not contain line number prefixes
    assert.ok(!result.match(/^\s*\d+\t/m));
  });

  it('content from read can be used directly in edit', async () => {
    const fp = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(fp, 'hello\nworld\nfoo');
    const readResult = await getTool('read').execute({ path: fp });
    assert.strictEqual(readResult, 'hello\nworld\nfoo');
    await getTool('edit').execute({ path: fp, old: 'hello\nworld', new: 'replaced' });
    assert.strictEqual(fs.readFileSync(fp, 'utf-8'), 'replaced\nfoo');
  });

  it('returns unchanged when file has not changed since last read', async () => {
    const fp = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(fp, 'hello world');
    const ctrl = {
      events: [
        { type: 'action', tool: 'read', input: { path: fp }, output: 'hello world' },
      ],
    };
    const result = await getTool('read').execute({ path: fp }, ctrl);
    assert.strictEqual(result, 'unchanged');
  });

  it('returns full content when file changed since last read', async () => {
    const fp = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(fp, 'hello world updated');
    const ctrl = {
      events: [
        { type: 'action', tool: 'read', input: { path: fp }, output: 'hello world' },
      ],
    };
    const result = await getTool('read').execute({ path: fp }, ctrl);
    assert.strictEqual(result, 'hello world updated');
  });

  it('returns full content when no prior read in events', async () => {
    const fp = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(fp, 'hello world');
    const ctrl = { events: [] };
    const result = await getTool('read').execute({ path: fp }, ctrl);
    assert.strictEqual(result, 'hello world');
  });

  it('returns full content when ctrl.events is not set', async () => {
    const fp = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(fp, 'hello world');
    const ctrl = {};
    const result = await getTool('read').execute({ path: fp }, ctrl);
    assert.strictEqual(result, 'hello world');
  });
});

describe('edit', () => {
  it('replaces exact substring', async () => {
    const fp = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(fp, 'hello world');
    await getTool('edit').execute({ path: fp, old: 'world', new: 'earth' });
    assert.strictEqual(fs.readFileSync(fp, 'utf-8'), 'hello earth');
  });

  it('fails when old text not found', async () => {
    const fp = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(fp, 'hello world');
    await assert.rejects(
      () => getTool('edit').execute({ path: fp, old: 'missing', new: 'x' }),
      /text not found/
    );
  });

  it('fails when old text matches multiple locations', async () => {
    const fp = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(fp, 'aaa bbb aaa');
    await assert.rejects(
      () => getTool('edit').execute({ path: fp, old: 'aaa', new: 'x' }),
      /found 2 matches/
    );
  });

  it('preserves rest of file content', async () => {
    const fp = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(fp, 'aaa\nbbb\nccc\nddd');
    await getTool('edit').execute({ path: fp, old: 'bbb\nccc', new: 'xxx' });
    assert.strictEqual(fs.readFileSync(fp, 'utf-8'), 'aaa\nxxx\nddd');
  });
});
