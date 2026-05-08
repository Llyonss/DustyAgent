// === 目录树 ===
// 职责：渲染心智层级目录和故事列表

import { Data } from '../data.js';

export const Tree = {
  async renderMental(graphData) {
    const { nodes, edges } = graphData;
    const parentEdges = edges.filter(e => e.parent);

    const children = {};
    const hasParent = new Set();
    for (const e of parentEdges) {
      // D3 forceSimulation 可能已把 source/target 从字符串替换为节点对象
      const src = typeof e.source === 'string' ? e.source : e.source.name;
      const tgt = typeof e.target === 'string' ? e.target : e.target.name;
      if (!children[src]) children[src] = [];
      children[src].push({ name: tgt, label: e.label });
      hasParent.add(tgt);
    }

    const roots = nodes.filter(n => !hasParent.has(n.name)).map(n => n.name);

    const el = document.getElementById('mentalTree');
    if (!roots.length) {
      el.innerHTML = '<div class="empty" style="padding:12px;font-size:12px">无心智</div>';
    } else {
      const visited = new Set();
      el.innerHTML = roots.map(r => this.renderNode(r, children, 0, visited)).join('');
    }

    this.renderStories();
  },

  renderNode(name, children, depth, visited) {
    if (visited.has(name)) return '';
    visited.add(name);
    const indent = depth * 16;
    const kids = children[name] || [];
    const hasKids = kids.length > 0;
    const icon = hasKids ? '▾' : '·';
    let html = `<div class="tree-item" style="padding-left:${indent + 8}px" onclick="window._selectMental('${window.esc(name)}')" title="${window.esc(name)}">
      <span class="tree-icon">${icon}</span> ${window.esc(name)}
    </div>`;
    for (const kid of kids) {
      html += this.renderNode(kid.name, children, depth + 1, visited);
    }
    return html;
  },

  async renderStories() {
    const inst = localStorage.getItem('mental-instance') || '';
    if (!inst) return;
    const el = document.getElementById('storyTree');
    try {
      const hist = await Data.fetchHistory(inst);
      if (!hist.length) { el.innerHTML = ''; return; }
      el.innerHTML = [...hist].reverse().map((h, i) => {
        const v = hist.length - i;
        return `<div class="tree-item story-item" onclick="window._showStory('${window.esc(inst)}',${v})" title="${window.esc(h.title)}">
          <span class="tree-icon">📜</span> <span class="story-num">v${v}</span> ${window.esc(h.title)}
        </div>`;
      }).join('');
    } catch { el.innerHTML = ''; }
  }
};
