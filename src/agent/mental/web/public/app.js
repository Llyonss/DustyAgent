// === Global State ===
const App = {
  instance: localStorage.getItem('mental-instance') || '',
  currentMental: null,
  pollTimer: null,
  lastEventsJson: '',
  isRunning: false,

  async init() {
    const list = await (await fetch('/api/instances')).json();
    const sel = document.getElementById('instanceSelect');
    sel.innerHTML = list.map(n => `<option value="${n}" ${n === App.instance ? 'selected' : ''}>${n}</option>`).join('');
    if (!App.instance && list.length) App.instance = list[0];
    sel.value = App.instance;
    sel.addEventListener('change', () => {
      App.instance = sel.value;
      localStorage.setItem('mental-instance', App.instance);
      App.lastEventsJson = '';
      App.reload();
    });
    App.reload();
  },

  async reload() {
    Graph.load();
    Tree.load();
    Chat.startPoll();

  },

  async newInstance() {
    const name = prompt('实例名:');
    if (!name) return;
    await fetch('/api/instances', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    App.instance = name;
    localStorage.setItem('mental-instance', name);
    const sel = document.getElementById('instanceSelect');
    sel.innerHTML += `<option value="${name}">${name}</option>`;
    sel.value = name;
    App.lastEventsJson = '';
    App.reload();
  },

  async deleteInstance() {
    if (!App.instance) return;
    if (!confirm(`确定删除实例 "${App.instance}"？所有对话和故事将被永久删除。`)) return;
    await fetch('/api/instances', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: App.instance }) });
    const list = await (await fetch('/api/instances')).json();
    const sel = document.getElementById('instanceSelect');
    sel.innerHTML = list.map(n => `<option value="${n}">${n}</option>`).join('');
    App.instance = list[0] || '';
    sel.value = App.instance;
    localStorage.setItem('mental-instance', App.instance);
    App.lastEventsJson = '';
    App.reload();
  },

  // Mobile: tab switching
  switchTab(tab) {
    const chatPanel = document.getElementById('chatPanel');
    const mentalPanel = document.getElementById('mentalPanel');
    document.querySelectorAll('.mobile-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    if (tab === 'chat') {
      chatPanel.classList.remove('mobile-hidden');
      mentalPanel.classList.remove('mobile-show');
    } else {
      chatPanel.classList.add('mobile-hidden');
      mentalPanel.classList.add('mobile-show');
      setTimeout(() => Graph.render(), 50);
    }
    App.closeSidebar();
  },

  // Mobile: sidebar drawer
  toggleSidebar() {
    const sidebar = document.getElementById('mentalSidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar.classList.contains('sidebar-open')) {
      App.closeSidebar();
    } else {
      sidebar.classList.add('sidebar-open');
      overlay.classList.add('open');
    }
  },

  closeSidebar() {
    document.getElementById('mentalSidebar')?.classList.remove('sidebar-open');
    document.getElementById('sidebarOverlay')?.classList.remove('open');
  },
};

function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function md(s) { try { return marked.parse(s || ''); } catch { return '<pre>' + esc(s) + '</pre>'; } }
