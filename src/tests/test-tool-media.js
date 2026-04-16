const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// --- Mock @google/genai before requiring tool-media ---
const mockClient = {
  models: { generateContent: null, generateVideos: null },
  operations: { getVideosOperation: null },
  files: { download: null },
};

const genaiPath = require.resolve('@google/genai');
require.cache[genaiPath] = {
  id: genaiPath, filename: genaiPath, loaded: true,
  exports: { GoogleGenAI: function() { return mockClient; } },
};

const toolMedia = require('../hooks/tool-media');
function getTool(name) { return toolMedia.find(t => t.name === name); }

let tmpDir;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dusty4-test-media-')); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

// ======================== image ========================

describe('image', () => {
  it('saves image and returns success message', async () => {
    const imgData = Buffer.from('fake-png-data').toString('base64');
    mockClient.models.generateContent = async () => ({
      candidates: [{ content: { parts: [{ inlineData: { data: imgData } }] } }],
    });
    const fp = path.join(tmpDir, 'out.png');
    const result = await getTool('image').execute({ prompt: 'a cat', path: fp });
    assert.strictEqual(result, `Image saved to ${fp}`);
    assert.deepStrictEqual(Buffer.from('fake-png-data'), fs.readFileSync(fp));
  });

  it('includes text in result when response has text parts', async () => {
    const imgData = Buffer.from('img').toString('base64');
    mockClient.models.generateContent = async () => ({
      candidates: [{ content: { parts: [
        { text: 'Here is your cat' },
        { inlineData: { data: imgData } },
      ] } }],
    });
    const fp = path.join(tmpDir, 'out.png');
    const result = await getTool('image').execute({ prompt: 'a cat', path: fp });
    assert.ok(result.includes('Image saved to'));
    assert.ok(result.includes('Here is your cat'));
  });

  it('passes options to generateContent config', async () => {
    let captured;
    mockClient.models.generateContent = async (params) => {
      captured = params;
      return { candidates: [{ content: { parts: [
        { inlineData: { data: Buffer.from('x').toString('base64') } },
      ] } }] };
    };
    const fp = path.join(tmpDir, 'out.png');
    await getTool('image').execute({ prompt: 'test', path: fp, options: { aspectRatio: '16:9', imageSize: '2K' } });
    assert.strictEqual(captured.config.imageConfig.aspectRatio, '16:9');
    assert.strictEqual(captured.config.imageConfig.imageSize, '2K');
  });

  it('throws when no image in response', async () => {
    mockClient.models.generateContent = async () => ({
      candidates: [{ content: { parts: [{ text: 'sorry' }] } }],
    });
    await assert.rejects(
      () => getTool('image').execute({ prompt: 'x', path: path.join(tmpDir, 'x.png') }),
      /No image generated.*sorry/,
    );
  });

  it('throws on empty candidates', async () => {
    mockClient.models.generateContent = async () => ({ candidates: [] });
    await assert.rejects(
      () => getTool('image').execute({ prompt: 'x', path: path.join(tmpDir, 'x.png') }),
      /No image generated/,
    );
  });

  it('creates nested directories automatically', async () => {
    const imgData = Buffer.from('data').toString('base64');
    mockClient.models.generateContent = async () => ({
      candidates: [{ content: { parts: [{ inlineData: { data: imgData } }] } }],
    });
    const fp = path.join(tmpDir, 'a', 'b', 'c', 'out.png');
    await getTool('image').execute({ prompt: 'test', path: fp });
    assert.ok(fs.existsSync(fp));
  });

  it('passes reference images as inlineData parts in contents', async () => {
    const ref1 = path.join(tmpDir, 'ref1.png');
    const ref2 = path.join(tmpDir, 'ref2.jpg');
    fs.writeFileSync(ref1, Buffer.from('png-data'));
    fs.writeFileSync(ref2, Buffer.from('jpg-data'));
    let captured;
    mockClient.models.generateContent = async (params) => {
      captured = params;
      return { candidates: [{ content: { parts: [
        { inlineData: { data: Buffer.from('out').toString('base64') } },
      ] } }] };
    };
    const fp = path.join(tmpDir, 'out.png');
    await getTool('image').execute({ prompt: 'make it blue', path: fp, images: [ref1, ref2] });
    assert.ok(Array.isArray(captured.contents));
    assert.strictEqual(captured.contents.length, 3); // 2 images + 1 text
    assert.strictEqual(captured.contents[0].inlineData.mimeType, 'image/png');
    assert.strictEqual(captured.contents[1].inlineData.mimeType, 'image/jpeg');
    assert.strictEqual(captured.contents[2].text, 'make it blue');
  });

  it('uses plain string contents when no reference images', async () => {
    let captured;
    mockClient.models.generateContent = async (params) => {
      captured = params;
      return { candidates: [{ content: { parts: [
        { inlineData: { data: Buffer.from('out').toString('base64') } },
      ] } }] };
    };
    const fp = path.join(tmpDir, 'out.png');
    await getTool('image').execute({ prompt: 'a cat', path: fp });
    assert.strictEqual(captured.contents, 'a cat');
  });
});

// ======================== video ========================

describe('video', () => {
  it('saves video from videoBytes when done immediately', async () => {
    const videoData = Buffer.from('fake-mp4').toString('base64');
    mockClient.models.generateVideos = async () => ({
      done: true,
      response: { generatedVideos: [{ video: { videoBytes: videoData } }] },
    });
    const fp = path.join(tmpDir, 'out.mp4');
    const result = await getTool('video').execute({ prompt: 'a dog running', path: fp });
    assert.strictEqual(result, `Video saved to ${fp}`);
    assert.deepStrictEqual(Buffer.from('fake-mp4'), fs.readFileSync(fp));
  });

  it('polls until done', async () => {
    const origSetTimeout = global.setTimeout;
    global.setTimeout = (fn) => origSetTimeout(fn, 0); // instant poll
    try {
      let pollCount = 0;
      const videoData = Buffer.from('mp4').toString('base64');
      mockClient.models.generateVideos = async () => ({ done: false });
      mockClient.operations.getVideosOperation = async () => {
        pollCount++;
        if (pollCount >= 2) return {
          done: true,
          response: { generatedVideos: [{ video: { videoBytes: videoData } }] },
        };
        return { done: false };
      };
      const fp = path.join(tmpDir, 'out.mp4');
      await getTool('video').execute({ prompt: 'test', path: fp });
      assert.ok(fs.existsSync(fp));
      assert.strictEqual(pollCount, 2);
    } finally {
      global.setTimeout = origSetTimeout;
    }
  });

  it('passes options to generateVideos config', async () => {
    let captured;
    mockClient.models.generateVideos = async (params) => {
      captured = params;
      return {
        done: true,
        response: { generatedVideos: [{ video: { videoBytes: Buffer.from('v').toString('base64') } }] },
      };
    };
    const fp = path.join(tmpDir, 'out.mp4');
    await getTool('video').execute({
      prompt: 'test', path: fp,
      options: { aspectRatio: '9:16', resolution: '1080p', durationSeconds: 5, generateAudio: true },
    });
    assert.strictEqual(captured.config.aspectRatio, '9:16');
    assert.strictEqual(captured.config.resolution, '1080p');
    assert.strictEqual(captured.config.durationSeconds, 5);
    assert.strictEqual(captured.config.generateAudio, true);
  });

  it('throws on timeout', async () => {
    const origSetTimeout = global.setTimeout;
    const origDateNow = Date.now;
    global.setTimeout = (fn) => origSetTimeout(fn, 0);
    let calls = 0;
    const base = origDateNow.call(Date);
    Date.now = () => base + (calls++) * 6 * 60 * 1000; // jump 6min each call
    try {
      mockClient.models.generateVideos = async () => ({ done: false });
      mockClient.operations.getVideosOperation = async () => ({ done: false });
      await assert.rejects(
        () => getTool('video').execute({ prompt: 'x', path: path.join(tmpDir, 'x.mp4') }),
        /timed out/,
      );
    } finally {
      global.setTimeout = origSetTimeout;
      Date.now = origDateNow;
    }
  });

  it('throws on operation error', async () => {
    mockClient.models.generateVideos = async () => ({
      done: true, error: { code: 500, message: 'internal' },
    });
    await assert.rejects(
      () => getTool('video').execute({ prompt: 'x', path: path.join(tmpDir, 'x.mp4') }),
      /Video generation failed/,
    );
  });

  it('throws when no videos generated', async () => {
    mockClient.models.generateVideos = async () => ({
      done: true, response: { generatedVideos: [] },
    });
    await assert.rejects(
      () => getTool('video').execute({ prompt: 'x', path: path.join(tmpDir, 'x.mp4') }),
      /No video generated/,
    );
  });

  it('downloads from URI when no videoBytes', async () => {
    let downloadCalled = false;
    mockClient.models.generateVideos = async () => ({
      done: true,
      response: { generatedVideos: [{ video: { uri: 'https://example.com/v.mp4' } }] },
    });
    mockClient.files.download = async ({ file, downloadPath }) => {
      downloadCalled = true;
      assert.strictEqual(file.uri, 'https://example.com/v.mp4');
      fs.writeFileSync(downloadPath, 'downloaded');
    };
    const fp = path.join(tmpDir, 'out.mp4');
    await getTool('video').execute({ prompt: 'test', path: fp });
    assert.ok(downloadCalled);
    assert.strictEqual(fs.readFileSync(fp, 'utf-8'), 'downloaded');
  });

  it('throws when video has no data and no uri', async () => {
    mockClient.models.generateVideos = async () => ({
      done: true,
      response: { generatedVideos: [{ video: {} }] },
    });
    await assert.rejects(
      () => getTool('video').execute({ prompt: 'x', path: path.join(tmpDir, 'x.mp4') }),
      /contains no data/,
    );
  });

  it('passes image as base64 imageBytes for image-to-video', async () => {
    const imgFile = path.join(tmpDir, 'input.png');
    fs.writeFileSync(imgFile, Buffer.from('fake-png-content'));
    let captured;
    mockClient.models.generateVideos = async (params) => {
      captured = params;
      return {
        done: true,
        response: { generatedVideos: [{ video: { videoBytes: Buffer.from('v').toString('base64') } }] },
      };
    };
    const fp = path.join(tmpDir, 'out.mp4');
    await getTool('video').execute({ prompt: 'dog runs', image: imgFile, path: fp });
    assert.strictEqual(captured.image.imageBytes, Buffer.from('fake-png-content').toString('base64'));
    assert.strictEqual(captured.image.mimeType, 'image/png');
    assert.strictEqual(captured.prompt, 'dog runs');
    assert.ok(fs.existsSync(fp));
  });

  it('works with image only (no prompt)', async () => {
    const imgFile = path.join(tmpDir, 'input.jpg');
    fs.writeFileSync(imgFile, Buffer.from('jpeg-data'));
    let captured;
    mockClient.models.generateVideos = async (params) => {
      captured = params;
      return {
        done: true,
        response: { generatedVideos: [{ video: { videoBytes: Buffer.from('v').toString('base64') } }] },
      };
    };
    const fp = path.join(tmpDir, 'out.mp4');
    await getTool('video').execute({ image: imgFile, path: fp });
    assert.strictEqual(captured.image.mimeType, 'image/jpeg');
    assert.strictEqual(captured.prompt, undefined);
    assert.ok(fs.existsSync(fp));
  });

  it('throws when neither prompt nor image provided', async () => {
    await assert.rejects(
      () => getTool('video').execute({ path: path.join(tmpDir, 'x.mp4') }),
      /At least one of prompt or image/,
    );
  });

  it('throws on unsupported image format', async () => {
    const imgFile = path.join(tmpDir, 'input.bmp');
    fs.writeFileSync(imgFile, Buffer.from('bmp-data'));
    await assert.rejects(
      () => getTool('video').execute({ image: imgFile, path: path.join(tmpDir, 'x.mp4') }),
      /Unsupported image format/,
    );
  });

  it('throws when image file not found', async () => {
    await assert.rejects(
      () => getTool('video').execute({ image: path.join(tmpDir, 'nope.png'), path: path.join(tmpDir, 'x.mp4') }),
      /Image file not found/,
    );
  });

  it('passes lastFrame to config.lastFrame', async () => {
    const imgFile = path.join(tmpDir, 'first.png');
    const lastFile = path.join(tmpDir, 'last.jpg');
    fs.writeFileSync(imgFile, Buffer.from('first-frame'));
    fs.writeFileSync(lastFile, Buffer.from('last-frame'));
    let captured;
    mockClient.models.generateVideos = async (params) => {
      captured = params;
      return {
        done: true,
        response: { generatedVideos: [{ video: { videoBytes: Buffer.from('v').toString('base64') } }] },
      };
    };
    const fp = path.join(tmpDir, 'out.mp4');
    await getTool('video').execute({ image: imgFile, lastFrame: lastFile, path: fp });
    assert.strictEqual(captured.image.imageBytes, Buffer.from('first-frame').toString('base64'));
    assert.strictEqual(captured.image.mimeType, 'image/png');
    assert.strictEqual(captured.config.lastFrame.imageBytes, Buffer.from('last-frame').toString('base64'));
    assert.strictEqual(captured.config.lastFrame.mimeType, 'image/jpeg');
  });
});
