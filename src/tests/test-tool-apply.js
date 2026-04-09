const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

let tmpDir, docPath, draftPath, tools;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dusty4-test-apply-'));
  docPath = path.join(tmpDir, 'doc.md');
  draftPath = path.join(tmpDir, 'doc.draft.md');
  tools = require('../agent/doc/tool-apply')(docPath, draftPath);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function getTool(name) {
  return tools.find(t => t.name === name);
}

describe('study', () => {
  it('replaces exact substring', async () => {
    fs.writeFileSync(draftPath, 'hello world');
    await getTool('study').execute({ old: 'world', new: 'earth' });
    assert.strictEqual(fs.readFileSync(draftPath, 'utf-8'), 'hello earth');
  });

  it('fails when old text not found', async () => {
    fs.writeFileSync(draftPath, 'hello world');
    await assert.rejects(
      () => getTool('study').execute({ old: 'missing', new: 'x' }),
      /text not found/
    );
  });

  it('fails when old text matches multiple locations', async () => {
    fs.writeFileSync(draftPath, 'aaa bbb aaa');
    await assert.rejects(
      () => getTool('study').execute({ old: 'aaa', new: 'x' }),
      /found 2 matches/
    );
  });

  it('fails when draft does not exist', async () => {
    await assert.rejects(
      () => getTool('study').execute({ old: 'x', new: 'y' }),
      /cannot read document/
    );
  });
});

describe('init', () => {
  it('writes content to draft', async () => {
    await getTool('init').execute({ content: '# Hello' });
    assert.strictEqual(fs.readFileSync(draftPath, 'utf-8'), '# Hello');
  });
});

describe('commit', () => {
  it('promotes draft to doc', async () => {
    fs.writeFileSync(draftPath, '# Committed');
    let stopped = false;
    const ctrl = { stop: () => { stopped = true; } };
    await getTool('commit').execute({ summary: 'test' }, ctrl);
    assert.strictEqual(fs.readFileSync(docPath, 'utf-8'), '# Committed');
    assert.ok(!fs.existsSync(draftPath));
    assert.ok(stopped);
  });
});

describe('mental', () => {
  it('reads draft if exists', async () => {
    fs.writeFileSync(draftPath, 'draft content');
    const result = await getTool('mental').execute();
    assert.strictEqual(result, 'draft content');
  });

  it('falls back to doc if no draft', async () => {
    fs.writeFileSync(docPath, 'doc content');
    const result = await getTool('mental').execute();
    assert.strictEqual(result, 'doc content');
  });

  it('returns (empty) if neither exists', async () => {
    const result = await getTool('mental').execute();
    assert.strictEqual(result, '(empty)');
  });
});
