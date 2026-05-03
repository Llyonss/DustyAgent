// === Directory Tree (from parent links) + Story Tree ===
const Tree = {
  async load() {
    const { nodes, edges } = await (await fetch('/api/graph')).json();
    const parentEdges = edges.filter(e => e.parent);

    const children = {};
    const hasParent = new Set();
    for (const e of parentEdges) {
      if (!children[e.source]) children[e.source] = [];
      children[e.source].push({ name: e.target, label: e.label });
      hasParent.add(e.target);
    }

    const roots = nodes.filter(n => !hasParent.has(n.name)).map(n => n.name);

    const el = document.getElementById('mentalTree');
    if (!roots.length) { el.innerHTML = '<div class="empty" style="padding:12px;font-size:12px">无心智</div>'; }
    else {
      const visited = new Set();
      el.innerHTML = roots.map(r => this.renderNode(r, children, 0, visited)).join('');
    }

    this.loadStories();
  },

  renderNode(name, children, depth, visited) {
    if (visited.has(name)) return ''; // prevent cycle
    visited.add(name);
    const indent = depth * 16;
    const kids = children[name] || [];
    const hasKids = kids.length > 0;
    const icon = hasKids ? '▾' : '·';
    let html = `<div class="tree-item" style="padding-left:${indent + 8}px" onclick="Mental.select('${esc(name)}')" title="${esc(name)}">
      <span class="tree-icon">${icon}</span> ${esc(name)}
    </div>`;
    for (const kid of kids) {
      html += this.renderNode(kid.name, children, depth + 1, visited);
    }
    return html;
  },

  async loadStories() {
    if (!App.instance) return;
    const el = document.getElementById('storyTree');
    try {
      const hist = await (await fetch('/api/history?instance=' + encodeURIComponent(App.instance))).json();
      if (!hist.length) { el.innerHTML = ''; return; }
      el.innerHTML = [...hist].reverse().map((h, i) => {
        const v = hist.length - i;
        const inst = App.instance;
        return `<div class="tree-item story-item" onclick="Mental.showStory('${esc(inst)}',${v})" title="${esc(h.title)}">
          <span class="tree-icon">📜</span> <span class="story-num">v${v}</span> ${esc(h.title)}
        </div>`;
      }).join('');
    } catch { el.innerHTML = ''; }
  },
};
