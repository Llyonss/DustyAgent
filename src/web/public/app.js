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
const eventsDiv = document.getElementById('events');
const msgInput = document.getElementById('msg');
const sendBtn = document.getElementById('send-btn');
const stopBtn = document.getElementById('stop-btn');

// ===== State =====
let currentInstance = 'default';
let knownEventCount = 0;

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
  // What it would cost without cache (all input at full price)
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
  let lastCost = 0;
  let lastSaved = 0;
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
  lastCost = lastCalc.cost;
  lastSaved = lastCalc.saved;

  const totalSaved = totalNoCacheCost - totalCost;

  costBar.innerHTML =
    '<span class="cost-total">Total: $' + totalCost.toFixed(4) + '</span>' +
    '<span class="cost-saved">Saved: $' + totalSaved.toFixed(4) + '</span>' +
    '<span class="cost-last">Last: $' + lastCost.toFixed(4) +
    (lastSaved > 0 ? ' <span class="cost-saved-tag">-$' + lastSaved.toFixed(4) + '</span>' : '') +
    '</span>' +
    '<span class="cost-tokens">' + fmtK(totalInput) + ' in / ' + fmtK(totalOutput) + ' out / ' + fmtK(totalCacheRead) + ' cache↓ / ' + fmtK(totalCacheWrite) + ' cache↑</span>';
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
  eventsDiv.innerHTML = '';
  costBar.innerHTML = '';
  renderTabs();
  poll();
  pollUsage();
}

async function loadInstances() {
  try {
    const res = await fetch('/api/instances');
    const list = await res.json();
    if (list.length === 0) list.push('default');
    if (!list.includes(currentInstance)) list.push(currentInstance);
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

function createInstance() {
  const name = prompt('Instance name:');
  if (!name) return;
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) return;
  switchInstance(safe);
}

// ===== Render a single event into a DOM element =====
function renderEvent(e) {
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

  if (e.type === 'action' && e.tool !== 'stop' && e.tool !== 'wait') {
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
async function poll() {
  try {
    const res = await fetch('/api/events?instance=' + encodeURIComponent(currentInstance));
    const data = await res.json();
    const events = data.events;
    if (events.length > knownEventCount) {
      for (let i = knownEventCount; i < events.length; i++) {
        const el = renderEvent(events[i]);
        if (el) eventsDiv.appendChild(el);
      }
      knownEventCount = events.length;
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

// ===== Stop Loop =====
async function stopLoop() {
  await fetch('/api/loop?instance=' + encodeURIComponent(currentInstance), { method: 'DELETE' });
}

// ===== Event Listeners =====
sendBtn.addEventListener('click', send);
stopBtn.addEventListener('click', stopLoop);
msgInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});

// ===== Init =====
loadInstances();
setInterval(poll, 300);
setInterval(pollUsage, 2000);
setInterval(loadInstances, 3000);
poll();
pollUsage();
