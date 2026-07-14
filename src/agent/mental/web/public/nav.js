// 会话导航：Group 与 Agent 是容器；System 挂在二者或根下，内部是自治文件树。
import { Data } from './data.js';
import { Instance } from './instance.js';
import { Self } from './content/self.js';

const $ = id => document.getElementById(id);
const esc = s => window.esc(s);

export const Nav = {
  nodes: [], byParent: {}, byName: {}, collapsed: {}, cur: '',

  async init() {
    this.cur = localStorage.getItem('mental-instance') || '';
    try { this.collapsed = JSON.parse(localStorage.getItem('nav-collapsed') || '{}'); } catch {}
    await this.reload();
  },
  async reload() {
    this.nodes = await Data.fetchGroups().catch(() => []);
    this.byParent = {}; this.byName = {};
    for (const n of this.nodes) {
      (this.byParent[n.parent || ''] ||= []).push(n);
      if (n.type !== 'chat') this.byName[n.name] = n;
    }
    const rank = { group: 0, agent: 1, system: 2, chat: 3 };
    for (const k in this.byParent) this.byParent[k].sort((a,b) => rank[a.type] - rank[b.type] || a.name.localeCompare(b.name));
    this.render(); this._loadVisibleSystems(); this._updateLabel();
  },
  _save() { localStorage.setItem('nav-collapsed', JSON.stringify(this.collapsed)); },
  render() {
    const roots = this.byParent[''] || [];
    $('navTree').innerHTML = `<div class="nav-root-drop" data-root-drop="1" title="拖到这里移至根目录">根目录</div>` + (roots.map(n => this._node(n, 0)).join('') || '<div class="nav-sub-empty">空</div>');
    this._bindDrag();
  },
  _node(n, depth) {
    if (n.type === 'chat') return `<div class="nav-row nav-chat${this.cur === n.name ? ' active' : ''}" draggable="true" style="--d:${depth}" data-inst="${esc(n.name)}" data-name="${esc(n.name)}" data-type="chat"><span class="nav-caret nav-caret-dot">·</span><span class="nav-name">💬 ${esc(n.name)}</span><span class="nav-acts"><span class="nav-act" data-act="del-chat" data-name="${esc(n.name)}">🗑</span></span></div>`;
    if (n.type === 'system') {
      const col = this.collapsed['system:' + n.name];
      let h = `<div class="nav-row nav-system" draggable="true" style="--d:${depth}" data-name="${esc(n.name)}" data-type="system"><span class="nav-caret" data-system-caret="${esc(n.name)}">${col ? '▸' : '▾'}</span><span class="nav-name">⚙️ ${esc(n.label || n.name)}</span><span class="nav-acts"><span class="nav-act" data-act="del-system" data-name="${esc(n.name)}" title="删除 System">🗑</span></span></div>`;
      if (!col) h += `<div class="nav-system-files" data-system-files="${esc(n.name)}" style="--d:${depth + 1}"><div class="nav-sub-empty">加载中...</div></div>`;
      return h;
    }
    const kids = this.byParent[n.name] || [], col = this.collapsed[n.name];
    const icon = n.type === 'agent' ? '🤖' : '📁';
    let h = `<div class="nav-row nav-${n.type}" draggable="true" style="--d:${depth}" data-name="${esc(n.name)}" data-type="${n.type}"><span class="nav-caret" data-caret="${esc(n.name)}">${kids.length ? (col ? '▸' : '▾') : '·'}</span><span class="nav-name">${icon} ${esc(n.name)}</span><span class="nav-acts"><span class="nav-act" data-act="new-group" data-parent="${esc(n.name)}" title="新建子分组">📁+</span><span class="nav-act" data-act="new-agent" data-parent="${esc(n.name)}" title="新建 Agent">🤖+</span><span class="nav-act" data-act="new-system" data-parent="${esc(n.name)}" title="新建 System">⚙️+</span><span class="nav-act" data-act="new-chat" data-parent="${esc(n.name)}" data-type="${n.type}" title="新建对话">＋</span><span class="nav-act" data-act="del-${n.type}" data-name="${esc(n.name)}" title="删除">🗑</span></span></div>`;
    if (!col) for (const kid of kids) h += this._node(kid, depth + 1);
    return h;
  },
  async onClick(e) {
    const caret = e.target.closest('.nav-caret');
    if (caret?.dataset.systemCaret) { e.stopPropagation(); const key = 'system:' + caret.dataset.systemCaret; this.collapsed[key] = !this.collapsed[key]; this._save(); this.render(); this._loadVisibleSystems(); return; }
    if (caret?.dataset.caret) { e.stopPropagation(); const n = caret.dataset.caret; this.collapsed[n] = !this.collapsed[n]; this._save(); this.render(); this._loadVisibleSystems(); return; }
    const file = e.target.closest('[data-system-file]');
    if (file) { e.stopPropagation(); window._utOpenFile?.(file.dataset.systemFile, file.dataset.name); return; }
    const act = e.target.closest('.nav-act'); if (act) { e.stopPropagation(); return this._action(act.dataset); }
    const row = e.target.closest('.nav-row'); if (!row) return;
    if (row.dataset.type === 'system') return;
    if (row.classList.contains('nav-chat')) return this.selectInstance(row.dataset.inst);
    if (row.dataset.type === 'group') return this.openWiki(row.dataset.name);
    if (row.dataset.type === 'agent') return Self.viewAgent(row.dataset.name);
  },
  async _action(d) {
    try {
      if (d.act === 'new-group' || d.act === 'new-agent' || d.act === 'new-system') {
        const label = d.act === 'new-agent' ? 'Agent 名' : d.act === 'new-system' ? 'System 目录名' : '分组名';
        const name = prompt(label + ':'); if (!name) return;
        if (d.act === 'new-agent') await Data.createAgent(name.trim(), d.parent || '');
        else if (d.act === 'new-system') await Data.createSystem(name.trim(), d.parent || '');
        else await Data.createGroup(name.trim(), d.parent || '');
        if (d.parent) { this.collapsed[d.parent] = false; this._save(); }
      } else if (d.act === 'new-chat') {
        const base = d.parent, siblings = this.byParent[base] || []; let max = -1;
        const re = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-(\\d{2})$');
        for (const n of siblings) { const m = n.type === 'chat' && n.name.match(re); if (m) max = Math.max(max, +m[1]); }
        const name = `${base}-${String(max + 1).padStart(2, '0')}`;
        if (d.type === 'agent') await Data.createAgentChat(base, name); else await Data.createGroupChat(base, name);
        this.collapsed[base] = false; this._save(); await this.reload(); return this.selectInstance(name);
      } else if (d.act === 'del-chat') {
        if (!confirm(`删除对话 "${d.name}"？`)) return; await Data.deleteInstance(d.name); if (this.cur === d.name) this.cur = '';
      } else if (d.act === 'del-group' || d.act === 'del-agent' || d.act === 'del-system') {
        if (!confirm(`删除 "${d.name}"？（必须没有子节点；System 会删除整个存储目录）`)) return;
        if (d.act === 'del-agent') await Data.deleteAgent(d.name);
        else if (d.act === 'del-system') await Data.deleteSystem(d.name);
        else await Data.deleteGroup(d.name);
      }
      await this.reload();
    } catch (e) { alert('操作失败: ' + (e.message || e)); }
  },
  async selectInstance(name) { this.cur = name; await Instance.switch(name); this.render(); this._updateLabel(); },
  _updateLabel() {
    const chat = this.nodes.find(n => n.type === 'chat' && n.name === this.cur);
    const parent = chat?.parent;
    $('curSessionLabel').textContent = parent ? `${parent} / 💬 ${this.cur}` : (this.cur || '—');
  },
  async newInstance() { const name = prompt('对话名:'); if (!name) return; await Data.createInstance(name.trim()); await this.reload(); this.selectInstance(name.trim()); },
  async newProject() { const name = prompt('分组名:'); if (!name) return; await Data.createGroup(name.trim(), ''); await this.reload(); },
  async newAgent() { const name = prompt('Agent 名:'); if (!name) return; await Data.createAgent(name.trim(), ''); await this.reload(); },
  async newSystem() { const name = prompt('System 目录名:'); if (!name) return; await Data.createSystem(name.trim(), ''); await this.reload(); },
  _systemFiles(entries, depth) {
    return entries.map(e => e.type === 'dir'
      ? `<div class="nav-system-entry" style="--d:${depth}">📁 ${esc(e.name)}</div>${this._systemFiles(e.children || [], depth + 1)}`
      : `<div class="nav-system-entry nav-system-file" style="--d:${depth}" data-system-file="${esc(e.path)}" data-name="${esc(e.name)}">📄 ${esc(e.name)}</div>`).join('');
  },
  async _loadVisibleSystems() {
    for (const el of document.querySelectorAll('[data-system-files]')) {
      try { const data = await Data.fetchSystemFiles(el.dataset.systemFiles); el.innerHTML = this._systemFiles(data.entries || [], +(getComputedStyle(el).getPropertyValue('--d') || 1)) || '<div class="nav-sub-empty">空</div>'; }
      catch (e) { el.innerHTML = `<div class="nav-sub-empty">无法读取: ${esc(e.message)}</div>`; }
    }
  },
  _drag: null,
  _bindDrag() {
    const tree = $('navTree');
    tree.querySelectorAll('.nav-row[draggable="true"]').forEach(row => {
      row.addEventListener('dragstart', e => {
        this._drag = { type: row.dataset.type, name: row.dataset.name };
        e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', JSON.stringify(this._drag));
      });
      if (row.dataset.type === 'group' || row.dataset.type === 'agent') {
        row.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); row.classList.add('drag-over'); });
        row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
        row.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); row.classList.remove('drag-over'); this._drop(row.dataset.name); });
      }
    });
    const root = tree.querySelector('[data-root-drop]');
    root?.addEventListener('dragover', e => { e.preventDefault(); root.classList.add('drag-over'); });
    root?.addEventListener('dragleave', () => root.classList.remove('drag-over'));
    root?.addEventListener('drop', e => { e.preventDefault(); root.classList.remove('drag-over'); this._drop(''); });
  },
  async _drop(parent) {
    if (!this._drag || this._drag.name === parent) return;
    try { await Data.moveNode(this._drag.type, this._drag.name, parent); this._drag = null; await this.reload(); }
    catch (e) { alert('移动失败: ' + (e.message || e)); }
  },
  _doc: null,
  async openWiki(name) { const { content } = await Data.fetchGroupWiki(name); this._doc = { name }; $('docEditorTitle').textContent = `📖 ${name} / wiki`; $('docEditorText').value = content || ''; $('docEditorOverlay').classList.remove('hidden'); },
  async saveDoc() { if (!this._doc) return; await Data.saveGroupWiki(this._doc.name, $('docEditorText').value); },
  closeDoc() { $('docEditorOverlay').classList.add('hidden'); this._doc = null; },
  bind() {
    $('navTree').addEventListener('click', e => this.onClick(e));
    $('btnNavNewInstance').addEventListener('click', () => this.newInstance()); $('btnNavNewProject').addEventListener('click', () => this.newProject());
    $('btnNavNewAgent').addEventListener('click', () => this.newAgent());
    $('btnNavNewSystem').addEventListener('click', () => this.newSystem());
    $('btnNavToggle')?.addEventListener('click', () => $('navPanel').classList.toggle('nav-collapsed'));
    $('btnDocSave').addEventListener('click', () => this.saveDoc()); $('btnDocClose').addEventListener('click', () => this.closeDoc());
    $('docEditorOverlay').addEventListener('click', e => { if (e.target === e.currentTarget) this.closeDoc(); });
  }
};
