// ===== Markdown Setup =====
marked.setOptions({ breaks: true, gfm: true, highlight: (code, lang) => {
  if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value;
  return hljs.highlightAuto(code).value;
}});

// ===== State =====
let currentNovel = '';
let lastEventsJSON = '';
let pollTimer = null;
let pollRunning = false;
let activeTab = 'dashboard';

// ===== DOM Refs =====
const shelfList = document.getElementById('shelf-list');
const novelTitle = document.getElementById('novel-title');
const costBar = document.getElementById('cost-bar');
const eventsDiv = document.getElementById('events');
const msgInput = document.getElementById('msg');
const stopBtn = document.getElementById('stop-btn');
const tabDashboard = document.getElementById('tab-dashboard');
const tabManuscript = document.getElementById('tab-manuscript');

// ===== Helpers =====
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function md(text) { try { return marked.parse(text || ''); } catch { return esc(text || ''); } }

function isNearBottom() {
  return eventsDiv.scrollHeight - eventsDiv.scrollTop - eventsDiv.clientHeight < 80;
}

// ===== Bookshelf =====
async function loadNovels() {
  try {
    const res = await fetch('/api/novels');
    const list = await res.json();
    shelfList.innerHTML = '';
    for (const name of list) {
      const el = document.createElement('div');
      el.className = 'shelf-item' + (name === currentNovel ? ' active' : '');
      el.textContent = name;
      el.onclick = () => switchNovel(name);
      shelfList.appendChild(el);
    }
    if (list.length > 0 && !currentNovel) switchNovel(list[0]);
  } catch {}
}

function switchNovel(name) {
  currentNovel = name;
  novelTitle.textContent = name;
  novelBasePath = '';
  lastEventsJSON = '';
  lastDashJSON = '';
  eventsDiv.innerHTML = '';
  costBar.innerHTML = '';
  loadNovels(); // re-render active state
  poll();
  pollDashboard();
  pollUsage();
}

// ===== Create Novel =====
function createNovel() {
  document.getElementById('create-dialog').style.display = '';
  document.getElementById('create-name').value = '';
  document.getElementById('create-name').focus();
}
function closeCreate() { document.getElementById('create-dialog').style.display = 'none'; }
async function confirmCreate() {
  const name = document.getElementById('create-name').value.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '');
  if (!name) return;
  closeCreate();
  await fetch('/api/novels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  switchNovel(name);
}

// ===== Panel Toggle (mobile) =====
function togglePanel() {
  const panel = document.getElementById('panel');
  panel.classList.toggle('mobile-open');
  if (panel.classList.contains('mobile-open')) pollDashboard();
}

// ===== Tab Switching =====
function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.panel-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));
  if (tab === 'dashboard') pollDashboard();
  if (tab === 'manuscript') pollDashboard(); // same data source
}

// ===== Event Rendering =====
function renderSingleEvent(e) {
  const div = document.createElement('div');

  if (e.type === 'user') {
    div.className = 'event user';
    div.innerHTML = '<div class="label">You</div>' + esc(e.content);
    return div;
  }

  if (e.type === 'action' && e.tool === 'speak') {
    div.className = 'event speak';
    div.innerHTML = '<div class="label">Assistant</div><div class="md-content">' + md(e.output) + '</div>';
    return div;
  }

  if (e.type === 'action' && e.tool === 'think') {
    div.className = 'event think collapsed';
    if (e.ts) div.dataset.ts = e.ts;
    const content = typeof e.output === 'string' ? e.output : (typeof e.input === 'string' ? e.input : '');
    div.innerHTML = '<div class="think-header" onclick="this.parentElement.classList.toggle(\'collapsed\')">'
      + '<span class="think-toggle">▶</span> <span class="label">💭 思考</span>'
      + '<span class="think-preview">' + esc(content.slice(0, 80)) + '</span></div>'
      + '<div class="think-body"><div class="md-content">' + md(content) + '</div></div>';
    return div;
  }

  if (e.type === 'action' && e.tool === 'commit' && !e.error) {
    div.className = 'commit-sep';
    const title = e.input && e.input.title || '';
    const changes = e.input && Array.isArray(e.input.changes) ? e.input.changes : [];
    let inner = '<span class="commit-label">✓ commit</span> ' + esc(title);
    if (changes.length > 0) {
      inner += '<span class="commit-changes">' + changes.map(c => esc(c)).join(', ') + '</span>';
    }
    div.innerHTML = inner;
    return div;
  }

  if (e.type === 'error') {
    div.className = 'event error';
    div.innerHTML = '<div class="label">⚠ Error</div>' + esc(e.message || '')
      + '<button class="retry-btn" onclick="retry()">重试</button>';
    return div;
  }

  if (e.type === 'action' && e.error) {
    div.className = 'event error';
    div.innerHTML = '<div class="label">⚠ ' + esc(e.tool) + '</div>' + esc(e.output || '');
    return div;
  }

  // test_style — full card with prompt header + md body
  if (e.type === 'action' && e.tool === 'test_style' && !e.error) {
    div.className = 'event style-test';
    const prompt = e.input?.prompt || '';
    div.innerHTML = '<div class="style-test-prompt">🎨 ' + esc(prompt) + '</div>'
      + '<div class="style-test-output md-content">' + md(e.output || '') + '</div>';
    return div;
  }

  // Generic tool events (collapsed)
  if (e.type === 'action' && e.tool !== 'stop' && e.tool !== 'commit') {
    div.className = 'event tool';
    const inputStr = typeof e.input === 'string' ? e.input : JSON.stringify(e.input);
    const outputStr = String(e.output);
    div.innerHTML = '<div class="label">' + esc(e.tool) + '</div>'
      + '<div class="tool-input">' + esc(inputStr) + '</div>'
      + '<div class="tool-output">' + esc(outputStr) + '</div>';
    return div;
  }

  return null;
}

function renderEvents(events) {
  const expandedThinks = new Set();
  eventsDiv.querySelectorAll('.event.think:not(.collapsed)').forEach(el => {
    if (el.dataset.ts) expandedThinks.add(el.dataset.ts);
  });

  eventsDiv.innerHTML = '';
  for (const e of events) {
    const el = renderSingleEvent(e);
    if (el) eventsDiv.appendChild(el);
  }

  if (expandedThinks.size > 0) {
    eventsDiv.querySelectorAll('.event.think[data-ts]').forEach(el => {
      if (expandedThinks.has(el.dataset.ts)) el.classList.remove('collapsed');
    });
  }
}

function tryIncrementalUpdate(prev, next) {
  if (!prev || prev.length === 0 || prev.length !== next.length) return false;
  for (let i = 0; i < next.length - 1; i++) {
    if (prev[i].ts !== next[i].ts) return false;
  }
  const last = next[next.length - 1], prevLast = prev[prev.length - 1];
  if (last.ts !== prevLast.ts || last.type !== prevLast.type || last.tool !== prevLast.tool) return false;

  const children = eventsDiv.children;
  if (!children.length) return false;
  const lastEl = children[children.length - 1];

  if (last.type === 'action' && last.tool === 'speak' && lastEl.classList.contains('speak')) {
    const mdDiv = lastEl.querySelector('.md-content');
    if (mdDiv) { mdDiv.innerHTML = md(last.output); return true; }
  }
  if (last.type === 'action' && last.tool === 'think' && lastEl.classList.contains('think')) {
    const body = lastEl.querySelector('.think-body .md-content');
    const preview = lastEl.querySelector('.think-preview');
    if (body) {
      const c = typeof last.output === 'string' ? last.output : (typeof last.input === 'string' ? last.input : '');
      body.innerHTML = md(c);
      if (preview) preview.textContent = c.slice(0, 80);
      return true;
    }
  }
  if (last.type === 'action' && last.tool === 'test_style' && lastEl.classList.contains('style-test')) {
    const out = lastEl.querySelector('.style-test-output');
    if (out) { out.innerHTML = md(last.output || ''); return true; }
  }
  if (last.type === 'action' && lastEl.classList.contains('tool')) {
    const inp = lastEl.querySelector('.tool-input'), out = lastEl.querySelector('.tool-output');
    if (inp && out) {
      inp.textContent = typeof last.input === 'string' ? last.input : JSON.stringify(last.input);
      out.textContent = String(last.output);
      return true;
    }
  }
  return false;
}

// ===== Polling =====
let prevEvents = [];
let allEvents = [];

async function poll() {
  if (pollRunning || !currentNovel) return;
  pollRunning = true;
  try {
    const wasBottom = isNearBottom();
    const res = await fetch('/api/events?novel=' + encodeURIComponent(currentNovel));
    const data = await res.json();
    allEvents = data.events;
    // Truncate at last commit — match novel agent's hooks.events
    let visible = data.events;
    for (let i = visible.length - 1; i >= 0; i--) {
      if (visible[i].type === 'action' && visible[i].tool === 'commit' && !visible[i].error) {
        visible = visible.slice(i + 1);
        break;
      }
    }
    const json = JSON.stringify(visible);
    if (json !== lastEventsJSON) {
      const prev = prevEvents;
      lastEventsJSON = json;
      prevEvents = visible;
      if (!tryIncrementalUpdate(prev, visible)) renderEvents(visible);
      if (wasBottom) eventsDiv.scrollTop = eventsDiv.scrollHeight;
    }
    stopBtn.style.display = data.running ? '' : 'none';
    const interval = data.running ? 100 : 300;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(poll, interval);
  } catch {}
  pollRunning = false;
}

// ===== Dashboard =====
let lastDashJSON = '';

async function pollDashboard() {
  if (!currentNovel) return;
  try {
    const res = await fetch('/api/novel-data?novel=' + encodeURIComponent(currentNovel));
    const data = await res.json();
    const json = JSON.stringify(data);
    if (json === lastDashJSON) return;
    lastDashJSON = json;
    renderDashboard(data);
    renderManuscript(data);
  } catch {}
}

function renderDashboard(data) {
  let html = '';

  // Outline
  html += '<div class="dash-section dash-outline"><div class="dash-section-title">📋 大纲 <button class="dash-edit-btn" onclick="editNovelFile(\'大纲\', \'outline.md\')">✏️</button></div>';
  html += data.outline ? '<div class="md-content">' + md(data.outline) + '</div>' : '<div class="dash-empty">尚未创建大纲 <button class="dash-edit-btn" onclick="editNovelFile(\'大纲\', \'outline.md\')">✏️ 创建</button></div>';
  html += '</div>';

  // Style
  html += '<div class="dash-section"><div class="dash-section-title">✍️ 文风 <button class="dash-edit-btn" onclick="editNovelFile(\'文风\', \'style.md\')">✏️</button></div>';
  html += data.style ? '<div class="md-content">' + md(data.style) + '</div>' : '<div class="dash-empty">尚未设定文风 <button class="dash-edit-btn" onclick="editNovelFile(\'文风\', \'style.md\')">✏️ 创建</button></div>';
  html += '</div>';

  // Entities
  html += '<div class="dash-section"><div class="dash-section-title">🎭 实体</div>';
  if (data.entities && data.entities.length > 0) {
    html += '<div class="card-grid">';
    for (const e of data.entities) {
      const st = e.meta?.status || 'active';
      html += '<div class="entity-card" onclick="openWorld(\'entities\',\'' + esc(e.name) + '\')"><div class="card-name">' + esc(e.name)
        + ' <span class="status-badge status-' + st + '">' + st + '</span></div>'
        + '<div class="card-body">' + esc(e.body.slice(0, 100)) + '</div></div>';
    }
    html += '</div>';
  } else { html += '<div class="dash-empty">暂无实体</div>'; }
  html += '</div>';

  // Relations
  html += '<div class="dash-section"><div class="dash-section-title">🔗 关联</div>';
  if (data.relations && data.relations.length > 0) {
    html += '<div class="card-grid">';
    for (const r of data.relations) {
      const st = r.meta?.status || 'active';
      const inv = Array.isArray(r.meta?.involves) ? r.meta.involves.join(', ') : '';
      html += '<div class="relation-card" onclick="openWorld(\'relations\',\'' + esc(r.name) + '\')"><div class="card-name">' + esc(r.name)
        + ' <span class="status-badge status-' + st + '">' + st + '</span></div>'
        + (inv ? '<div class="card-involves">↔ ' + esc(inv) + '</div>' : '')
        + '<div class="card-body">' + esc(r.body.slice(0, 100)) + '</div></div>';
    }
    html += '</div>';
  } else { html += '<div class="dash-empty">暂无关联</div>'; }
  html += '</div>';

  // Histories
  html += '<div class="dash-section"><div class="dash-section-title">📝 经历档案</div>';
  if (data.histories && data.histories.length > 0) {
    for (let i = 0; i < data.histories.length; i++) {
      const h = data.histories[i];
      const title = h.meta?.title || h.meta?.summary || h.name;
      const changes = Array.isArray(h.meta?.changes) ? h.meta.changes.join(', ') : '';
      html += '<div class="history-item">'
        + '<div class="history-header">'
        + '<strong>v' + (i + 1) + '</strong>: ' + esc(title)
        + ' <button class="history-events-btn" onclick="event.stopPropagation();openHistoryEvents(' + i + ')" title="查看事件">📋</button>'
        + '</div>';
      if (changes) html += '<div class="history-changes">' + esc(changes) + '</div>';
      html += '</div>';
    }
  } else { html += '<div class="dash-empty">暂无经历</div>'; }
  html += '</div>';

  tabDashboard.innerHTML = html;
}

function renderManuscript(data) {
  let html = '';
  if (data.chapters && data.chapters.length > 0) {
    html += '<div class="chapter-list">';
    for (const ch of data.chapters) {
      html += '<div class="chapter-item" onclick="openChapter(\'' + esc(currentNovel) + "','" + esc(ch.volume) + "','" + esc(ch.file) + '\')">'
        + '<span class="chapter-vol">' + esc(ch.volume) + '</span> ' + esc(ch.name) + '</div>';
    }
    html += '</div>';
  } else {
    html += '<div class="dash-empty" style="padding:20px">尚未开始写作</div>';
  }
  tabManuscript.innerHTML = html;
}

// ===== Chapter Reader =====
let novelBasePath = ''; // cached from server
let readerRawContent = ''; // raw content for inline editing

async function ensureNovelPath() {
  if (novelBasePath) return novelBasePath;
  try {
    const res = await fetch('/api/novel-path?novel=' + encodeURIComponent(currentNovel));
    const data = await res.json();
    novelBasePath = data.path;
    return novelBasePath;
  } catch { return ''; }
}

async function openChapter(novel, vol, file) {
  const base = await ensureNovelPath();
  if (!base) return;
  const filePath = base + '\\chapters\\' + vol + '\\' + file;
  try {
    const res = await fetch('/api/file?path=' + encodeURIComponent(filePath));
    const data = await res.json();
    readerRawContent = data.content || '';
    document.getElementById('reader-title').textContent = '📖 ' + file.replace(/\.md$/, '');
    document.getElementById('reader-content').innerHTML = '<div class="md-content">' + md(readerRawContent) + '</div>';
    document.getElementById('reader-content').style.display = '';
    document.getElementById('reader-editor').style.display = 'none';
    document.getElementById('reader-buttons').innerHTML =
      '<button onclick="editChapter()">✏️ 编辑</button><button onclick="closeReader()">关闭</button>';
    document.getElementById('reader-dialog').style.display = '';
    document.getElementById('reader-dialog').dataset.path = filePath;
  } catch {}
}

function editChapter() {
  document.getElementById('reader-content').style.display = 'none';
  const ed = document.getElementById('reader-editor');
  ed.style.display = '';
  ed.value = readerRawContent;
  document.getElementById('reader-buttons').innerHTML =
    '<button class="primary" onclick="saveChapter()">💾 保存</button><button onclick="cancelChapterEdit()">取消</button>';
  ed.focus();
}

async function saveChapter() {
  const filePath = document.getElementById('reader-dialog').dataset.path;
  if (!filePath) return;
  const content = document.getElementById('reader-editor').value;
  try {
    await fetch('/api/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content }),
    });
    readerRawContent = content;
    document.getElementById('reader-content').innerHTML = '<div class="md-content">' + md(content) + '</div>';
    cancelChapterEdit();
    pollDashboard();
  } catch (e) { alert('保存失败: ' + e.message); }
}

function cancelChapterEdit() {
  document.getElementById('reader-content').style.display = '';
  document.getElementById('reader-editor').style.display = 'none';
  document.getElementById('reader-buttons').innerHTML =
    '<button onclick="editChapter()">✏️ 编辑</button><button onclick="closeReader()">关闭</button>';
}

function closeReader() { document.getElementById('reader-dialog').style.display = 'none'; }

// ===== Cost =====
const PRICING = { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 };

function calcCost(e) {
  const input = (e.input_tokens || 0) - (e.cache_read_input_tokens || 0) - (e.cache_creation_input_tokens || 0);
  const output = e.output_tokens || 0;
  const cost = (Math.max(0, input) * PRICING.input + output * PRICING.output
    + (e.cache_read_input_tokens || 0) * PRICING.cache_read
    + (e.cache_creation_input_tokens || 0) * PRICING.cache_write) / 1e6;
  const noCacheCost = ((e.input_tokens || 0) * PRICING.input + output * PRICING.output) / 1e6;
  return { cost, saved: noCacheCost - cost };
}

async function pollUsage() {
  if (!currentNovel) return;
  try {
    const res = await fetch('/api/usage?novel=' + encodeURIComponent(currentNovel));
    const entries = await res.json();
    if (!entries.length) { costBar.innerHTML = ''; return; }
    let total = 0, totalSaved = 0;
    for (const e of entries) { const c = calcCost(e); total += c.cost; totalSaved += c.saved; }
    const last = calcCost(entries[entries.length - 1]);
    costBar.innerHTML = '<span class="cost-total">$' + total.toFixed(4) + '</span>'
      + (totalSaved > 0 ? '<span class="cost-saved">省 $' + totalSaved.toFixed(4) + '</span>' : '')
      + '<span class="cost-last">本次 $' + last.cost.toFixed(4) + '</span>';
  } catch {}
}

// ===== History Events Viewer =====
function openHistoryEvents(index) {
  const commits = [];
  for (let i = 0; i < allEvents.length; i++) {
    if (allEvents[i].type === 'action' && allEvents[i].tool === 'commit' && !allEvents[i].error) {
      commits.push(i);
    }
  }
  const start = index === 0 ? 0 : (commits[index - 1] != null ? commits[index - 1] + 1 : 0);
  const end = commits[index] != null ? commits[index] + 1 : allEvents.length;
  const segment = allEvents.slice(start, end);

  const container = document.getElementById('history-events-content');
  container.innerHTML = '';
  for (const e of segment) {
    const el = renderSingleEvent(e);
    if (el) container.appendChild(el);
  }
  document.getElementById('history-events-title').textContent = '📋 v' + (index + 1) + ' 事件记录';
  document.getElementById('history-events-dialog').style.display = '';
}

function closeHistoryEvents() {
  document.getElementById('history-events-dialog').style.display = 'none';
}

// ===== Send / Stop / Retry =====
async function send() {
  const text = msgInput.value.trim();
  if (!text || !currentNovel) return;
  msgInput.value = '';
  await fetch('/api/events?novel=' + encodeURIComponent(currentNovel), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: text }),
  });
}

async function retry() {
  if (!currentNovel) return;
  await fetch('/api/events?novel=' + encodeURIComponent(currentNovel), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ retry: true }),
  });
  poll();
}

async function stopLoop() {
  if (!currentNovel) return;
  stopBtn.disabled = true;
  try {
    await fetch('/api/loop?novel=' + encodeURIComponent(currentNovel), { method: 'DELETE' });
    poll();
  } finally { stopBtn.disabled = false; }
}

// ===== World Browser =====
let worldData = { entities: [], relations: [] };
let worldTab = 'entities';
let worldEditPath = '';
let worldEditName = '';

function openWorld(type, name) {
  worldData = JSON.parse(lastDashJSON || '{}');
  worldTab = type;
  document.getElementById('world-dialog').style.display = '';
  renderWorldSidebar();
  selectWorldItem(name);
}

function closeWorld() { document.getElementById('world-dialog').style.display = 'none'; }

function switchWorldTab(type) {
  worldTab = type;
  document.querySelectorAll('.world-tab').forEach(t => t.classList.toggle('active', t.dataset.type === type));
  renderWorldSidebar();
  const items = worldTab === 'entities' ? (worldData.entities || []) : (worldData.relations || []);
  if (items.length > 0) selectWorldItem(items[0].name);
  else { document.getElementById('world-item-name').textContent = ''; document.getElementById('world-item-badge').innerHTML = ''; document.getElementById('world-item-content').innerHTML = '<div class="dash-empty">暂无内容</div>'; }
}

function renderWorldSidebar() {
  const items = worldTab === 'entities' ? (worldData.entities || []) : (worldData.relations || []);
  const list = document.getElementById('world-list');
  list.innerHTML = '';
  for (const item of items) {
    const el = document.createElement('div');
    el.className = 'world-list-item';
    el.dataset.name = item.name;
    const st = item.meta?.status || 'active';
    el.innerHTML = esc(item.name) + ' <span class="status-badge status-' + st + '">' + st + '</span>';
    el.onclick = () => selectWorldItem(item.name);
    list.appendChild(el);
  }
}

function selectWorldItem(name) {
  const items = worldTab === 'entities' ? (worldData.entities || []) : (worldData.relations || []);
  const item = items.find(i => i.name === name);
  if (!item) return;
  document.getElementById('world-item-name').textContent = item.name;
  const st = item.meta?.status || 'active';
  document.getElementById('world-item-badge').innerHTML = '<span class="status-badge status-' + st + '">' + st + '</span>'
    + ' <button class="world-edit-btn" onclick="editWorldItem(\'' + esc(worldTab) + '\',\'' + esc(item.name) + '\')">✏️ 编辑</button>';
  const inv = Array.isArray(item.meta?.involves) ? '<div class="world-involves">↔ ' + esc(item.meta.involves.join(', ')) + '</div>' : '';
  document.getElementById('world-item-content').innerHTML = inv + '<div class="md-content">' + md(item.body) + '</div>';
  document.querySelectorAll('.world-list-item').forEach(el => el.classList.toggle('active', el.dataset.name === name));
}

async function editWorldItem(type, name) {
  const base = await ensureNovelPath();
  if (!base) return;
  worldEditPath = base + '\\world\\' + type + '\\' + name + '.md';
  worldEditName = name;
  try {
    const res = await fetch('/api/file?path=' + encodeURIComponent(worldEditPath));
    const data = await res.json();
    document.getElementById('world-item-content').style.display = 'none';
    const ed = document.getElementById('world-editor');
    ed.style.display = '';
    ed.value = data.content || '';
    document.getElementById('world-item-badge').innerHTML =
      '<button class="world-edit-btn" style="border-color:#9ece6a;color:#9ece6a" onclick="saveWorldItem()">💾 保存</button>'
      + ' <button class="world-edit-btn" onclick="cancelWorldEdit()">取消</button>';
    ed.focus();
  } catch {}
}

async function saveWorldItem() {
  if (!worldEditPath) return;
  const content = document.getElementById('world-editor').value;
  try {
    await fetch('/api/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: worldEditPath, content }),
    });
    document.getElementById('world-item-content').style.display = '';
    document.getElementById('world-editor').style.display = 'none';
    await pollDashboard();
    worldData = JSON.parse(lastDashJSON || '{}');
    selectWorldItem(worldEditName);
    worldEditPath = '';
  } catch (e) { alert('保存失败: ' + e.message); }
}

function cancelWorldEdit() {
  document.getElementById('world-item-content').style.display = '';
  document.getElementById('world-editor').style.display = 'none';
  selectWorldItem(worldEditName);
  worldEditPath = '';
}

// ===== File Editor =====
let editorPath = '';

async function openEditor(title, filePath) {
  editorPath = filePath;
  document.getElementById('editor-title').textContent = '✏️ ' + title;
  try {
    const res = await fetch('/api/file?path=' + encodeURIComponent(filePath));
    const data = await res.json();
    document.getElementById('editor-area').value = data.content || '';
  } catch {
    document.getElementById('editor-area').value = '';
  }
  document.getElementById('editor-dialog').style.display = '';
  document.getElementById('editor-area').focus();
}

function closeEditor() {
  document.getElementById('editor-dialog').style.display = 'none';
  editorPath = '';
}

async function saveEditor() {
  if (!editorPath) return;
  const content = document.getElementById('editor-area').value;
  try {
    await fetch('/api/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: editorPath, content }),
    });
    closeEditor();
    pollDashboard();
  } catch (e) { alert('保存失败: ' + e.message); }
}

// Shared editor keyboard: Ctrl+S save, Tab indent
function handleEditorKeydown(e, saveFn) {
  if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveFn(); }
  if (e.key === 'Tab') {
    e.preventDefault();
    const ta = e.target, start = ta.selectionStart, end = ta.selectionEnd;
    ta.value = ta.value.substring(0, start) + '  ' + ta.value.substring(end);
    ta.selectionStart = ta.selectionEnd = start + 2;
  }
}
document.getElementById('editor-area').addEventListener('keydown', e => handleEditorKeydown(e, saveEditor));
document.getElementById('reader-editor').addEventListener('keydown', e => handleEditorKeydown(e, saveChapter));
document.getElementById('world-editor').addEventListener('keydown', e => handleEditorKeydown(e, saveWorldItem));

async function editNovelFile(title, relativePath) {
  const base = await ensureNovelPath();
  if (!base) return;
  openEditor(title, base + '\\' + relativePath.replace(/\//g, '\\'));
}

// ===== Events =====
document.getElementById('send-btn').addEventListener('click', send);
msgInput.addEventListener('keydown', e => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); send(); } });
document.getElementById('create-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') confirmCreate();
  if (e.key === 'Escape') closeCreate();
});

// ===== Init =====
loadNovels();
setInterval(pollDashboard, 3000);
setInterval(pollUsage, 5000);
