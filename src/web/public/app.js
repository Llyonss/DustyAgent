// ===== Markdown Setup =====
marked.setOptions({
  breaks: true,
  gfm: true,
  highlight: function (code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  },
});

// ===== DOM Refs =====
const tabBar = document.getElementById('tab-bar');
const costBar = document.getElementById('cost-bar');
const agentBadge = document.getElementById('agent-badge');
const eventsDiv = document.getElementById('events');
const msgInput = document.getElementById('msg');
const sendBtn = document.getElementById('send-btn');
const stopBtn = document.getElementById('stop-btn');
const createDialog = document.getElementById('create-dialog');
const createNameInput = document.getElementById('create-name');
const docBtn = document.getElementById('doc-btn');
const docDialog = document.getElementById('doc-dialog');
const docDialogContent = document.getElementById('doc-dialog-content');
const docCol = document.getElementById('doc-col');
const docColContent = document.getElementById('doc-col-content');

// ===== State =====
let currentInstance = 'default';
let currentAgent = 'default';
let knownEventCount = 0;
let knownLastOutput = '';  // track last event output for streaming detection

// ===== Pricing (per M tokens) =====
const PRICING = {
  input: 5,
  output: 25,
  cache_read: 0.5,
  cache_write: 6.25,
};

function calcCost(entry) {
  const input = (entry.input_tokens || 0) - (entry.cache_read_input_tokens || 0) - (entry.cache_creation_input_tokens || 0);
  const output = entry.output_tokens || 0;
  const cacheRead = entry.cache_read_input_tokens || 0;
  const cacheWrite = entry.cache_creation_input_tokens || 0;

  const cost = (Math.max(0, input) * PRICING.input + output * PRICING.output + cacheRead * PRICING.cache_read + cacheWrite * PRICING.cache_write) / 1e6;
  const noCacheCost = ((entry.input_tokens || 0) * PRICING.input + output * PRICING.output) / 1e6;
  return { cost, noCacheCost, saved: noCacheCost - cost };
}

function renderCostBar(entries) {
  if (!entries || entries.length === 0) {
    costBar.innerHTML = '';
    return;
  }

  let totalCost = 0;
  let totalNoCacheCost = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;

  for (const e of entries) {
    const c = calcCost(e);
    totalCost += c.cost;
    totalNoCacheCost += c.noCacheCost;
    totalInput += (e.input_tokens || 0);
    totalOutput += (e.output_tokens || 0);
    totalCacheRead += (e.cache_read_input_tokens || 0);
    totalCacheWrite += (e.cache_creation_input_tokens || 0);
  }

  const last = entries[entries.length - 1];
  const lastCalc = calcCost(last);
  const totalSaved = totalNoCacheCost - totalCost;

  costBar.innerHTML =
    '<span class="cost-total">累计 $' + totalCost.toFixed(4) + '</span>' +
    '<span class="cost-saved">已省 $' + totalSaved.toFixed(4) + '</span>' +
    '<span class="cost-last">本次 $' + lastCalc.cost.toFixed(4) +
    (lastCalc.saved > 0 ? ' <span class="cost-saved-tag">省 $' + lastCalc.saved.toFixed(4) + '</span>' : '') +
    '</span>' +
    '<span class="cost-tokens">输入 ' + fmtK(totalInput) + ' 输出 ' + fmtK(totalOutput) + ' 缓存 ' + fmtK(totalCacheRead) + '</span>';
}

function fmtK(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

// ===== Instance Switching =====
function switchInstance(name) {
  currentInstance = name;
  knownEventCount = 0;
  knownLastOutput = '';
  eventsDiv.innerHTML = '';
  costBar.innerHTML = '';
  agentBadge.textContent = '';
  renderTabs();
  poll();
  pollUsage();
  pollInfo();
}

async function loadInstances() {
  try {
    const res = await fetch('/api/instances');
    const list = await res.json();
    if (list.length === 0) {
      currentInstance = 'default';
      renderTabList([]);
      return;
    }
    if (!list.includes(currentInstance)) {
      switchInstance(list[0]);
      return;
    }
    renderTabList(list);
  } catch (e) { /* ignore */ }
}

function renderTabList(list) {
  const addBtn = tabBar.querySelector('.tab-add');
  tabBar.querySelectorAll('.tab').forEach(t => t.remove());

  for (const name of list) {
    const tab = document.createElement('div');
    tab.className = 'tab' + (name === currentInstance ? ' active' : '');
    tab.textContent = name;
    tab.onclick = () => switchInstance(name);
    tabBar.insertBefore(tab, addBtn);
  }
}

function renderTabs() {
  loadInstances();
}

// ===== Create Instance Dialog =====
function createInstance() {
  createNameInput.value = '';
  createDialog.style.display = '';
  createDialog.querySelector('.agent-option.selected')?.classList.remove('selected');
  createDialog.querySelector('[data-agent="default"]').classList.add('selected');
  createNameInput.focus();
}

function closeCreateDialog() {
  createDialog.style.display = 'none';
}

function selectAgent(el) {
  createDialog.querySelectorAll('.agent-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
}

async function confirmCreate() {
  const name = createNameInput.value.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
  if (!name) return;
  const agent = createDialog.querySelector('.agent-option.selected')?.dataset.agent || 'default';
  closeCreateDialog();

  await fetch('/api/instances', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, agent }),
  });

  switchInstance(name);
}

// ===== Agent Info & Doc Panel =====
function isPC() {
  return window.innerWidth > 768;
}

async function pollInfo() {
  try {
    const res = await fetch('/api/instance-info?instance=' + encodeURIComponent(currentInstance));
    const info = await res.json();
    currentAgent = info.agent || 'default';
    agentBadge.textContent = currentAgent === 'doc' ? '📄 doc' : '⚡ agent';
    agentBadge.className = 'badge-' + currentAgent;

    const isDoc = currentAgent === 'doc';
    docBtn.style.display = isDoc ? '' : 'none';
    document.body.classList.toggle('has-doc', isDoc);

    if (isDoc && isPC()) {
      docCol.style.display = '';
      refreshDocCol();
    } else {
      docCol.style.display = 'none';
    }
  } catch (e) { /* ignore */ }
}

async function refreshDocCol() {
  try {
    const res = await fetch('/api/doc?instance=' + encodeURIComponent(currentInstance));
    const data = await res.json();
    const text = data.content != null ? data.content : '';
    docColContent.innerHTML = text ? renderMarkdown(text) : '<p style="color:#666">（空文档）</p>';
  } catch (e) { /* ignore */ }
}

// ===== Doc Viewer (mobile dialog) =====
async function openDoc() {
  if (isPC()) {
    // On PC just refresh the side panel
    docCol.style.display = '';
    refreshDocCol();
    return;
  }
  try {
    const res = await fetch('/api/doc?instance=' + encodeURIComponent(currentInstance));
    const data = await res.json();
    const text = data.content != null ? data.content : '';
    docDialogContent.innerHTML = text ? renderMarkdown(text) : '<p style="color:#666">（空文档）</p>';
  } catch (e) {
    docDialogContent.innerHTML = '<p style="color:#e94560">加载失败</p>';
  }
  docDialog.style.display = '';
}

function closeDoc() {
  docDialog.style.display = 'none';
}

// ===== Render Event =====
function renderSingleEvent(e) {
  const div = document.createElement('div');

  if (e.type === 'user') {
    div.className = 'event user';
    div.innerHTML = '<div class="label">You</div>' + esc(e.content);
    return div;
  }

  if (e.type === 'action' && e.tool === 'speak') {
    div.className = 'event speak';
    div.innerHTML = '<div class="label">Assistant</div>'
      + '<div class="md-content">' + renderMarkdown(e.output) + '</div>';
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

  if (e.type === 'action' && e.tool !== 'stop' && e.tool !== 'wait' && e.tool !== 'commit') {
    div.className = 'event tool';
    const inputStr = JSON.stringify(e.input);
    const outputStr = String(e.output);
    div.innerHTML = '<div class="label">' + esc(e.tool) + '</div>'
      + '<div class="tool-input">' + esc(inputStr) + '</div>'
      + '<div class="tool-output">' + esc(outputStr) + '</div>';
    return div;
  }

  return null;
}

function renderEvents(events) {
  // Remember which commit sections were expanded before re-render
  const expandedSet = new Set();
  eventsDiv.querySelectorAll('.apply-section').forEach((el, i) => {
    if (!el.classList.contains('collapsed')) expandedSet.add(i);
  });

  eventsDiv.innerHTML = '';

  const segments = [];
  let current = [];
  for (const e of events) {
    if (e.type === 'action' && e.tool === 'commit' && !e.error) {
      segments.push({ events: current, commit: e });
      current = [];
    } else {
      current.push(e);
    }
  }
  if (current.length > 0) {
    segments.push({ events: current, commit: null });
  }

  let commitIndex = 0;
  for (const seg of segments) {
    if (seg.commit) {
      const isExpanded = expandedSet.has(commitIndex);
      commitIndex++;
      const wrapper = document.createElement('div');
      wrapper.className = 'apply-section' + (isExpanded ? '' : ' collapsed');

      const summary = seg.commit.input && seg.commit.input.summary || '';
      const header = document.createElement('div');
      header.className = 'apply-header';
      header.innerHTML = '<span class="apply-toggle">' + (isExpanded ? '\u25bc' : '\u25b6') + '</span> <span class="label">\ud83d\udcc4 \u6587\u6863\u5df2\u63d0\u4ea4</span> <span class="apply-summary">' + esc(summary) + '</span>';
      header.onclick = () => {
        wrapper.classList.toggle('collapsed');
        header.querySelector('.apply-toggle').textContent = wrapper.classList.contains('collapsed') ? '\u25b6' : '\u25bc';
      };

      const body = document.createElement('div');
      body.className = 'apply-section-body';
      for (const e of seg.events) {
        const el = renderSingleEvent(e);
        if (el) body.appendChild(el);
      }

      wrapper.appendChild(header);
      wrapper.appendChild(body);
      eventsDiv.appendChild(wrapper);
    } else {
      for (const e of seg.events) {
        const el = renderSingleEvent(e);
        if (el) eventsDiv.appendChild(el);
      }
    }
  }

  // Refresh doc panel if visible
  if (currentAgent === 'doc' && isPC() && docCol.style.display !== 'none') {
    refreshDocCol();
  }
}

// ===== Helpers =====
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function renderMarkdown(text) {
  try {
    return marked.parse(text || '');
  } catch (e) {
    return esc(text || '');
  }
}

function scrollToBottom() {
  eventsDiv.scrollTop = eventsDiv.scrollHeight;
}

// ===== Polling =====
function getLastOutput(events) {
  if (events.length === 0) return '';
  const last = events[events.length - 1];
  return String(last.output || last.content || last.message || '');
}

async function poll() {
  try {
    const res = await fetch('/api/events?instance=' + encodeURIComponent(currentInstance));
    const data = await res.json();
    const events = data.events;
    const lastOutput = getLastOutput(events);

    if (events.length !== knownEventCount) {
      // Event count changed — full re-render
      renderEvents(events);
      knownEventCount = events.length;
      knownLastOutput = lastOutput;
      scrollToBottom();
    } else if (lastOutput !== knownLastOutput) {
      // Same count but last event content changed (streaming speak)
      // Update only the last speak element in-place
      knownLastOutput = lastOutput;
      const last = events[events.length - 1];
      if (last && last.type === 'action' && last.tool === 'speak') {
        const speakEls = eventsDiv.querySelectorAll('.event.speak');
        const lastSpeakEl = speakEls[speakEls.length - 1];
        if (lastSpeakEl) {
          const mdDiv = lastSpeakEl.querySelector('.md-content');
          if (mdDiv) mdDiv.innerHTML = renderMarkdown(last.output);
        }
      }
      scrollToBottom();
    }
    stopBtn.style.display = data.running ? '' : 'none';
  } catch (e) { /* ignore */ }
}

async function pollUsage() {
  try {
    const res = await fetch('/api/usage?instance=' + encodeURIComponent(currentInstance));
    const entries = await res.json();
    renderCostBar(entries);
  } catch (e) { /* ignore */ }
}

// ===== Send Message =====
async function send() {
  const text = msgInput.value.trim();
  if (!text) return;
  msgInput.value = '';
  await fetch('/api/events?instance=' + encodeURIComponent(currentInstance), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: text }),
  });
}

// ===== Retry (restart loop without new message) =====
async function retry() {
  await fetch('/api/events?instance=' + encodeURIComponent(currentInstance), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

// ===== Stop Loop =====
async function stopLoop() {
  stopBtn.disabled = true;
  try {
    await fetch('/api/loop?instance=' + encodeURIComponent(currentInstance), { method: 'DELETE' });
    poll();
  } finally {
    stopBtn.disabled = false;
  }
}

// ===== Event Listeners =====
sendBtn.addEventListener('click', send);
stopBtn.addEventListener('click', stopLoop);
msgInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.ctrlKey) {
    e.preventDefault();
    send();
  }
});
createNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmCreate();
  if (e.key === 'Escape') closeCreateDialog();
});

window.addEventListener('resize', () => {
  if (currentAgent === 'doc') {
    docCol.style.display = isPC() ? '' : 'none';
  }
});

// ===== File Viewer =====
const fileDialog = document.getElementById('file-dialog');
const filePathInput = document.getElementById('file-path-input');
const fileDialogContent = document.getElementById('file-dialog-content');
const fileBackBtn = document.getElementById('file-back-btn');
let fileHistory = [];

async function openFile(filePath) {
  filePath = filePath.trim();
  if (!filePath) return;
  filePathInput.value = filePath;
  fileDialog.style.display = '';
  fileDialogContent.innerHTML = '<p style="color:#666">加载中...</p>';
  fileBackBtn.style.display = 'none';
  try {
    const res = await fetch('/api/file?path=' + encodeURIComponent(filePath));
    if (!res.ok) {
      const err = await res.json();
      fileDialogContent.innerHTML = '<p style="color:#e94560">' + esc(err.error || '加载失败') + '</p>';
      return;
    }
    const data = await res.json();
    renderFileContent(data);
  } catch (e) {
    fileDialogContent.innerHTML = '<p style="color:#e94560">加载失败</p>';
  }
}

function renderFileContent(data) {
  // Show back button if there's history
  fileBackBtn.style.display = fileHistory.length > 0 ? '' : 'none';

  if (data.type === 'directory') {
    const list = document.createElement('div');
    list.className = 'file-dir-list';
    if (data.entries.length === 0) {
      list.innerHTML = '<div class="file-dir-empty">（空目录）</div>';
    }
    for (const entry of data.entries) {
      const item = document.createElement('div');
      item.className = 'file-dir-item';
      const fullPath = data.path.replace(/[\\/]$/, '') + '\\' + entry.name;
      item.dataset.path = fullPath;
      item.innerHTML = '<span class="file-dir-icon">' + (entry.isDirectory ? '📁' : '📄') + '</span>' +
        '<span class="file-dir-name">' + esc(entry.name) + '</span>';
      item.onclick = () => navigateFile(fullPath);
      list.appendChild(item);
    }
    fileDialogContent.innerHTML = '';
    fileDialogContent.appendChild(list);
  } else {
    const ext = data.path.split('.').pop().toLowerCase();
    let highlighted;
    try {
      if (hljs.getLanguage(ext)) {
        highlighted = hljs.highlight(data.content, { language: ext }).value;
      } else {
        highlighted = hljs.highlightAuto(data.content).value;
      }
    } catch (e) {
      highlighted = esc(data.content);
    }
    const sizeStr = data.size > 1024 ? (data.size / 1024).toFixed(1) + ' KB' : data.size + ' B';
    fileDialogContent.innerHTML =
      '<div class="file-meta">' + esc(ext.toUpperCase()) + ' · ' + sizeStr + '</div>' +
      '<pre class="file-code"><code>' + highlighted + '</code></pre>';
  }
}

function navigateFile(fullPath) {
  const currentPath = filePathInput.value.trim();
  if (currentPath) fileHistory.push(currentPath);
  openFile(fullPath);
}

function fileGoBack() {
  if (fileHistory.length === 0) return;
  const prev = fileHistory.pop();
  openFile(prev);
}

function goFilePath() {
  const p = filePathInput.value.trim();
  if (!p) return;
  fileHistory.push(p);
  openFile(p);
}

function closeFile() {
  fileDialog.style.display = 'none';
  fileHistory = [];
}

filePathInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') goFilePath();
  if (e.key === 'Escape') closeFile();
});

// ===== File Path Detection =====
function linkifyPaths(html) {
  // Match Windows absolute paths like C:\... or D:\...
  // Process the HTML string and match paths outside of HTML tags
  return html.replace(/(<[^>]*>)|([A-Z]:\\[^\s<>"'\)\]]+)/gi, (match, tag, pathStr) => {
    if (tag) return tag; // inside an HTML tag, leave it alone
    // Clean trailing punctuation
    let clean = pathStr.replace(/[.,;:!?]+$/, '');
    // Use data-path attribute + class instead of inline onclick to avoid quote escaping issues
    return '<span class="file-link" data-path="' + escAttr(clean) + '">' + esc(clean) + '</span>' + pathStr.slice(clean.length);
  });
}

function escAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Event delegation for file-link clicks
document.addEventListener('click', (e) => {
  const link = e.target.closest('.file-link');
  if (link && link.dataset.path) {
    e.preventDefault();
    openFile(link.dataset.path);
  }
});

// Wrap renderMarkdown to add path linking
const _originalRenderMarkdown = renderMarkdown;
renderMarkdown = function(text) {
  return linkifyPaths(_originalRenderMarkdown(text));
};

// ===== Init =====
loadInstances();
pollInfo();
setInterval(poll, 300);
setInterval(pollUsage, 2000);
setInterval(loadInstances, 3000);
poll();
pollUsage();
