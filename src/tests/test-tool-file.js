const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

let tmpDir;
const toolFile = require('../hooks/tool-file');
const file = toolFile.find(t => t.name === 'file');

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
    const result = await file.execute({ path: fp });
    assert.ok(result.startsWith('hello\nworld'));
    assert.ok(!result.match(/^\s*\d+\t/m));
  });

  it('content from read can be used directly in edit', async () => {
    const fp = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(fp, 'hello\nworld\nfoo');
    const readResult = await file.execute({ path: fp });
    assert.strictEqual(readResult, 'hello\nworld\nfoo');
    await file.execute({ path: fp, old: 'hello\nworld', new: 'replaced' });
    assert.strictEqual(fs.readFileSync(fp, 'utf-8'), 'replaced\nfoo');
  });

  it('returns unchanged when file has not changed since last read', async () => {
    const fp = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(fp, 'hello world');
    const ctrl = {
      events: [
        { type: 'action', tool: 'file', input: { path: fp }, output: 'hello world' },
      ],
    };
    const result = await file.execute({ path: fp }, ctrl);
    assert.strictEqual(result, 'unchanged');
  });

  it('returns full content when file changed since last read', async () => {
    const fp = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(fp, 'hello world updated');
    const ctrl = {
      events: [
        { type: 'action', tool: 'file', input: { path: fp }, output: 'hello world' },
      ],
    };
    const result = await file.execute({ path: fp }, ctrl);
    assert.strictEqual(result, 'hello world updated');
  });

  it('returns full content when no prior read in events', async () => {
    const fp = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(fp, 'hello world');
    const ctrl = { events: [] };
    const result = await file.execute({ path: fp }, ctrl);
    assert.strictEqual(result, 'hello world');
  });

  it('returns full content when ctrl.events is not set', async () => {
    const fp = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(fp, 'hello world');
    const ctrl = {};
    const result = await file.execute({ path: fp }, ctrl);
    assert.strictEqual(result, 'hello world');
  });

  it('from_line/to_line returns specified range', async () => {
    const fp = path.join(tmpDir, 'range.txt');
    const lines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`);
    fs.writeFileSync(fp, lines.join('\n'));
    const result = await file.execute({ path: fp, from_line: 3, to_line: 5 });
    assert.strictEqual(result, 'line3\nline4\nline5');
  });

  it('from_line only reads to end', async () => {
    const fp = path.join(tmpDir, 'range.txt');
    fs.writeFileSync(fp, 'a\nb\nc\nd\ne');
    const result = await file.execute({ path: fp, from_line: 4 });
    assert.strictEqual(result, 'd\ne');
  });

  it('to_line only reads from start', async () => {
    const fp = path.join(tmpDir, 'range.txt');
    fs.writeFileSync(fp, 'a\nb\nc\nd\ne');
    const result = await file.execute({ path: fp, to_line: 2 });
    assert.strictEqual(result, 'a\nb');
  });

  it('truncates when exceeding 500 lines', async () => {
    const fp = path.join(tmpDir, 'big.txt');
    const lines = Array.from({ length: 800 }, (_, i) => `line${i + 1}`);
    fs.writeFileSync(fp, lines.join('\n'));
    const result = await file.execute({ path: fp });
    assert.ok(result.includes('[truncated:'));
    assert.ok(result.includes('of 800 lines'));
    assert.ok(result.includes('line1\n'));
    assert.ok(result.includes('line500\n'));
    assert.ok(!result.includes('line501\n'));
  });

  it('truncates when exceeding 30000 chars', async () => {
    const fp = path.join(tmpDir, 'wide.txt');
    const lines = Array.from({ length: 50 }, (_, i) => `L${i + 1}:${'x'.repeat(997)}`);
    fs.writeFileSync(fp, lines.join('\n'));
    const result = await file.execute({ path: fp });
    assert.ok(result.includes('[truncated:'));
    assert.ok(result.includes('of 50 lines'));
  });

  it('skips unchanged check when using line range', async () => {
    const fp = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(fp, 'a\nb\nc');
    const ctrl = {
      events: [
        { type: 'action', tool: 'file', input: { path: fp }, output: 'a\nb\nc' },
      ],
    };
    const result = await file.execute({ path: fp, from_line: 1, to_line: 3 }, ctrl);
    assert.strictEqual(result, 'a\nb\nc');
  });
});

describe('edit', () => {
  it('replaces exact substring', async () => {
    const fp = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(fp, 'hello world');
    await file.execute({ path: fp, old: 'world', new: 'earth' });
    assert.strictEqual(fs.readFileSync(fp, 'utf-8'), 'hello earth');
  });

  it('fails when old text not found', async () => {
    const fp = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(fp, 'hello world');
    await assert.rejects(
      () => file.execute({ path: fp, old: 'missing', new: 'x' }),
      /text not found/
    );
  });

  it('fails when old text matches multiple locations', async () => {
    const fp = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(fp, 'aaa bbb aaa');
    await assert.rejects(
      () => file.execute({ path: fp, old: 'aaa', new: 'x' }),
      /found 2 matches/
    );
  });

  it('preserves rest of file content', async () => {
    const fp = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(fp, 'aaa\nbbb\nccc\nddd');
    await file.execute({ path: fp, old: 'bbb\nccc', new: 'xxx' });
    assert.strictEqual(fs.readFileSync(fp, 'utf-8'), 'aaa\nxxx\nddd');
  });
});

describe('write', () => {
  it('creates file with content', async () => {
    const fp = path.join(tmpDir, 'new.txt');
    await file.execute({ path: fp, content: 'hello' });
    assert.strictEqual(fs.readFileSync(fp, 'utf-8'), 'hello');
  });

  it('creates directories recursively', async () => {
    const fp = path.join(tmpDir, 'a', 'b', 'c.txt');
    await file.execute({ path: fp, content: 'deep' });
    assert.strictEqual(fs.readFileSync(fp, 'utf-8'), 'deep');
  });
});

describe('delete', () => {
  it('deletes file', async () => {
    const fp = path.join(tmpDir, 'del.txt');
    fs.writeFileSync(fp, 'bye');
    await file.execute({ path: fp, delete: true });
    assert.ok(!fs.existsSync(fp));
  });
});
