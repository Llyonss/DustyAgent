// === State ===
let currentInstance = localStorage.getItem('mental-instance') || '';
let currentRoom = null;
let editMode = null;
let allRooms = [];
let roomCache = {};
let pollTimer = null;
let lastEventsJson = '';
let isRunning = false;
let expandedTools = new Set();

// === Helpers ===
function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function md(s) { try { return marked.parse(s || ''); } catch { return '<pre>' + esc(s) + '</pre>'; } }

// === Instance ===
const instSel = document.getElementById('instanceSelect');
instSel.addEventListener('change', () => {
  currentInstance = instSel.value;
  localStorage.setItem('mental-instance', currentInstance);
  lastEventsJson = '';
  loadAll();
});

async function loadInstances() {
  const list = await (await fetch('/api/instances')).json();
  instSel.innerHTML = list.map(n => `<option value="${n}" ${n === currentInstance ? 'selected' : ''}>${n}</option>`).join('');
  if (!currentInstance && list.length) { currentInstance = list[0]; instSel.value = currentInstance; }
}

async function newInstance() {
  const name = prompt('实例名:');
  if (!name) return;
  await fetch('/api/instances', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  currentInstance = name;
  localStorage.setItem('mental-instance', name);
  await loadInstances();
  instSel.value = name;
  lastEventsJson = '';
  loadAll();
}

// === History Panel ===
function toggleHistory() {
  const p = document.getElementById('historyPanel');
  if (p.classList.contains('hidden')) { p.classList.remove('hidden'); loadHistory(); }
  else p.classList.add('hidden');
}

async function loadHistory() {
  const hist = await (await fetch('/api/history?instance=' + encodeURIComponent(currentInstance))).json();
  const el = document.getElementById('historyPanel');
  if (!hist.length) { el.innerHTML = '<div class="empty" style="padding:16px">暂无经历</div>'; return; }
  el.innerHTML = [...hist].reverse().map((h, i) => {
    const v = hist.length - i;
    const ents = Array.isArray(h.entities) && h.entities.length
      ? `<div class="hist-entities">${h.entities.map(e => `<span onclick="selectRoom('${esc(e)}')">${esc(e)}</span>`).join(' ')}</div>` : '';
    return `<div class="hist-item"><div class="hist-title" onclick="this.nextElementSibling.classList.toggle('open')"><span class="hist-num">v${v}</span>${esc(h.title)}</div><div class="hist-story">${esc(h.story || '')}</div>${ents}</div>`;
  }).join('');
}

// === Chat Polling & Rendering ===
function startPoll() { stopPoll(); poll(); pollTimer = setInterval(poll, 200); }
function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

async function poll() {
  if (!currentInstance) return;
  try {
    const data = await (await fetch('/api/events?instance=' + encodeURIComponent(currentInstance))).json();
    isRunning = data.running;
    document.getElementById('runningIndicator').classList.toggle('hidden', !isRunning);
    const json = JSON.stringify(data.events);
    if (json !== lastEventsJson) { lastEventsJson = json; renderChat(data.events); }
  } catch {}
}

function toolSummary(e) {
  const t = e.tool, inp = e.input || {};
  const icons = { mental: '🧠', links: '🔗', file: '📁', cmd: '⚡', think: '💭', commit: '🧠', eye: '👁', image: '🎨', video: '🎬', continue: '▶', stop: '⏸', history: '📜' };
  const icon = icons[t] || '🔧';
  let summary = t;
  if (t === 'mental' || t === 'links') {
    const name = inp.name || 'self';
    summary = `${t} <span class="room-link" onclick="event.stopPropagation();selectRoom('${esc(name)}')">${esc(name)}</span>`;
    if (inp.delete) summary += ' (删除)';
    else if (inp.content) summary += ' (写入)';
    else if (inp.old) summary += ' (修改)';
    else summary += ' (读取)';
  } else if (t === 'file') {
    const p = inp.path || '';
    const short = p.split(/[/\\]/).slice(-2).join('/');
    summary = `file ${esc(short)}`;
    if (inp.delete) summary += ' (删除)';
    else if (inp.content) summary += ' (写入)';
    else if (inp.old) summary += ' (修改)';
    else summary += ' (读取)';
  } else if (t === 'cmd') {
    const c = (inp.command || '').substring(0, 60);
    summary = `cmd ${esc(c)}${(inp.command || '').length > 60 ? '...' : ''}`;
  } else if (t === 'think') {
    summary = '思考';
  }
  return `<span class="tool-icon">${icon}</span> ${summary}`;
}

function renderChat(events) {
  const el = document.getElementById('chatMessages');
  // Check if user is near bottom before re-render
  const wasAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;

  let lastCommit = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'action' && events[i].tool === 'commit' && !events[i].error) { lastCommit = i; break; }
  }
  let html = '';
  if (lastCommit >= 0) {
    const ce = events[lastCommit];
    html += `<div class="msg-commit">┄┄ 🧠 ${esc(ce.input?.title || 'commit')} ┄┄</div>`;
  }
  const visible = lastCommit >= 0 ? events.slice(lastCommit + 1) : events;
  let toolIdx = 0;
  for (const e of visible) {
    if (e.type === 'user') {
      html += `<div class="msg-user">${esc(e.content)}</div>`;
    } else if (e.type === 'assistant') {
      html += `<div class="msg-ai">${md(e.content)}</div>`;
    } else if (e.type === 'action') {
      if (e.tool === 'commit') {
        html += `<div class="msg-commit">┄┄ 🧠 ${esc(e.input?.title || 'commit')} ┄┄</div>`;
      } else if (e.tool === 'speak') {
        // Speak rendered as expanded AI message, not folded
        html += `<div class="msg-ai">${md(typeof e.output === 'string' ? e.output : '')}</div>`;
      } else {
        const uid = 'tool_' + (toolIdx++);
        const isOpen = expandedTools.has(uid);
        const detail = (e.input ? JSON.stringify(e.input, null, 2) : '') + (e.output ? '\n→ ' + (typeof e.output === 'string' ? e.output : JSON.stringify(e.output, null, 2)) : '') + (e.error ? '\n⚠ ' + e.error : '');
        html += `<div class="msg-tool" onclick="toggleTool('${uid}')">${toolSummary(e)} ▸</div>`;
        html += `<div class="msg-tool-detail${isOpen ? ' open' : ''}" id="${uid}">${esc(detail.substring(0, 3000))}${detail.length > 3000 ? '...' : ''}</div>`;
      }
    } else if (e.type === 'error') {
      html += `<div class="msg-error">❌ ${esc(e.error || '')}</div>`;
    }
  }
  el.innerHTML = html;
  // Only auto-scroll if user was already at bottom
  if (wasAtBottom) el.scrollTop = el.scrollHeight;
}

function toggleTool(uid) {
  const el = document.getElementById(uid);
  if (!el) return;
  el.classList.toggle('open');
  if (el.classList.contains('open')) expandedTools.add(uid);
  else expandedTools.delete(uid);
}

async function sendMessage() {
  const inp = document.getElementById('chatInput');
  const text = inp.value.trim();
  if (!text || !currentInstance) return;
  inp.value = '';
  await fetch('/api/events?instance=' + encodeURIComponent(currentInstance), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: text })
  });
}

async function abortLoop() {
  if (!currentInstance) return;
  await fetch('/api/loop?instance=' + encodeURIComponent(currentInstance), { method: 'DELETE' });
}

document.getElementById('chatInput').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

// === Mental Browser ===
async function loadRooms() {
  allRooms = await (await fetch('/api/rooms')).json();
  roomCache = {};
}

const searchInput = document.getElementById('searchInput');
searchInput.addEventListener('input', () => {
  const q = searchInput.value.toLowerCase().trim();
  const sr = document.getElementById('searchResults');
  if (!q) { sr.classList.add('hidden'); return; }
  const filtered = allRooms.filter(r => r.name.toLowerCase().includes(q));
  sr.classList.remove('hidden');
  sr.innerHTML = filtered.map(r => `<div class="search-item" onclick="selectRoom('${esc(r.name)}');document.getElementById('searchInput').value='';document.getElementById('searchResults').classList.add('hidden')"><span class="icon">${r.hasLinks ? '◈' : '◇'}</span>${esc(r.name)}</div>`).join('') || '<div class="empty" style="padding:12px">无结果</div>';
});

async function selectRoom(name) {
  currentRoom = name;
  cancelEdit();
  document.getElementById('searchResults').classList.add('hidden');
  document.getElementById('searchInput').value = '';

  if (name === 'self') {
    const data = await (await fetch('/api/instance?name=' + encodeURIComponent(currentInstance))).json();
    renderRoom('self (私有)', data.selfMd || '(空)', data.selfLinks);
    return;
  }
  try {
    const data = await (await fetch('/api/room?name=' + encodeURIComponent(name))).json();
    roomCache[name] = data;
    renderRoom(name, data.content, data.links);
  } catch {
    document.getElementById('roomName').textContent = name;
    document.getElementById('roomContent').innerHTML = '<div class="empty">房间不存在</div>';
    document.getElementById('roomLinks').innerHTML = '';
  }
}

async function renderRoom(displayName, content, links) {
  document.getElementById('roomName').textContent = displayName;
  document.getElementById('roomContent').innerHTML = md(content);
  document.getElementById('roomContent').style.display = '';
  document.getElementById('editArea').classList.add('hidden');

  let linksHtml = '';
  if (links) {
    const lines = links.split('\n').filter(l => l.trim());
    if (lines.length) {
      linksHtml += '<div class="links-section"><div class="links-label">走廊</div>';
      linksHtml += lines.map(l => {
        const [target, ...rest] = l.split(':');
        const t = target.trim();
        return `<div class="link-item" onclick="selectRoom('${esc(t)}')">→ ${esc(t)}<span class="link-tag">${esc(rest.join(':').trim())}</span></div>`;
      }).join('');
      linksHtml += '</div>';
    }
  }
  // Reverse references
  const name = currentRoom;
  if (name && name !== 'self') {
    const refs = [];
    for (const r of allRooms) {
      if (r.name === name) continue;
      if (!roomCache[r.name]) {
        try { const rr = await fetch('/api/room?name=' + encodeURIComponent(r.name)); if (rr.ok) roomCache[r.name] = await rr.json(); } catch {}
      }
      if (roomCache[r.name]?.links?.includes(name)) refs.push(r.name);
    }
    if (refs.length) {
      linksHtml += '<div class="links-section"><div class="links-label">被引用</div>';
      linksHtml += refs.map(n => `<div class="link-item" onclick="selectRoom('${esc(n)}')">← ${esc(n)}</div>`).join('');
      linksHtml += '</div>';
    }
  }
  document.getElementById('roomLinks').innerHTML = linksHtml;
}

// === Edit ===
function startEdit(mode) {
  if (!currentRoom) return;
  editMode = mode;
  const ta = document.getElementById('editTextarea');
  document.getElementById('editLabel').textContent = mode === 'links' ? '编辑走廊' : '编辑内容';

  if (currentRoom === 'self') {
    fetch('/api/instance?name=' + encodeURIComponent(currentInstance)).then(r => r.json()).then(d => {
      ta.value = mode === 'links' ? (d.selfLinks || '') : (d.selfMd || '');
    });
  } else {
    const data = roomCache[currentRoom];
    ta.value = mode === 'links' ? (data?.links || '') : (data?.content || '');
  }
  document.getElementById('roomContent').style.display = 'none';
  document.getElementById('editArea').classList.remove('hidden');
  ta.focus();
}

function cancelEdit() {
  editMode = null;
  document.getElementById('editArea').classList.add('hidden');
  document.getElementById('roomContent').style.display = '';
}

async function saveEdit() {
  if (!editMode || !currentRoom) return;
  const content = document.getElementById('editTextarea').value;
  if (currentRoom === 'self') {
    const suffix = editMode === 'links' ? 'self.links' : 'self.md';
    await fetch('/api/self-save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instance: currentInstance, suffix, content }) });
  } else {
    const suffix = editMode === 'links' ? '.links' : '.md';
    await fetch('/api/room-save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: currentRoom, suffix, content }) });
  }
  cancelEdit();
  await loadRooms();
  selectRoom(currentRoom);
}

document.getElementById('editTextarea').addEventListener('keydown', e => {
  if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEdit(); }
  if (e.key === 'Escape') cancelEdit();
  if (e.key === 'Tab') { e.preventDefault(); const ta = e.target, s = ta.selectionStart; ta.value = ta.value.substring(0, s) + '  ' + ta.value.substring(ta.selectionEnd); ta.selectionStart = ta.selectionEnd = s + 2; }
});

// === Init ===
async function loadAll() {
  await Promise.all([loadRooms(), loadHistory()]);
  startPoll();
  if (currentRoom) selectRoom(currentRoom);
}

(async () => {
  await loadInstances();
  loadAll();
})();

// Expose to HTML onclick
window.newInstance = newInstance;
window.toggleHistory = toggleHistory;
window.sendMessage = sendMessage;
window.abortLoop = abortLoop;
window.selectRoom = selectRoom;
window.startEdit = startEdit;
window.cancelEdit = cancelEdit;
window.saveEdit = saveEdit;
window.toggleTool = toggleTool;
