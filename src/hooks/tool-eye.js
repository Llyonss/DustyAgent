const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const DEFAULT_MAX = 768;
const ABSOLUTE_MAX = 1568;
const MAX_IMAGES = 25;

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

function validateImage(filePath) {
  const p = path.normalize(filePath);
  if (!fs.existsSync(p)) throw new Error('File not found: ' + p);
  const ext = path.extname(p).toLowerCase();
  if (!MIME[ext]) throw new Error('Unsupported image format: ' + ext);
  return p;
}

async function compressImage(buffer, maxSize = DEFAULT_MAX) {
  const size = Math.min(Math.max(maxSize, 1), ABSOLUTE_MAX);
  const meta = await sharp(buffer).metadata();
  const longSide = Math.max(meta.width || 0, meta.height || 0);
  let pipeline = sharp(buffer);
  if (longSide > size) {
    pipeline = pipeline.resize({ width: size, height: size, fit: 'inside' });
  }
  return pipeline.jpeg({ quality: 80 }).toBuffer();
}

function getGrid(count) {
  if (count <= 1) return { cols: 1, rows: 1 };
  if (count <= 2) return { cols: 2, rows: 1 };
  if (count <= 4) return { cols: 2, rows: 2 };
  if (count <= 6) return { cols: 3, rows: 2 };
  if (count <= 9) return { cols: 3, rows: 3 };
  if (count <= 12) return { cols: 4, rows: 3 };
  if (count <= 16) return { cols: 4, rows: 4 };
  if (count <= 20) return { cols: 5, rows: 4 };
  return { cols: 5, rows: 5 };
}

function getLabel(row, col) {
  return `${row + 1},${col + 1}`;
}

async function stitchImages(buffers, maxSize = DEFAULT_MAX) {
  const size = Math.min(Math.max(maxSize, 1), ABSOLUTE_MAX);
  const { cols, rows } = getGrid(buffers.length);
  const cellW = Math.floor(size / cols);
  const cellH = Math.floor(size / rows);
  const bg = { r: 32, g: 32, b: 32 };

  const resized = await Promise.all(buffers.map(buf =>
    sharp(buf).resize({ width: cellW, height: cellH, fit: 'contain', background: bg }).toBuffer()
  ));

  const composites = resized.map((buf, i) => ({
    input: buf,
    left: (i % cols) * cellW,
    top: Math.floor(i / cols) * cellH,
  }));

  return sharp({ create: { width: cols * cellW, height: rows * cellH, channels: 3, background: bg } })
    .composite(composites)
    .jpeg({ quality: 80 })
    .toBuffer();
}

const tools = [
  {
    name: 'eye',
    description: '查看图片。将图片附加到下一次推理中，让模型能够看到并分析图片内容。但是只会存在一轮，推理完会立马清理以后再也看不到图片本身。所以每一轮要在看到图片之后立马说出需要的图片内容，以及概述自己忽视的图片内容，这样未来才能正确推理。（这个很贵，用户批准后，谨慎节约的使用）\n\n用法：\n- path 为图片文件的绝对路径（支持 png/jpg/gif/webp）。\n- maxSize 可选，图片长边最大像素数（默认768，最大1568）。默认够用，确实看不清细节时再加大。\n\n多图模式：传 paths（路径数组，最多25张）代替 path，多张图会自动拼接为网格。工具会输出每张图在网格中的坐标（如[1,1][2,3]，行,列从1开始），看图时根据坐标对应原文件。',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute file path of the image to view' },
        paths: { type: 'array', items: { type: 'string' }, description: 'Array of absolute file paths to view as stitched grid (max 25)' },
        maxSize: { type: 'number', description: 'Max long side in pixels (default 768, max 1568)' },
      },
    },
    execute: async (input) => {
      if (input.paths && input.paths.length > 0) {
        if (input.paths.length > MAX_IMAGES) throw new Error('Too many images (max ' + MAX_IMAGES + ').');
        const filePaths = input.paths.map(p => validateImage(p));
        const { cols, rows } = getGrid(filePaths.length);
        const lines = [`GRID:${cols}:${rows}:${input.maxSize || ''}`];
        filePaths.forEach((fp, i) => {
          lines.push(`[${getLabel(Math.floor(i / cols), i % cols)}] ${fp}`);
        });
        return lines.join('\n');
      }
      if (!input.path) throw new Error('Either path or paths is required.');
      const filePath = validateImage(input.path);
      return input.maxSize ? filePath + '\n' + input.maxSize : filePath;
    },
  },
];

/**
 * Events hook: find eye actions in the last turn, read images,
 * replace output with rich content array [{ type: 'image', data, mimeType }, { type: 'text', text }].
 * Only modifies in-memory events — files keep the original string output.
 */
async function injectEyeEvents(events) {
  // Find the last turn number
  let lastTurn = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'action' && events[i].turn != null) {
      lastTurn = events[i].turn;
      break;
    }
  }
  if (lastTurn < 0) return events;

  // Check if there are any eye actions in the last turn
  const hasEye = events.some(e => e.type === 'action' && e.turn === lastTurn && e.tool === 'eye' && typeof e.output === 'string');
  if (!hasEye) return events;

  // Shallow clone array, deep clone only eye events we'll modify
  const result = events.map(e => {
    if (e.type === 'action' && e.turn === lastTurn && e.tool === 'eye' && typeof e.output === 'string') {
      return { ...e };
    }
    return e;
  });

  for (const e of result) {
    if (e.type !== 'action' || e.turn !== lastTurn || e.tool !== 'eye' || typeof e.output !== 'string') continue;

    const text = e.output;
    try {
      let compressed, description;

      if (text.startsWith('GRID:')) {
        const lines = text.split('\n');
        const [, , , maxStr] = lines[0].split(':');
        const maxSize = maxStr ? parseInt(maxStr, 10) : undefined;
        const filePaths = lines.slice(1).map(l => l.replace(/^\[[^\]]*\]\s*/, ''));
        const buffers = filePaths.map(fp => fs.readFileSync(fp));
        compressed = await stitchImages(buffers, maxSize);
        description = lines.slice(1).join('\n');
      } else {
        const parts = text.split('\n');
        const filePath = parts[0];
        const maxSize = parts[1] ? parseInt(parts[1], 10) : undefined;
        compressed = await compressImage(fs.readFileSync(filePath), maxSize);
        description = 'Image: ' + filePath;
      }

      e.output = [
        { type: 'image', data: compressed.toString('base64'), mimeType: 'image/jpeg' },
        { type: 'text', text: description },
      ];
    } catch {
      // keep original string
    }
  }

  return result;
}

module.exports = { tools, injectEyeEvents, getGrid, getLabel, stitchImages, compressImage };
