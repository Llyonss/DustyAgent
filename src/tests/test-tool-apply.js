const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

let tmpDir, docPath, tools;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dusty4-test-apply-'));
  docPath = path.join(tmpDir, 'doc.md');
  tools = require('../agent/doc/tool-apply')(docPath);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function getTool(name) {
  return tools.find(t => t.name === name);
}

describe('patch', () => {
  it('replaces exact substring', async () => {
    fs.writeFileSync(docPath, 'hello world');
    await getTool('patch').execute({ old: 'world', new: 'earth' });
    assert.strictEqual(fs.readFileSync(docPath, 'utf-8'), 'hello earth');
  });

  it('fails when old text not found', async () => {
    fs.writeFileSync(docPath, 'hello world');
    await assert.rejects(
      () => getTool('patch').execute({ old: 'missing', new: 'x' }),
      /text not found/
    );
  });

  it('fails when old text matches multiple locations', async () => {
    fs.writeFileSync(docPath, 'aaa bbb aaa');
    await assert.rejects(
      () => getTool('patch').execute({ old: 'aaa', new: 'x' }),
      /found 2 matches/
    );
  });

  it('fails when document does not exist', async () => {
    await assert.rejects(
      () => getTool('patch').execute({ old: 'x', new: 'y' }),
      /cannot read document/
    );
  });
});
