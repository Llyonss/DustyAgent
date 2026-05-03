const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const FFMPEG = path.join(__dirname, '..', '..', '..', '..', 'lib', 'ffmpeg', 'bin', 'ffmpeg.exe');

async function splitGrid(imgPath, rows, cols) {
  imgPath = path.normalize(imgPath);
  if (!fs.existsSync(imgPath)) throw new Error('File not found: ' + imgPath);

  const meta = await sharp(imgPath).metadata();
  const cellW = Math.floor(meta.width / cols);
  const cellH = Math.floor(meta.height / rows);
  const dir = path.dirname(imgPath);
  const base = path.basename(imgPath, path.extname(imgPath));
  const outputs = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const outPath = path.join(dir, `${base}_${String(r * cols + c).padStart(3, '0')}.png`);
      await sharp(imgPath)
        .extract({ left: c * cellW, top: r * cellH, width: cellW, height: cellH })
        .png().toFile(outPath);
      outputs.push(outPath);
    }
  }
  return outputs;
}

function extractFrames(videoPath, fps = 8) {
  videoPath = path.normalize(videoPath);
  if (!fs.existsSync(videoPath)) throw new Error('File not found: ' + videoPath);

  const dir = path.dirname(videoPath);
  const base = path.basename(videoPath, path.extname(videoPath));
  const outPattern = path.join(dir, `${base}_%03d.png`);

  execSync(`"${FFMPEG}" -i "${videoPath}" -vf fps=${fps} "${outPattern}" -y`, { stdio: 'pipe' });

  return fs.readdirSync(dir)
    .filter(f => f.startsWith(base + '_') && f.endsWith('.png') && /\d{3}/.test(f))
    .sort()
    .map(f => path.join(dir, f));
}

// 自动检测背景色并扣除
function detectBgColor(data, width, height) {
  const px = (x, y) => {
    const i = (y * width + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const corners = [px(0, 0), px(width - 1, 0), px(0, height - 1), px(width - 1, height - 1)];
  return corners.reduce((acc, c) => [acc[0] + c[0] / 4, acc[1] + c[1] / 4, acc[2] + c[2] / 4], [0, 0, 0])
    .map(Math.round);
}

function chromaKey(data, bgR, bgG, bgB, threshold, cutoff) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const inner = threshold;
  const outer = threshold * 2;
  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i] - bgR, dg = data[i + 1] - bgG, db = data[i + 2] - bgB;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    if (dist < inner) {
      data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 0;
    } else if (dist < outer) {
      const t = (dist - inner) / (outer - inner);
      const spill = 1 - t;
      data[i]     = clamp((data[i]     - bgR * spill) / Math.max(t, 0.1));
      data[i + 1] = clamp((data[i + 1] - bgG * spill) / Math.max(t, 0.1));
      data[i + 2] = clamp((data[i + 2] - bgB * spill) / Math.max(t, 0.1));
      data[i + 3] = Math.round(data[i + 3] * t);
    }
  }
  // 硬边：砍掉低alpha边缘像素，游戏素材要干净硬边
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0 && data[i + 3] < (cutoff || 128)) {
      data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 0;
    }
  }
}

function floodFill(data, w, h, bgR, bgG, bgB, threshold, cutoff) {
  const dist = (i) => {
    const dr = data[i]-bgR, dg = data[i+1]-bgG, db = data[i+2]-bgB;
    return Math.sqrt(dr*dr + dg*dg + db*db);
  };
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const outer = threshold * 1.5;
  const mask = new Uint8Array(w * h);
  const seeds = [];
  // 四条边像素作为种子
  for (let x = 0; x < w; x++) {
    for (const y of [0, h-1]) {
      const idx = y * w + x;
      if (dist(idx*4) < threshold) { mask[idx] = 1; seeds.push(idx); }
    }
  }
  for (let y = 1; y < h-1; y++) {
    for (const x of [0, w-1]) {
      const idx = y * w + x;
      if (dist(idx*4) < threshold) { mask[idx] = 1; seeds.push(idx); }
    }
  }
  // BFS
  let head = 0;
  const q = seeds.slice();
  while (head < q.length) {
    const idx = q[head++];
    const x = idx % w, y = (idx - x) / w;
    const nb = [];
    if (x > 0) nb.push(idx-1);
    if (x < w-1) nb.push(idx+1);
    if (y > 0) nb.push(idx-w);
    if (y < h-1) nb.push(idx+w);
    for (const ni of nb) {
      if (mask[ni]) continue;
      const d = dist(ni*4);
      if (d < threshold) { mask[ni] = 1; q.push(ni); }
      else if (d < outer) { mask[ni] = 2; }
    }
  }
  for (let idx = 0; idx < w*h; idx++) {
    const i = idx * 4;
    if (mask[idx] === 1) { data[i]=0;data[i+1]=0;data[i+2]=0;data[i+3]=0; }
    else if (mask[idx] === 2) {
      const d = dist(i);
      const t = Math.min(1, (d-threshold)/(outer-threshold));
      const s = 1-t, dd = Math.max(t, 0.1);
      data[i]   = clamp((data[i]  -bgR*s)/dd);
      data[i+1] = clamp((data[i+1]-bgG*s)/dd);
      data[i+2] = clamp((data[i+2]-bgB*s)/dd);
      data[i+3] = Math.round(data[i+3]*t);
    }
  }
  for (let i = 0; i < data.length; i += 4) {
    if (data[i+3] > 0 && data[i+3] < cutoff) { data[i]=0;data[i+1]=0;data[i+2]=0;data[i+3]=0; }
  }
}

function hueFilter(data, w, h, bgR, bgG, bgB, threshold, cutoff) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  function rgb2h(r, g, b) {
    r/=255; g/=255; b/=255;
    const mx=Math.max(r,g,b), mn=Math.min(r,g,b), d=mx-mn;
    let hh=0;
    if (d!==0) {
      if (mx===r) hh=((g-b)/d+6)%6;
      else if (mx===g) hh=(b-r)/d+2;
      else hh=(r-g)/d+4;
      hh*=60;
    }
    return [hh, mx===0?0:d/mx];
  }
  const [bgH] = rgb2h(bgR, bgG, bgB);
  const range = threshold;
  for (let i = 0; i < data.length; i += 4) {
    const [ph, ps] = rgb2h(data[i], data[i+1], data[i+2]);
    let hd = Math.abs(ph - bgH); if (hd > 180) hd = 360 - hd;
    if (ps > 0.15 && hd < range * 0.5) {
      data[i]=0;data[i+1]=0;data[i+2]=0;data[i+3]=0;
    } else if (ps > 0.1 && hd < range) {
      const t = (hd - range*0.5) / (range*0.5);
      const s = 1-t, dd = Math.max(t, 0.1);
      data[i]   = clamp((data[i]  -bgR*s)/dd);
      data[i+1] = clamp((data[i+1]-bgG*s)/dd);
      data[i+2] = clamp((data[i+2]-bgB*s)/dd);
      data[i+3] = Math.round(data[i+3]*t);
    }
  }
  for (let i = 0; i < data.length; i += 4) {
    if (data[i+3] > 0 && data[i+3] < cutoff) { data[i]=0;data[i+1]=0;data[i+2]=0;data[i+3]=0; }
  }
}

const REMBG_WORKER = path.join(__dirname, 'rembg_worker.py');

async function removeBg(imgPath, tolerance = 80, cutoff = 128, mode = 'ai') {
  imgPath = path.normalize(imgPath);
  if (!fs.existsSync(imgPath)) throw new Error('File not found: ' + imgPath);

  const dir = path.dirname(imgPath);
  const base = path.basename(imgPath, path.extname(imgPath));
  const outPath = path.join(dir, `${base}_nobg.png`);

  if (mode === 'ai') {
    execSync(`python "${REMBG_WORKER}" "${imgPath}" "${outPath}"`, { stdio: 'pipe', timeout: 120000 });
    return outPath;
  }

  const { data, info } = await sharp(imgPath)
    .ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });

  const [bgR, bgG, bgB] = detectBgColor(data, info.width, info.height);

  if (mode === 'flood') floodFill(data, info.width, info.height, bgR, bgG, bgB, tolerance, cutoff);
  else if (mode === 'hue') hueFilter(data, info.width, info.height, bgR, bgG, bgB, tolerance, cutoff);
  else chromaKey(data, bgR, bgG, bgB, tolerance, cutoff);

  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png().toFile(outPath);
  return outPath;
}

const tools = [
  {
    name: 'split',
    description: '切割网格图。等分切割为独立PNG，不做去背景。',
    input_schema: {
      type: 'object',
      properties: {
        image: { type: 'string', description: '图片绝对路径' },
        rows: { type: 'number', description: '行数' },
        cols: { type: 'number', description: '列数' },
      },
      required: ['image', 'rows', 'cols'],
    },
    execute: async (input) => {
      const outputs = await splitGrid(input.image, input.rows, input.cols);
      return `Split into ${outputs.length} images:\n${outputs.join('\n')}`;
    },
  },
  {
    name: 'extract',
    description: '视频抽帧。ffmpeg 按指定 fps 抽帧 → PNG 序列。',
    input_schema: {
      type: 'object',
      properties: {
        video: { type: 'string', description: '视频绝对路径' },
        fps: { type: 'number', description: '每秒抽取帧数，默认8' },
      },
      required: ['video'],
    },
    execute: async (input) => {
      const outputs = extractFrames(input.video, input.fps);
      return `Extracted ${outputs.length} frames:\n${outputs.join('\n')}`;
    },
  },
];

module.exports = tools;
module.exports.splitGrid = splitGrid;
module.exports.extractFrames = extractFrames;
module.exports.removeBg = removeBg;
