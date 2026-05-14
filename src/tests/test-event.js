const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { readEvents, writeEvent } = require('../core/event');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dusty4-test-event-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('readEvents', () => {
  it('returns empty array when events dir does not exist', () => {
    const result = readEvents(path.join(tmpDir, 'nonexistent'));
    assert.deepStrictEqual(result, []);
  });

  it('returns empty array when events dir is empty', () => {
    fs.mkdirSync(path.join(tmpDir, 'events'));
    const result = readEvents(tmpDir);
    assert.deepStrictEqual(result, []);
  });

  it('ignores non-event files', () => {
    fs.mkdirSync(path.join(tmpDir, 'events'));
    fs.writeFileSync(path.join(tmpDir, 'events', 'readme.txt'), 'hello');
    fs.writeFileSync(path.join(tmpDir, 'events', 'event.123.0.json'), JSON.stringify({ type: 'user', content: 'hi' }));
    const result = readEvents(tmpDir);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].type, 'user');
  });

  it('reads and sorts events by filename', () => {
    fs.mkdirSync(path.join(tmpDir, 'events'));
    fs.writeFileSync(path.join(tmpDir, 'events', 'event.200.0.json'), JSON.stringify({ type: 'user', content: 'second' }));
    fs.writeFileSync(path.join(tmpDir, 'events', 'event.100.0.json'), JSON.stringify({ type: 'user', content: 'first' }));
    const result = readEvents(tmpDir);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].content, 'first');
    assert.strictEqual(result[1].content, 'second');
  });

  it('attaches _file property to each event', () => {
    fs.mkdirSync(path.join(tmpDir, 'events'));
    fs.writeFileSync(path.join(tmpDir, 'events', 'event.100.0.json'), JSON.stringify({ type: 'user', content: 'hi' }));
    const result = readEvents(tmpDir);
    assert.strictEqual(result[0]._file, 'event.100.0.json');
  });
});

describe('writeEvent', () => {
  it('creates events directory if not exists', () => {
    const eventsDir = path.join(tmpDir, 'deep', 'events');
    writeEvent(eventsDir, { type: 'user', content: 'hello' });
    assert.ok(fs.existsSync(eventsDir));
  });

  it('writes event as JSON file with ts field', () => {
    const eventsDir = path.join(tmpDir, 'events');
    writeEvent(eventsDir, { type: 'user', content: 'hello' });
    const files = fs.readdirSync(eventsDir);
    assert.strictEqual(files.length, 1);
    assert.ok(files[0].startsWith('event.'));
    assert.ok(files[0].endsWith('.json'));
    const data = JSON.parse(fs.readFileSync(path.join(eventsDir, files[0]), 'utf-8'));
    assert.strictEqual(data.type, 'user');
    assert.strictEqual(data.content, 'hello');
    assert.strictEqual(typeof data.ts, 'number');
  });

  it('deduplicates filenames within same millisecond using sub counter', () => {
    const eventsDir = path.join(tmpDir, 'events');
    for (let i = 0; i < 5; i++) {
      writeEvent(eventsDir, { type: 'user', content: `msg${i}` });
    }
    const files = fs.readdirSync(eventsDir).sort();
    assert.strictEqual(files.length, 5);
    const unique = new Set(files);
    assert.strictEqual(unique.size, 5);
  });

  it('returns { ts, file }', () => {
    const eventsDir = path.join(tmpDir, 'events');
    const before = Date.now();
    const result = writeEvent(eventsDir, { type: 'user', content: 'hi' });
    const after = Date.now();
    assert.ok(result.ts >= before && result.ts <= after);
    assert.ok(fs.existsSync(result.file));
    const data = JSON.parse(fs.readFileSync(result.file, 'utf-8'));
    assert.strictEqual(data.content, 'hi');
  });

  it('written events can be read back by readEvents', () => {
    const eventsDir = path.join(tmpDir, 'events');
    writeEvent(eventsDir, { type: 'user', content: 'first' });
    writeEvent(eventsDir, { type: 'user', content: 'second' });
    const events = readEvents(tmpDir);
    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[0].content, 'first');
    assert.strictEqual(events[1].content, 'second');
  });
});
