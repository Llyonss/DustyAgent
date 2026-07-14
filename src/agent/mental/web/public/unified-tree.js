// === 统一目录树 ===
// 心智 + 文件 + 故事 + 终端，四个根节点一棵树

import { Data } from './data.js';
import { Source } from './source.js';
import { Terminal } from './terminal.js';

const dirCache = {};
const expandedDirs = new Set();

export const UnifiedTree = {
  sections: { mental: true, files: false, stories: false, terminal: true },

  async init() {
    const el = document.getElementById('unifiedTree');
    if (!el) return;

    // 自己绑定事件（确保每次 init 后都有效）
    el.onclick = (e) => this.onClick(e);

    // 心智数据
    let graphData = { nodes: [], edges: [] };
    try { graphData = await Data.fetchGraph(); } catch {}

    const { nodes, edges } = graphData;
    const parentEdges = edges.filter(e => e.parent);
    const children = {};
    const hasParent = new Set();
    for (const e of parentEdges) {
      const src = typeof e.source === 'string' ? e.source : e.source.name;
      const tgt = typeof e.target === 'string' ? e.target : e.target.name;
      if (!children[src]) children[src] = [];
      children[src].push({ name: tgt, label: e.label });
      hasParent.add(tgt);
    }
    const roots = nodes.filter(n => !hasParent.has(n.name)).map(n => n.name);

    // 故事数据（仅旧实例）
    let stories = [];
    const src = Source.get();
    if (src.mode === 'instance' && src.id) {
      try { stories = await Data.fetchHistory(src.id); } catch {}
    }

    let html = '';

    // —— 心智 ——
    const mentalOpen = this.sections.mental;
    html += `<div class="ut-section" data-section="mental">
      <div class="ut-header" data-act="toggle" data-section="mental">
        🧠 心智
        <span class="ut-toggle">${mentalOpen ? '−' : '+'}</span>
      </div>
      <div class="ut-body${mentalOpen ? '' : ' ut-collapsed'}">`;
    const visited = new Set();
    if (roots.length) {
      for (const r of roots) html += this._mentalNode(r, children, 1, visited);
    } else {
      html += '<div class="ut-empty">无心智</div>';
    }
    html += `</div></div>`;

    // —— 文件 ——
    const filesOpen = this.sections.files;
    html += `<div class="ut-section" data-section="files">
      <div class="ut-header" data-act="toggle" data-section="files">
        📁 文件
        <span class="ut-toggle">${filesOpen ? '−' : '+'}</span>
      </div>
      <div class="ut-body${filesOpen ? '' : ' ut-collapsed'}" data-section-body="files">
        ${filesOpen ? '<div class="ut-loading">加载中...</div>' : ''}
      </div></div>`;

    // —— 故事 ——
    const storyOpen = this.sections.stories;
    html += `<div class="ut-section" data-section="stories">
      <div class="ut-header" data-act="toggle" data-section="stories">
        📜 故事
        <span class="ut-toggle">${storyOpen ? '−' : '+'}</span>
      </div>
      <div class="ut-body${storyOpen ? '' : ' ut-collapsed'}">`;
    if (stories.length) {
      html += [...stories].reverse().map((h, i) => {
        const v = stories.length - i;
        return `<div class="ut-item" data-act="story" data-inst="${window.esc(src.id)}" data-v="${v}">
          <span class="ut-num">v${v}</span> ${window.esc(h.title)}</div>`;
      }).join('');
    } else {
      html += '<div class="ut-empty">暂无故事</div>';
    }
    html += `</div></div>`;

    // —— 终端 ——
    const termOpen = this.sections.terminal;
    html += `<div class="ut-section" data-section="terminal">
      <div class="ut-header" data-act="toggle" data-section="terminal">
        ⌨️ 终端
        <span class="ut-header-act" data-act="term-new" title="新增终端">＋</span>
      </div>
      <div class="ut-body${termOpen ? '' : ' ut-collapsed'}" data-section-body="terminal"></div></div>`;

    el.innerHTML = html;

    // 文件区如果已展开，加载根目录。终端区加载列表。
    if (filesOpen) this._loadFilesRoot();
    if (this.sections.terminal) this._renderTerminalBody();
  },

  _mentalNode(name, children, depth, visited) {
    if (visited.has(name)) return '';
    visited.add(name);
    const kids = children[name] || [];
    const indent = depth * 14 + 8;
    let html = `<div class="ut-item" style="padding-left:${indent}px" data-act="mental" data-name="${window.esc(name)}">${window.esc(name)}</div>`;
    for (const kid of kids) html += this._mentalNode(kid.name, children, depth + 1, visited);
    return html;
  },

  // —— 事件委托 ——
  onClick(e) {
    try {
      const headerAct = e.target.closest('.ut-header-act');
      if (headerAct) {
        e.stopPropagation();
        if (headerAct.dataset.act === 'term-new') {
          this.sections.terminal = true;
          Terminal.create().then(() => { window._showTerminalTab?.(); this._renderTerminalBody(); });
        }
        return;
      }

      const itemDel = e.target.closest('.ut-item-del');
      if (itemDel) { e.stopPropagation(); return; }

      const header = e.target.closest('.ut-header');
      if (header && header.dataset.act === 'toggle') {
        const sec = header.dataset.section;
        if (sec === 'files' && !this.sections.files) {
          this.sections.files = true; this._toggleSectionDOM(sec); this._loadFilesRoot();
        } else {
          this.sections[sec] = !this.sections[sec]; this._toggleSectionDOM(sec);
          if (sec === 'terminal' && this.sections.terminal) this._renderTerminalBody();
        }
        return;
      }

      const item = e.target.closest('.ut-item');
      if (!item) return;
      const act = item.dataset.act;
      if (act === 'mental') { if (window._selectMental) window._selectMental(item.dataset.name); }
      else if (act === 'story') { if (window._showStory) window._showStory(item.dataset.inst, parseInt(item.dataset.v)); }
      else if (act === 'file') { if (window._utOpenFile) window._utOpenFile(item.dataset.path, item.dataset.name); }
      else if (act === 'dir') { this._toggleFileDir(item.dataset.path, item); }
    } catch (err) { console.error('Tree onClick:', err); }
  },

  async _renderTerminalBody() {
    const body = document.querySelector('[data-section-body="terminal"]');
    if (!body) return;
    const list = await Terminal.list();
    body.innerHTML = '';
    if (list.length) {
      for (const { id, alive } of list) {
        const div = document.createElement('div');
        div.className = 'ut-item';
        div.innerHTML = `${alive ? '⌨️' : '💀'} ${id}`;
        div.onclick = async () => {
          await Terminal.switchTo(id);
          window._showTerminalTab?.();
          this._renderTerminalBody();
        };
        const del = document.createElement('span');
        del.className = 'ut-item-del'; del.textContent = '×'; del.title = '关闭终端';
        del.onclick = async (e) => { e.stopPropagation(); await Terminal.kill(id); this._renderTerminalBody(); };
        div.appendChild(del);
        body.appendChild(div);
      }
    } else {
      body.innerHTML = '<div class="ut-empty">点击 ＋ 新增终端</div>';
    }
  },

  _toggleSectionDOM(sec) {
    const el = document.querySelector(`.ut-section[data-section="${sec}"]`);
    if (!el) return;
    const toggle = el.querySelector('.ut-toggle');
    const body = el.querySelector('.ut-body');
    if (toggle) toggle.textContent = this.sections[sec] ? '−' : '+';
    if (body) body.classList.toggle('ut-collapsed', !this.sections[sec]);
  },

  // —— 文件树（懒加载） ——
  async _loadFilesRoot() {
    const body = document.querySelector('[data-section-body="files"]');
    if (!body) return;
    if (!dirCache['.']) {
      body.innerHTML = '<div class="ut-loading">加载中...</div>';
      try {
        const data = await Data.fetchFiles('.');
        dirCache['.'] = data.entries;
      } catch {
        body.innerHTML = '<div class="ut-empty">无法加载</div>';
        return;
      }
    }
    expandedDirs.add('.');
    body.innerHTML = '';
    this._renderDir(body, '.', 1);
  },

  _renderDir(container, dirPath, depth) {
    const entries = dirCache[dirPath];
    if (!entries) return;
    for (const entry of entries) {
      const indent = depth * 14 + 8;
      if (entry.type === 'dir') {
        const isExpanded = expandedDirs.has(entry.path);
        const item = document.createElement('div');
        item.className = 'ut-item ut-dir';
        item.style.paddingLeft = indent + 'px';
        item.dataset.act = 'dir';
        item.dataset.path = entry.path;
        item.innerHTML = `<span class="ut-caret">${isExpanded ? '▾' : '▸'}</span> 📁 ${window.esc(entry.name)}`;
        container.appendChild(item);
        if (isExpanded) {
          const wrap = document.createElement('div');
          wrap.className = 'ut-dir-children';
          container.appendChild(wrap);
          this._renderDir(wrap, entry.path, depth + 1);
        }
      } else {
        const icon = this._fileIcon(entry.ext);
        const item = document.createElement('div');
        item.className = 'ut-item ut-file';
        item.style.paddingLeft = indent + 'px';
        item.dataset.act = 'file';
        item.dataset.path = entry.path;
        item.dataset.name = entry.name;
        item.innerHTML = `${icon} ${window.esc(entry.name)}`;
        container.appendChild(item);
      }
    }
  },

  async _toggleFileDir(dirPath, dirItem) {
    if (expandedDirs.has(dirPath)) {
      expandedDirs.delete(dirPath);
      let next = dirItem.nextElementSibling;
      while (next && next.classList.contains('ut-dir-children')) {
        const r = next; next = next.nextElementSibling; r.remove();
      }
      const caret = dirItem.querySelector('.ut-caret');
      if (caret) caret.textContent = '▸';
    } else {
      expandedDirs.add(dirPath);
      if (!dirCache[dirPath]) {
        try {
          const data = await Data.fetchFiles(dirPath);
          dirCache[dirPath] = data.entries;
        } catch { return; }
      }
      const wrap = document.createElement('div');
      wrap.className = 'ut-dir-children';
      dirItem.after(wrap);
      this._renderDir(wrap, dirPath, 2); // depth from parent
      const caret = dirItem.querySelector('.ut-caret');
      if (caret) caret.textContent = '▾';
    }
  },

  _fileIcon(ext) {
    const icons = { js:'📜', mjs:'📜', json:'📋', md:'📝', html:'🌐', css:'🎨', svg:'🖼️', py:'🐍', go:'🔵', rs:'🦀', sh:'💻', bat:'💻', yml:'⚙️', yaml:'⚙️', toml:'⚙️', env:'⚙️', txt:'📄', xml:'📋' };
    return icons[ext] || '📄';
  }
};
