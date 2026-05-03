const $ = (s) => document.querySelector(s);
let workspacePath = '';
let fileMap = {};   // name → absolute path
let allFiles = [];  // 完整文件列表
let lastFileHash = ''; // 用于检测变化

// --- Init ---
async function init() {
  const r = await fetch('/api/workspace-path').then(r => r.json());
  workspacePath = r.path;
  refreshFiles();
  pollChat();
  setInterval(refreshFiles, 3000);
}

// --- Gallery ---
function isImage(name) { return /\.(png|jpg|jpeg|webp|gif)$/i.test(name); }
function isVideo(name) { return /\.(mp4|webm)$/i.test(name); }
function baseName(name) { return name.replace(/\.[^.]+$/, ''); }

// 按前缀归组：xxx_0.png / xxx_001.png 归到 xxx.png / xxx.mp4 下
function groupFiles(files) {
  const groups = [];       // [{file, children}]
  const childSet = new Set();

  for (const f of files) {
    const bn = baseName(f.name);
    // 找子文件：匹配 parentBase_数字.png
    const children = files.filter(c => {
      if (c === f) return false;
      const cn = baseName(c.name);
      const re = new RegExp('^' + escRe(bn) + '[_](\\d+)$');
      return re.test(cn) && isImage(c.name);
    });
    if (children.length > 0) {
      children.sort((a, b) => a.name.localeCompare(b.name));
      groups.push({ file: f, children });
      children.forEach(c => childSet.add(c.name));
    }
  }

  // 剩余文件（不是别人的子文件）
  const result = [];
  for (const f of files) {
    if (childSet.has(f.name)) continue;
    const g = groups.find(g => g.file === f);
    result.push(g || { file: f, children: [] });
  }
  return result;
}

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

async function refreshFiles() {
  const files = await fetch('/api/files').then(r => r.json());
  const hash = files.map(f => f.name + f.mtime).join('|');
  if (hash === lastFileHash) return; // 无变化，跳过渲染
  lastFileHash = hash;
  allFiles = files;
  fileMap = {};
  allFiles.forEach(f => fileMap[f.name] = f.path);

  const grid = $('.grid');
  if (!allFiles.length) { grid.innerHTML = '<div class="empty">workspace 为空，上传或让 Agent 生成素材</div>'; return; }

  const groups = groupFiles(allFiles);
  grid.innerHTML = groups.map((g, gi) => {
    const f = g.file;
    const src = '/workspace/' + f.name;
    const vid = isVideo(f.name);
    const img = isImage(f.name);

    let media = '';
    if (vid) media = `<video src="${src}" muted loop></video>`;
    else if (img) media = `<img src="${src}" loading="lazy">`;

    let actions = '';
    if (img) actions = `<button data-action="split" data-idx="${gi}">切割</button><button data-action="removebg" data-idx="${gi}">去背景</button><button data-action="ref" data-name="${f.name}">引用</button>`;
    if (vid) actions = `<button data-action="extract" data-idx="${gi}">抽帧</button><button data-action="ref" data-name="${f.name}">引用</button>`;

    let childrenHtml = '';
    if (g.children.length > 0) {
      const thumbs = g.children.map((c, ci) => {
        const cIdx = allFiles.indexOf(c);
        return `<div class="child-card">
          <img src="/workspace/${c.name}" class="child-thumb" data-action="lightbox" data-src="/workspace/${c.name}">
          <div class="child-actions">
            <button data-action="ref" data-name="${c.name}">引用</button>
            <button data-action="removebg-child" data-path="${c.path.replace(/\\/g, '/')}">去背景</button>
            <button data-action="split-child" data-path="${c.path.replace(/\\/g, '/')}">切割</button>
          </div>
        </div>`;
      }).join('');
      // 帧播放器
      const childSrcs = g.children.map(c => '/workspace/' + c.name);
      childrenHtml = `<div class="children">
        <div class="children-bar">
          <span>${g.children.length} 张</span>
          <button data-action="play" data-frames='${JSON.stringify(childSrcs)}'>▶ 播放</button>
        </div>
        <div class="children-grid">${thumbs}</div>
      </div>`;
    }

    return `<div class="card-group">
      <div class="card" data-action="lightbox" data-src="${src}" data-video="${vid}">
        ${media}
        <div class="name">${f.name}</div>
        <div class="actions">${actions}</div>
      </div>
      ${childrenHtml}
    </div>`;
  }).join('');
}

// --- 事件委托 ---
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === 'lightbox') {
    e.stopPropagation();
    const src = btn.dataset.src;
    const vid = btn.dataset.video === 'true';
    lightbox(src, vid);
  }
  if (action === 'split') {
    e.stopPropagation();
    const g = groupFiles(allFiles)[+btn.dataset.idx];
    if (g) splitDialog(g.file.path);
  }
  if (action === 'extract') {
    e.stopPropagation();
    const g = groupFiles(allFiles)[+btn.dataset.idx];
    if (g) extractDialog(g.file.path);
  }
  if (action === 'removebg') {
    e.stopPropagation();
    const g = groupFiles(allFiles)[+btn.dataset.idx];
    if (g) removeBgAction(g.file.path);
  }
  if (action === 'ref') {
    e.stopPropagation();
    insertRef(btn.dataset.name);
  }
  if (action === 'removebg-child') {
    e.stopPropagation();
    removeBgAction(btn.dataset.path);
  }
  if (action === 'split-child') {
    e.stopPropagation();
    splitDialog(btn.dataset.path);
  }
  if (action === 'play') {
    e.stopPropagation();
    const frames = JSON.parse(btn.dataset.frames);
    playFrames(frames);
  }
});

// --- Upload ---
function uploadClick() {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = 'image/*,video/*';
  input.onchange = async () => {
    for (const file of input.files) {
      await fetch('/api/upload?name=' + encodeURIComponent(file.name), { method: 'PUT', body: file });
    }
    refreshFiles();
  };
  input.click();
}

// --- Insert ref ---
function insertRef(name) {
  const input = $('.chat-input input');
  const tag = `[${name}]`;
  const pos = input.selectionStart || input.value.length;
  input.value = input.value.slice(0, pos) + tag + input.value.slice(pos);
  input.focus();
  input.selectionStart = input.selectionEnd = pos + tag.length;
}

// --- Lightbox ---
function lightbox(src, isVid) {
  const el = document.createElement('div');
  el.className = 'lightbox';
  el.onclick = (e) => { if (e.target === el) el.remove(); };
  el.innerHTML = isVid
    ? `<video src="${src}" controls autoplay loop style="max-width:90vw;max-height:90vh"></video>`
    : `<img src="${src}">`;
  document.body.appendChild(el);
}

// --- Frame player ---
function playFrames(frames) {
  const el = document.createElement('div');
  el.className = 'lightbox';
  el.onclick = (e) => { if (e.target === el) { clearInterval(timer); el.remove(); } };
  const img = document.createElement('img');
  img.style.maxWidth = '80vw';
  img.style.maxHeight = '80vh';
  img.style.imageRendering = 'pixelated';
  el.appendChild(img);

  // 控制条
  const controls = document.createElement('div');
  controls.className = 'player-controls';
  controls.innerHTML = `<button data-dir="-1">◀</button><span class="frame-num">1/${frames.length}</span><button data-dir="1">▶</button><label>FPS:<input type="number" value="8" min="1" max="30" style="width:40px"></label>`;
  controls.onclick = (e) => e.stopPropagation();
  el.appendChild(controls);

  let idx = 0;
  let fps = 8;
  img.src = frames[0];

  const tick = () => { idx = (idx + 1) % frames.length; img.src = frames[idx]; controls.querySelector('.frame-num').textContent = `${idx + 1}/${frames.length}`; };
  let timer = setInterval(tick, 1000 / fps);

  controls.querySelector('input').oninput = (e) => {
    fps = Math.max(1, +e.target.value || 8);
    clearInterval(timer);
    timer = setInterval(tick, 1000 / fps);
  };
  controls.querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      clearInterval(timer);
      idx = (idx + +b.dataset.dir + frames.length) % frames.length;
      img.src = frames[idx];
      controls.querySelector('.frame-num').textContent = `${idx + 1}/${frames.length}`;
      timer = setInterval(tick, 1000 / fps);
    };
  });

  document.body.appendChild(el);
}

// --- Remove BG ---
function removeBgAction(imgPath) {
  // 找到对应的 workspace 相对路径
  const f = allFiles.find(f => f.path === imgPath || f.path.replace(/\\/g, '/') === imgPath);
  const src = f ? '/workspace/' + f.name : imgPath;
  removeBgPreview(imgPath, src);
}

function removeBgPreview(filePath, imgSrc) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  overlay.innerHTML = `<div class="bg-preview">
    <div class="bg-preview-canvases">
      <div><div class="bg-label">原图</div><canvas class="bg-orig"></canvas></div>
      <div><div class="bg-label">预览</div><canvas class="bg-result"></canvas></div>
    </div>
    <div class="bg-controls">
      <label>算法:
        <select class="sl-mode">
          <option value="ai" selected>AI分割</option>
          <option value="distance">色彩距离</option>
          <option value="flood">洪水填充</option>
          <option value="hue">色相过滤</option>
        </select>
      </label>
      <div class="traditional-controls">
        <label>扣除范围: <input type="range" class="sl-threshold" min="10" max="200" value="80"><span class="v-threshold">80</span></label>
        <label>硬边阈值: <input type="range" class="sl-cutoff" min="0" max="255" value="128"><span class="v-cutoff">128</span></label>
        <div class="bg-detected"></div>
      </div>
      <div class="ai-hint" style="color:#8f8;padding:4px 0;font-size:12px">🧠 语义级前景分割，无需调参，点击确认保存即可</div>
    </div>
    <div class="btns">
      <button class="cancel">取消</button>
      <button class="ok">确认保存</button>
    </div>
  </div>`;

  const origCanvas = overlay.querySelector('.bg-orig');
  const resultCanvas = overlay.querySelector('.bg-result');
  const slMode = overlay.querySelector('.sl-mode');
  const slThreshold = overlay.querySelector('.sl-threshold');
  const slCutoff = overlay.querySelector('.sl-cutoff');
  const vThreshold = overlay.querySelector('.v-threshold');
  const vCutoff = overlay.querySelector('.v-cutoff');
  const bgDetected = overlay.querySelector('.bg-detected');
  const traditionalControls = overlay.querySelector('.traditional-controls');
  const aiHint = overlay.querySelector('.ai-hint');
  const okBtn = overlay.querySelector('.ok');

  let originalData = null;
  let imgW = 0, imgH = 0;
  let bgColor = [0, 0, 0];

  function syncModeUI() {
    const isAI = slMode.value === 'ai';
    traditionalControls.style.display = isAI ? 'none' : '';
    aiHint.style.display = isAI ? '' : 'none';
    if (!isAI && originalData) update();
    else if (isAI) {
      const ctx = resultCanvas.getContext('2d');
      ctx.clearRect(0, 0, imgW, imgH);
      drawCheckerboard(ctx, imgW, imgH);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('点击「确认保存」生成', imgW / 2, imgH / 2);
    }
  }

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    imgW = img.width; imgH = img.height;
    origCanvas.width = resultCanvas.width = imgW;
    origCanvas.height = resultCanvas.height = imgH;
    const ctxO = origCanvas.getContext('2d');
    ctxO.drawImage(img, 0, 0);
    originalData = ctxO.getImageData(0, 0, imgW, imgH).data;
    bgColor = detectBgClient(originalData, imgW, imgH);
    bgDetected.innerHTML = `检测背景色: <span style="display:inline-block;width:14px;height:14px;border-radius:2px;vertical-align:middle;border:1px solid #666;background:rgb(${bgColor})"></span> rgb(${bgColor})`;
    syncModeUI();
  };
  img.src = imgSrc;

  function update() {
    if (!originalData || slMode.value === 'ai') return;
    const mode = slMode.value;
    const threshold = +slThreshold.value;
    const cutoff = +slCutoff.value;
    vThreshold.textContent = threshold;
    vCutoff.textContent = cutoff;

    const data = new Uint8ClampedArray(originalData);
    if (mode === 'distance') algDistance(data, imgW, imgH, bgColor, threshold, cutoff);
    else if (mode === 'flood') algFlood(data, imgW, imgH, bgColor, threshold, cutoff);
    else if (mode === 'hue') algHue(data, imgW, imgH, bgColor, threshold, cutoff);

    const ctx = resultCanvas.getContext('2d');
    ctx.clearRect(0, 0, imgW, imgH);
    drawCheckerboard(ctx, imgW, imgH);
    ctx.putImageData(new ImageData(data, imgW, imgH), 0, 0);
  }

  slMode.onchange = syncModeUI;
  slThreshold.oninput = update;
  slCutoff.oninput = update;

  overlay.querySelector('.cancel').onclick = () => overlay.remove();
  overlay.querySelector('.ok').onclick = async () => {
    const mode = slMode.value;
    okBtn.disabled = true;
    okBtn.textContent = mode === 'ai' ? 'AI 处理中…' : '保存中…';
    try {
      const res = await fetch('/api/remove-bg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: filePath, mode, threshold: +slThreshold.value, cutoff: +slCutoff.value }),
      }).then(r => r.json());
      if (res.error) { alert(res.error); okBtn.disabled = false; okBtn.textContent = '确认保存'; return; }
      lastFileHash = ''; refreshFiles();
      overlay.remove();
    } catch (e) { alert(e.message); okBtn.disabled = false; okBtn.textContent = '确认保存'; }
  };

  document.body.appendChild(overlay);
}

// --- 背景检测 ---
function detectBgClient(data, w, h) {
  const px = (x, y) => { const i = (y * w + x) * 4; return [data[i], data[i+1], data[i+2]]; };
  const corners = [px(0,0), px(w-1,0), px(0,h-1), px(w-1,h-1)];
  return corners.reduce((a, c) => [a[0]+c[0]/4, a[1]+c[1]/4, a[2]+c[2]/4], [0,0,0]).map(Math.round);
}

function rgbDist(r1,g1,b1,r2,g2,b2) {
  const dr=r1-r2, dg=g1-g2, db=b1-b2;
  return Math.sqrt(dr*dr+dg*dg+db*db);
}

function despill(data, i, bgR, bgG, bgB, t) {
  const s = 1 - t, d = Math.max(t, 0.1);
  data[i]   = Math.max(0, Math.min(255, Math.round((data[i]  -bgR*s)/d)));
  data[i+1] = Math.max(0, Math.min(255, Math.round((data[i+1]-bgG*s)/d)));
  data[i+2] = Math.max(0, Math.min(255, Math.round((data[i+2]-bgB*s)/d)));
}

function hardEdge(data, cutoff) {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i+3] > 0 && data[i+3] < cutoff) { data[i]=0;data[i+1]=0;data[i+2]=0;data[i+3]=0; }
  }
}

// --- 算法1: 色彩距离 ---
function algDistance(data, w, h, bg, threshold, cutoff) {
  const [bgR,bgG,bgB] = bg;
  const inner = threshold, outer = threshold * 2;
  for (let i = 0; i < data.length; i += 4) {
    const dist = rgbDist(data[i],data[i+1],data[i+2],bgR,bgG,bgB);
    if (dist < inner) { data[i]=0;data[i+1]=0;data[i+2]=0;data[i+3]=0; }
    else if (dist < outer) {
      const t = (dist-inner)/(outer-inner);
      despill(data,i,bgR,bgG,bgB,t);
      data[i+3] = Math.round(data[i+3]*t);
    }
  }
  hardEdge(data, cutoff);
}

// --- 算法2: 洪水填充 ---
function algFlood(data, w, h, bg, threshold, cutoff) {
  const [bgR,bgG,bgB] = bg;
  const mask = new Uint8Array(w * h); // 0=unknown, 1=bg, 2=edge
  const outer = threshold * 1.5;
  // BFS 从四条边所有像素开始
  const queue = [];
  for (let x = 0; x < w; x++) { queue.push(x); queue.push((h-1)*w+x); }
  for (let y = 1; y < h-1; y++) { queue.push(y*w); queue.push(y*w+w-1); }
  // 先标记种子
  const seeds = [];
  for (const idx of queue) {
    const i = idx * 4;
    if (rgbDist(data[i],data[i+1],data[i+2],bgR,bgG,bgB) < threshold) {
      mask[idx] = 1;
      seeds.push(idx);
    }
  }
  // BFS 扩散
  let head = 0;
  const q = seeds.slice();
  while (head < q.length) {
    const idx = q[head++];
    const x = idx % w, y = (idx - x) / w;
    const neighbors = [];
    if (x > 0) neighbors.push(idx-1);
    if (x < w-1) neighbors.push(idx+1);
    if (y > 0) neighbors.push(idx-w);
    if (y < h-1) neighbors.push(idx+w);
    for (const ni of neighbors) {
      if (mask[ni]) continue;
      const i = ni * 4;
      const dist = rgbDist(data[i],data[i+1],data[i+2],bgR,bgG,bgB);
      if (dist < threshold) { mask[ni] = 1; q.push(ni); }
      else if (dist < outer) { mask[ni] = 2; } // 边缘
    }
  }
  // 应用
  for (let idx = 0; idx < w*h; idx++) {
    const i = idx * 4;
    if (mask[idx] === 1) { data[i]=0;data[i+1]=0;data[i+2]=0;data[i+3]=0; }
    else if (mask[idx] === 2) {
      const dist = rgbDist(data[i],data[i+1],data[i+2],bgR,bgG,bgB);
      const t = Math.min(1, (dist-threshold)/(outer-threshold));
      despill(data,i,bgR,bgG,bgB,t);
      data[i+3] = Math.round(data[i+3]*t);
    }
  }
  hardEdge(data, cutoff);
}

// --- 算法3: 色相过滤 ---
function rgb2hsv(r, g, b) {
  r/=255; g/=255; b/=255;
  const mx=Math.max(r,g,b), mn=Math.min(r,g,b), d=mx-mn;
  let h=0, s=mx===0?0:d/mx, v=mx;
  if (d!==0) {
    if (mx===r) h=((g-b)/d+6)%6;
    else if (mx===g) h=(b-r)/d+2;
    else h=(r-g)/d+4;
    h*=60;
  }
  return [h, s, v];
}

function algHue(data, w, h, bg, threshold, cutoff) {
  const [bgH, bgS] = rgb2hsv(bg[0], bg[1], bg[2]);
  const hueRange = threshold; // threshold 当色相范围用 (0-200 映射到 0-200度)
  for (let i = 0; i < data.length; i += 4) {
    const [ph, ps, pv] = rgb2hsv(data[i], data[i+1], data[i+2]);
    let hueDiff = Math.abs(ph - bgH);
    if (hueDiff > 180) hueDiff = 360 - hueDiff;
    if (ps > 0.15 && hueDiff < hueRange * 0.5) {
      // 核心区
      data[i]=0;data[i+1]=0;data[i+2]=0;data[i+3]=0;
    } else if (ps > 0.1 && hueDiff < hueRange) {
      // 过渡区
      const t = (hueDiff - hueRange*0.5) / (hueRange*0.5);
      despill(data,i,bg[0],bg[1],bg[2],t);
      data[i+3] = Math.round(data[i+3]*t);
    }
  }
  hardEdge(data, cutoff);
}

function drawCheckerboard(ctx, w, h) {
  const size = 8;
  for (let y = 0; y < h; y += size) {
    for (let x = 0; x < w; x += size) {
      ctx.fillStyle = ((x/size + y/size) % 2 === 0) ? '#444' : '#333';
      ctx.fillRect(x, y, size, size);
    }
  }
}

// --- Split dialog ---
function splitDialog(imgPath) {
  showModal('切割网格图', [
    { label: '行数', id: 'rows', value: 2 },
    { label: '列数', id: 'cols', value: 2 },
  ], async (vals) => {
    const res = await fetch('/api/split', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imgPath, rows: +vals.rows, cols: +vals.cols }),

    }).then(r => r.json());
    if (res.error) alert(res.error);
    else refreshFiles();
  });
}

// --- Extract dialog ---
function extractDialog(videoPath) {
  showModal('视频抽帧', [
    { label: 'FPS', id: 'fps', value: 8 },
  ], async (vals) => {
    const res = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video: videoPath, fps: +vals.fps }),
    }).then(r => r.json());
    if (res.error) alert(res.error);
    else refreshFiles();
  });
}

// --- Modal ---
function showModal(title, fields, onOk) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal">
    <h3>${title}</h3>
    ${fields.map(f => `<label>${f.label}: <input id="modal-${f.id}" type="number" value="${f.value}"></label>`).join('')}
    <div class="btns">
      <button class="cancel">取消</button>
      <button class="ok">确定</button>
    </div>
  </div>`;
  overlay.querySelector('.cancel').onclick = () => overlay.remove();
  overlay.querySelector('.ok').onclick = () => {
    const vals = {};
    fields.forEach(f => vals[f.id] = overlay.querySelector(`#modal-${f.id}`).value);
    overlay.remove();
    onOk(vals);
  };
  document.body.appendChild(overlay);
}

// --- Chat ---
let lastEventCount = 0;

async function pollChat() {
  try {
    const { events } = await fetch('/api/events').then(r => r.json());
    if (events.length !== lastEventCount) {
      lastEventCount = events.length;
      renderChat(events);
    }
  } catch {}
  setTimeout(pollChat, 1000);
}

function renderChat(events) {
  const box = $('.messages');
  box.innerHTML = events.map(e => {
    if (e.type === 'user') return `<div class="msg user">${esc(e.content)}</div>`;
    if (e.type === 'error') return `<div class="msg error">❌ ${esc(e.message)}</div>`;
    if (e.type === 'action' && e.tool === 'speak') return `<div class="msg assistant">${esc(e.output)}</div>`;
    if (e.type === 'action') {
      const inputStr = typeof e.input === 'string' ? e.input : JSON.stringify(e.input || {}, null, 2);
      const outputStr = typeof e.output === 'string' ? e.output : JSON.stringify(e.output || '', null, 2);
      const hasError = e.error;
      return `<div class="msg tool ${hasError ? 'tool-error' : ''}">
        <div class="tool-header" onclick="this.parentElement.classList.toggle('expanded')">
          <span>${hasError ? '❌' : '🔧'} <strong>${esc(e.tool)}</strong></span>
          <span class="tool-summary">${esc(toolSummary(e))}</span>
        </div>
        <div class="tool-detail">
          <div class="tool-section"><div class="tool-label">输入</div><pre>${esc(inputStr)}</pre></div>
          <div class="tool-section"><div class="tool-label">输出</div><pre>${esc(outputStr.slice(0, 2000))}</pre></div>
        </div>
      </div>`;
    }
    return '';
  }).join('');
  box.scrollTop = box.scrollHeight;
}

function toolSummary(e) {
  if (!e.input || typeof e.input === 'string') return '';
  if (e.tool === 'image') return e.input.prompt ? e.input.prompt.slice(0, 40) + '…' : '';
  if (e.tool === 'video') return e.input.prompt ? e.input.prompt.slice(0, 40) + '…' : '';
  if (e.tool === 'split') return `${e.input.rows}×${e.input.cols}`;
  if (e.tool === 'extract') return `fps=${e.input.fps || 8}`;
  if (e.tool === 'eye') return e.input.path ? e.input.path.split(/[/\\]/).pop() : '';
  if (e.tool === 'file') return e.input.path ? e.input.path.split(/[/\\]/).pop() : '';
  if (e.tool === 'cmd') return e.input.command ? e.input.command.slice(0, 40) : '';
  return '';
}

function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

async function sendMessage() {
  const input = $('.chat-input input');
  const text = input.value.trim();
  if (!text) return;
  const content = text.replace(/\[([^\]]+)\]/g, (match, name) => {
    return fileMap[name] ? `[素材: ${fileMap[name]}]` : match;
  });
  input.value = '';
  await fetch('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}

$('.chat-input input').addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(); });
$('.chat-input button').addEventListener('click', sendMessage);

// --- Skills ---
async function loadSkillCount() {
  const skills = await fetch('/api/skills').then(r => r.json());
  $('#skill-count').textContent = skills.length;
}

async function showSkills() {
  const skills = await fetch('/api/skills').then(r => r.json());
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal" style="min-width:500px;max-height:80vh;overflow-y:auto">
    <h3>技能列表</h3>
    ${skills.length ? skills.map(s => `
      <div style="margin:8px 0;padding:8px;background:#1a1a2e;border-radius:4px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong>${esc(s.name)}</strong>
          <button class="cancel" style="padding:2px 8px;font-size:11px" data-action="delete-skill" data-skill="${esc(s.name)}">删除</button>
        </div>
        <pre style="margin-top:6px;font-size:11px;color:#aaa;white-space:pre-wrap">${esc(s.content)}</pre>
      </div>
    `).join('') : '<div style="color:#666;padding:12px">暂无技能</div>'}
    <div class="btns">
      <button class="ok" onclick="this.closest('.modal-overlay').remove()">关闭</button>
    </div>
  </div>`;
  overlay.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="delete-skill"]');
    if (!btn) return;
    await fetch('/api/skills?name=' + encodeURIComponent(btn.dataset.skill), { method: 'DELETE' });
    overlay.remove();
    loadSkillCount();
    showSkills();
  });
  document.body.appendChild(overlay);
}

// ===== Image Generation =====
let genRefImages = []; // [{name, path, thumbUrl}]
let genOverlay = null;

function openImageGen() {
  genRefImages = [];
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay gen-overlay';
  genOverlay = overlay;

  overlay.innerHTML = `<div class="gen-panel">
    <div class="gen-header">
      <h3>🎨 生图</h3>
      <button class="gen-close" onclick="closeImageGen()">✕</button>
    </div>
    <div class="gen-body">
      <div class="gen-left">
        <div class="gen-refs-label">参考图 <span class="gen-refs-count">0</span></div>
        <div class="gen-refs-drop" id="genRefsDrop">
          拖拽 / 粘贴 / 点击添加参考图
          <input type="file" accept="image/*" multiple style="display:none" id="genRefsInput">
        </div>
        <div class="gen-refs-list" id="genRefsList"></div>
        <div class="gen-refs-ws">
          <button onclick="pickWorkspaceRef()">从素材库选取</button>
        </div>
      </div>
      <div class="gen-right">
        <div class="gen-refs-hint" id="genRefsHint" style="display:none"></div>
        <textarea class="gen-prompt" id="genPrompt" placeholder="描述你要生成的图片…&#10;&#10;有参考图时用 [1] [2] 引用，如：&#10;  参考[1]的风格，画一个拿剑的骑士&#10;  把[1]绘制到[2]的场景中&#10;  基于[1]生成4个不同角度的视图" rows="6"></textarea>
        <div class="gen-options">
          <label>比例:
            <select id="genRatio">
              <option value="">默认</option>
              <option value="1:1">1:1</option>
              <option value="2:3">2:3</option>
              <option value="3:2">3:2</option>
              <option value="3:4">3:4</option>
              <option value="4:3">4:3</option>
              <option value="9:16">9:16</option>
              <option value="16:9">16:9</option>
            </select>
          </label>
          <label>尺寸:
            <select id="genSize">
              <option value="">默认</option>
              <option value="1K">1K</option>
              <option value="2K">2K</option>
              <option value="4K">4K</option>
            </select>
          </label>
        </div>
        <button class="gen-btn" id="genBtn" onclick="doGenerate()">✨ 生成</button>
        <div class="gen-result" id="genResult"></div>
      </div>
    </div>
  </div>`;

  document.body.appendChild(overlay);

  // 拖拽
  const drop = overlay.querySelector('#genRefsDrop');
  drop.addEventListener('click', () => overlay.querySelector('#genRefsInput').click());
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('dragover'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('dragover'); handleGenFiles(e.dataTransfer.files); });
  overlay.querySelector('#genRefsInput').addEventListener('change', (e) => handleGenFiles(e.target.files));

  // 粘贴（全局）
  overlay._pasteHandler = (e) => {
    if (!document.body.contains(overlay)) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    const files = [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) { e.preventDefault(); handleGenFiles(files); }
  };
  document.addEventListener('paste', overlay._pasteHandler);

  // 点击外部关闭
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeImageGen(); });
}

function closeImageGen() {
  if (genOverlay) {
    document.removeEventListener('paste', genOverlay._pasteHandler);
    genOverlay.remove();
    genOverlay = null;
  }
}

async function handleGenFiles(fileList) {
  for (const file of fileList) {
    if (!file.type.startsWith('image/')) continue;
    // 先上传到 workspace 作为 ref
    const reader = new FileReader();
    const dataUrl = await new Promise(r => { reader.onload = () => r(reader.result); reader.readAsDataURL(file); });
    const base64 = dataUrl.split(',')[1];
    const ext = file.name.split('.').pop() || 'png';
    const safeName = (file.name || `paste.${ext}`).replace(/[<>:"|?*]/g, '');
    try {
      const res = await fetch('/api/upload-ref', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: base64, name: safeName }),
      }).then(r => r.json());
      if (res.ok) {
        genRefImages.push({ name: res.name, path: res.path, thumbUrl: '/workspace/' + res.name });
        renderGenRefs();
      }
    } catch (e) { console.error('Upload ref failed:', e); }
  }
}

function addWorkspaceRef(fileName, filePath) {
  // 避免重复
  if (genRefImages.find(r => r.path === filePath)) return;
  genRefImages.push({ name: fileName, path: filePath, thumbUrl: '/workspace/' + fileName });
  renderGenRefs();
}

function renderGenRefs() {
  const list = document.querySelector('#genRefsList');
  const count = document.querySelector('.gen-refs-count');
  const hint = document.querySelector('#genRefsHint');
  if (!list || !count) return;
  count.textContent = genRefImages.length;
  list.innerHTML = genRefImages.map((r, i) => `
    <div class="gen-ref-item">
      <span class="gen-ref-num" onclick="insertRefTag(${i + 1})" title="点击插入 [${i + 1}] 到提示词">[${i + 1}]</span>
      <img src="${r.thumbUrl}" title="${r.name}">
      <button class="gen-ref-remove" onclick="removeGenRef(${i})">✕</button>
    </div>
  `).join('');
  // 动态提示
  if (hint) {
    if (genRefImages.length === 0) {
      hint.style.display = 'none';
    } else {
      hint.style.display = '';
      const tags = genRefImages.map((r, i) => `<code>[${i + 1}]</code>=${shortName(r.name)}`).join('　');
      hint.innerHTML = `💡 提示词中用 ${tags}　引用参考图。<em>点击编号可快速插入。</em>`;
    }
  }
}

function shortName(name) {
  const n = name.replace(/^ref_\d+_/, '');
  return n.length > 15 ? n.slice(0, 12) + '…' : n;
}

function insertRefTag(num) {
  const ta = document.querySelector('#genPrompt');
  if (!ta) return;
  const tag = `[${num}]`;
  const pos = ta.selectionStart || ta.value.length;
  ta.value = ta.value.slice(0, pos) + tag + ta.value.slice(pos);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = pos + tag.length;
}

function removeGenRef(idx) {
  genRefImages.splice(idx, 1);
  renderGenRefs();
}

function pickWorkspaceRef() {
  // 弹出 workspace 图片列表让用户选
  const imgs = allFiles.filter(f => isImage(f.name));
  if (!imgs.length) { alert('素材库中没有图片'); return; }

  const picker = document.createElement('div');
  picker.className = 'modal-overlay';
  picker.innerHTML = `<div class="modal" style="min-width:600px;max-height:80vh;overflow-y:auto">
    <h3>选取参考图</h3>
    <div class="ws-picker-grid">${imgs.map(f =>
      `<img src="/workspace/${f.name}" class="ws-picker-img" data-name="${f.name}" data-path="${f.path.replace(/\\/g, '/')}" title="${f.name}">`
    ).join('')}</div>
    <div class="btns"><button class="cancel" onclick="this.closest('.modal-overlay').remove()">关闭</button></div>
  </div>`;

  picker.addEventListener('click', (e) => {
    const img = e.target.closest('.ws-picker-img');
    if (!img) return;
    addWorkspaceRef(img.dataset.name, img.dataset.path);
    img.style.opacity = '0.4';
    img.style.pointerEvents = 'none';
  });

  document.body.appendChild(picker);
}

async function doGenerate() {
  const prompt = document.querySelector('#genPrompt')?.value.trim();
  if (!prompt) { alert('请输入提示词'); return; }
  const btn = document.querySelector('#genBtn');
  const result = document.querySelector('#genResult');
  const ratio = document.querySelector('#genRatio')?.value;
  const size = document.querySelector('#genSize')?.value;

  btn.disabled = true;
  btn.textContent = '⏳ 生成中…';
  result.innerHTML = '<div class="gen-loading">生成中，请稍候…</div>';

  const options = {};
  if (ratio) options.aspectRatio = ratio;
  if (size) options.imageSize = size;

  const images = genRefImages.map(r => r.path);

  try {
    const res = await fetch('/api/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, images, options }),
    }).then(r => r.json());

    if (res.error) {
      result.innerHTML = `<div class="gen-error">❌ ${esc(res.error)}</div>`;
    } else {
      const imgSrc = '/workspace/' + res.name + '?t=' + Date.now();
      result.innerHTML = `<div class="gen-success">
        <div class="gen-success-label">✅ 已生成: ${esc(res.name)}</div>
        <img src="${imgSrc}" class="gen-result-img" onclick="lightbox('${imgSrc}', false)">
      </div>`;
      lastFileHash = '';
      refreshFiles();
    }
  } catch (e) {
    result.innerHTML = `<div class="gen-error">❌ ${esc(e.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '✨ 生成';
  }
}

init();
loadSkillCount();
