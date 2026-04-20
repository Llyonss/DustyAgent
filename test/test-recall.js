const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-'));
  const eventsDir = path.join(dir, 'events');
  fs.mkdirSync(eventsDir);
  const createTools = require('../src/agent/novel/brain/tools');
  const tools = createTools(dir);
  const recall = tools.find(t => t.name === 'recall');
  return { dir, eventsDir, recall };
}

function writeEvt(eventsDir, ts, sub, evt) {
  evt.ts = ts;
  fs.writeFileSync(path.join(eventsDir, `event.${ts}.${sub}.json`), JSON.stringify(evt));
}

test('recall', async (t) => {
  await t.test('returns last read content', async () => {
    const { dir, eventsDir, recall } = setup();
    const filePath = path.join(dir, 'outline.md');
    writeEvt(eventsDir, 1000, 0, {
      type: 'action', tool: 'read',
      input: { path: filePath },
      output: '# My Outline\nLine 1\nLine 2',
    });
    const result = await recall.execute({ file: filePath });
    assert.equal(result, '# My Outline\nLine 1\nLine 2');
  });

  await t.test('returns write input.content', async () => {
    const { dir, eventsDir, recall } = setup();
    const filePath = path.join(dir, 'style.md');
    writeEvt(eventsDir, 1000, 0, {
      type: 'action', tool: 'write',
      input: { path: filePath, content: 'bold style' },
      output: 'File written successfully.',
    });
    const result = await recall.execute({ file: filePath });
    assert.equal(result, 'bold style');
  });

  await t.test('applies edits after read', async () => {
    const { dir, eventsDir, recall } = setup();
    const filePath = path.join(dir, 'ch.md');
    writeEvt(eventsDir, 1000, 0, {
      type: 'action', tool: 'read',
      input: { path: filePath },
      output: 'Hello world, this is a test.',
    });
    writeEvt(eventsDir, 1001, 0, {
      type: 'action', tool: 'edit',
      input: { path: filePath, old: 'world', new: 'universe' },
      output: 'File edited successfully.',
    });
    writeEvt(eventsDir, 1002, 0, {
      type: 'action', tool: 'edit',
      input: { path: filePath, old: 'a test', new: 'an experiment' },
      output: 'File edited successfully.',
    });
    const result = await recall.execute({ file: filePath });
    assert.equal(result, 'Hello universe, this is an experiment.');
  });

  await t.test('skips failed edits', async () => {
    const { dir, eventsDir, recall } = setup();
    const filePath = path.join(dir, 'a.md');
    writeEvt(eventsDir, 1000, 0, {
      type: 'action', tool: 'read',
      input: { path: filePath },
      output: 'original content',
    });
    writeEvt(eventsDir, 1001, 0, {
      type: 'action', tool: 'edit', error: true,
      input: { path: filePath, old: 'missing', new: 'nope' },
      output: 'text not found',
    });
    const result = await recall.execute({ file: filePath });
    assert.equal(result, 'original content');
  });

  await t.test('uses latest read, ignoring older ones', async () => {
    const { dir, eventsDir, recall } = setup();
    const filePath = path.join(dir, 'b.md');
    writeEvt(eventsDir, 1000, 0, {
      type: 'action', tool: 'read',
      input: { path: filePath },
      output: 'version 1',
    });
    writeEvt(eventsDir, 2000, 0, {
      type: 'action', tool: 'read',
      input: { path: filePath },
      output: 'version 2',
    });
    writeEvt(eventsDir, 2001, 0, {
      type: 'action', tool: 'edit',
      input: { path: filePath, old: 'version 2', new: 'version 2 edited' },
      output: 'File edited successfully.',
    });
    const result = await recall.execute({ file: filePath });
    assert.equal(result, 'version 2 edited');
  });

  await t.test('returns not found when no history', async () => {
    const { dir, eventsDir, recall } = setup();
    const result = await recall.execute({ file: path.join(dir, 'nonexistent.md') });
    assert.equal(result, '未找到该文件的历史记录。');
  });

  await t.test('supports relative paths', async () => {
    const { dir, eventsDir, recall } = setup();
    const filePath = path.join(dir, 'outline.md');
    writeEvt(eventsDir, 1000, 0, {
      type: 'action', tool: 'read',
      input: { path: filePath },
      output: 'relative test',
    });
    const result = await recall.execute({ file: 'outline.md' });
    assert.equal(result, 'relative test');
  });

  await t.test('skips read with unchanged output', async () => {
    const { dir, eventsDir, recall } = setup();
    const filePath = path.join(dir, 'c.md');
    writeEvt(eventsDir, 1000, 0, {
      type: 'action', tool: 'read',
      input: { path: filePath },
      output: 'real content',
    });
    writeEvt(eventsDir, 2000, 0, {
      type: 'action', tool: 'read',
      input: { path: filePath },
      output: 'unchanged',
    });
    // Should skip 'unchanged' and find the real read
    const result = await recall.execute({ file: filePath });
    assert.equal(result, 'real content');
  });

  await t.test('write after read takes precedence', async () => {
    const { dir, eventsDir, recall } = setup();
    const filePath = path.join(dir, 'd.md');
    writeEvt(eventsDir, 1000, 0, {
      type: 'action', tool: 'read',
      input: { path: filePath },
      output: 'old read',
    });
    writeEvt(eventsDir, 2000, 0, {
      type: 'action', tool: 'write',
      input: { path: filePath, content: 'new write' },
      output: 'File written successfully.',
    });
    const result = await recall.execute({ file: filePath });
    assert.equal(result, 'new write');
  });

  await t.test('edits only apply to matching file', async () => {
    const { dir, eventsDir, recall } = setup();
    const fileA = path.join(dir, 'a.md');
    const fileB = path.join(dir, 'b.md');
    writeEvt(eventsDir, 1000, 0, {
      type: 'action', tool: 'read',
      input: { path: fileA },
      output: 'content A',
    });
    writeEvt(eventsDir, 1001, 0, {
      type: 'action', tool: 'edit',
      input: { path: fileB, old: 'x', new: 'y' },
      output: 'File edited successfully.',
    });
    const result = await recall.execute({ file: fileA });
    assert.equal(result, 'content A');
  });
});
