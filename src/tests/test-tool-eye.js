const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const sharp = require('sharp');

const { tools, injectEye, getGrid, getLabel, stitchImages, compressImage } = require('../hooks/tool-eye');
const eyeTool = tools[0];

let tmpDir;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dusty4-test-eye-')); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

// Helper: create a real PNG image file with sharp
async function createTestImage(name, width = 100, height = 100, color = { r: 255, g: 0, b: 0 }) {
  const fp = path.join(tmpDir, name);
  await sharp({ create: { width, height, channels: 3, background: color } }).png().toFile(fp);
  return fp;
}

describe('getGrid', () => {
  it('1 image → 1×1', () => assert.deepStrictEqual(getGrid(1), { cols: 1, rows: 1 }));
  it('2 images → 2×1', () => assert.deepStrictEqual(getGrid(2), { cols: 2, rows: 1 }));
  it('3 images → 2×2', () => assert.deepStrictEqual(getGrid(3), { cols: 2, rows: 2 }));
  it('4 images → 2×2', () => assert.deepStrictEqual(getGrid(4), { cols: 2, rows: 2 }));
  it('5 images → 3×2', () => assert.deepStrictEqual(getGrid(5), { cols: 3, rows: 2 }));
  it('6 images → 3×2', () => assert.deepStrictEqual(getGrid(6), { cols: 3, rows: 2 }));
  it('9 images → 3×3', () => assert.deepStrictEqual(getGrid(9), { cols: 3, rows: 3 }));
  it('12 images → 4×3', () => assert.deepStrictEqual(getGrid(12), { cols: 4, rows: 3 }));
  it('16 images → 4×4', () => assert.deepStrictEqual(getGrid(16), { cols: 4, rows: 4 }));
  it('20 images → 5×4', () => assert.deepStrictEqual(getGrid(20), { cols: 5, rows: 4 }));
  it('25 images → 5×5', () => assert.deepStrictEqual(getGrid(25), { cols: 5, rows: 5 }));
});

describe('getLabel', () => {
  it('returns 1-based row,col', () => {
    assert.strictEqual(getLabel(0, 0), '1,1');
    assert.strictEqual(getLabel(0, 1), '1,2');
    assert.strictEqual(getLabel(2, 3), '3,4');
    assert.strictEqual(getLabel(4, 4), '5,5');
  });
});

describe('compressImage', () => {
  it('shrinks large images to maxSize', async () => {
    const fp = await createTestImage('big.png', 2000, 1500);
    const buf = fs.readFileSync(fp);
    const out = await compressImage(buf, 768);
    const meta = await sharp(out).metadata();
    assert.ok(meta.width <= 768 && meta.height <= 768);
    assert.strictEqual(meta.format, 'jpeg');
  });

  it('does not upscale small images', async () => {
    const fp = await createTestImage('small.png', 200, 150);
    const buf = fs.readFileSync(fp);
    const out = await compressImage(buf, 768);
    const meta = await sharp(out).metadata();
    assert.strictEqual(meta.width, 200);
    assert.strictEqual(meta.height, 150);
  });

  it('clamps maxSize to ABSOLUTE_MAX', async () => {
    const fp = await createTestImage('huge.png', 3000, 2000);
    const buf = fs.readFileSync(fp);
    const out = await compressImage(buf, 9999);
    const meta = await sharp(out).metadata();
    assert.ok(meta.width <= 1568 && meta.height <= 1568);
  });
});

describe('stitchImages', () => {
  it('stitches 2 images into 2×1 grid', async () => {
    const f1 = await createTestImage('a.png', 100, 100, { r: 255, g: 0, b: 0 });
    const f2 = await createTestImage('b.png', 100, 100, { r: 0, g: 0, b: 255 });
    const bufs = [fs.readFileSync(f1), fs.readFileSync(f2)];
    const out = await stitchImages(bufs, 768);
    const meta = await sharp(out).metadata();
    assert.strictEqual(meta.format, 'jpeg');
    assert.strictEqual(meta.width, 768); // 2 cols × 384
    assert.strictEqual(meta.height, 768); // 1 row × 768
  });

  it('stitches 4 images into 2×2 grid', async () => {
    const bufs = [];
    for (let i = 0; i < 4; i++) {
      const fp = await createTestImage(`img${i}.png`, 200, 200);
      bufs.push(fs.readFileSync(fp));
    }
    const out = await stitchImages(bufs, 400);
    const meta = await sharp(out).metadata();
    assert.strictEqual(meta.width, 400);
    assert.strictEqual(meta.height, 400);
  });
});

describe('eye tool execute', () => {
  it('single path returns file path', async () => {
    const fp = await createTestImage('test.png');
    const result = await eyeTool.execute({ path: fp });
    assert.strictEqual(result, fp);
  });

  it('single path with maxSize appends size', async () => {
    const fp = await createTestImage('test.png');
    const result = await eyeTool.execute({ path: fp, maxSize: 1024 });
    assert.strictEqual(result, fp + '\n1024');
  });

  it('paths returns GRID format with labels', async () => {
    const f1 = await createTestImage('a.png');
    const f2 = await createTestImage('b.jpg');
    // rename .png to .jpg for test
    const f2jpg = path.join(tmpDir, 'b.jpg');
    fs.renameSync(f2, f2jpg);
    const f2real = await createTestImage('c.png');
    const result = await eyeTool.execute({ paths: [f1, f2real] });
    assert.ok(result.startsWith('GRID:2:1:'));
    assert.ok(result.includes('[1,1]'));
    assert.ok(result.includes('[1,2]'));
  });

  it('paths with 4 images returns 2×2 grid labels', async () => {
    const fps = [];
    for (let i = 0; i < 4; i++) fps.push(await createTestImage(`img${i}.png`));
    const result = await eyeTool.execute({ paths: fps });
    assert.ok(result.startsWith('GRID:2:2:'));
    assert.ok(result.includes('[1,1]'));
    assert.ok(result.includes('[2,2]'));
  });

  it('throws when neither path nor paths', async () => {
    await assert.rejects(() => eyeTool.execute({}), /Either path or paths/);
  });

  it('throws when paths exceeds 25', async () => {
    const fps = [];
    for (let i = 0; i < 26; i++) fps.push(await createTestImage(`img${i}.png`));
    await assert.rejects(() => eyeTool.execute({ paths: fps }), /Too many images/);
  });

  it('throws on unsupported format in paths', async () => {
    const fp = path.join(tmpDir, 'bad.bmp');
    fs.writeFileSync(fp, 'x');
    await assert.rejects(() => eyeTool.execute({ paths: [fp] }), /Unsupported image format/);
  });
});

describe('injectEye', () => {
  it('injects single image as compressed JPEG', async () => {
    const fp = await createTestImage('test.png', 2000, 1500);
    const messages = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'id1', name: 'eye' }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'id1', content: fp }] },
    ];
    const result = await injectEye(messages);
    const block = result[1].content[0];
    assert.strictEqual(block.content[0].type, 'image');
    assert.strictEqual(block.content[0].source.media_type, 'image/jpeg');
    assert.ok(block.content[1].text.includes(fp));
  });

  it('injects stitched grid for GRID format', async () => {
    const f1 = await createTestImage('a.png', 400, 300);
    const f2 = await createTestImage('b.png', 400, 300);
    const gridText = `GRID:2:1:\n[1,1] ${f1}\n[1,2] ${f2}`;
    const messages = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'id1', name: 'eye' }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'id1', content: gridText }] },
    ];
    const result = await injectEye(messages);
    const block = result[1].content[0];
    assert.strictEqual(block.content[0].type, 'image');
    assert.ok(block.content[1].text.includes('[1,1]'));
    assert.ok(block.content[1].text.includes('[1,2]'));
  });

  it('keeps original content when file not found', async () => {
    const messages = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'id1', name: 'eye' }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'id1', content: '/nonexistent.png' }] },
    ];
    const result = await injectEye(messages);
    assert.strictEqual(result[1].content[0].content, '/nonexistent.png');
  });

  it('skips non-eye tool results', async () => {
    const messages = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'id1', name: 'read' }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'id1', content: 'some text' }] },
    ];
    const result = await injectEye(messages);
    assert.strictEqual(result[1].content[0].content, 'some text');
  });
});
