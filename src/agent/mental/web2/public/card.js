const Card = {
  cards: new Map(),
  visibleThreshold: 0.7,  // zoom >= this → expand visible cards
  _visibilityTimer: null,

  async loadAll(canvasData, linksData) {
    const mentals = await fetch('/api/mentals').then(r => r.json());
    const positions = canvasData.cards || {};
    
    // Build link adjacency for layout
    const adj = new Map();
    for (const m of mentals) adj.set(m.name, new Set());
    // Parent links
    if (linksData) {
      for (const [name, targets] of Object.entries(linksData)) {
        if (!adj.has(name)) adj.set(name, new Set());
        for (const t of targets) adj.get(name).add(t);
      }
    }

    // Compute layout if positions missing
    const needsLayout = mentals.some(m => !positions[m.name]);
    if (needsLayout) {
      this._layout(mentals, adj, positions);
      // Save computed positions
      App.saveCanvas();
    }

    for (const m of mentals) {
      const pos = positions[m.name] || { x: 200, y: 200 };
      this.create(m.name, pos.x, pos.y, m.summary);
    }
  },

  _layout(mentals, adj, positions) {
    // Find connected components
    const visited = new Set();
    const components = [];
    for (const m of mentals) {
      if (visited.has(m.name)) continue;
      const comp = [];
      const queue = [m.name];
      visited.add(m.name);
      while (queue.length) {
        const node = queue.shift();
        comp.push(node);
        for (const neighbor of (adj.get(node) || [])) {
          if (!visited.has(neighbor) && mentals.some(x => x.name === neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
      components.push(comp);
    }

    // Arrange components in a grid
    const CARD_W = 320;
    const CARD_H = 180;
    const COMP_GAP = 200;
    const CARDS_PER_ROW = 4;
    
    let compX = 0, compY = 0;
    for (const comp of components) {
      // Arrange cards within component in rows
      for (let i = 0; i < comp.length; i++) {
        const row = Math.floor(i / CARDS_PER_ROW);
        const col = i % CARDS_PER_ROW;
        positions[comp[i]] = {
          x: compX + col * CARD_W,
          y: compY + row * CARD_H
        };
      }
      compX += CARDS_PER_ROW * CARD_W + COMP_GAP;
      if (compX > 4000) { compX = 0; compY += 500; }
    }
  },

  create(name, x, y, summary) {
    const el = document.createElement('div');
    el.className = 'card';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.dataset.name = name;
    el.dataset.mode = 'compact';
    el.innerHTML = `
      <div class="card-header">
        <span class="card-title">${name}</span>
        <button class="card-chat" title="发起对话">💬</button>
      </div>
      <div class="card-body">${summary || ''}</div>
    `;

    this._bindDrag(el, name);
    el.querySelector('.card-chat').addEventListener('click', (e) => {
      e.stopPropagation();
      Panel.create(name);
    });
    el.addEventListener('click', (e) => {
      const link = e.target.closest('.wiki-link');
      if (link) {
        e.stopPropagation();
        Panel.create(name, link.dataset.target);
      }
    });

    document.getElementById('cards-layer').appendChild(el);
    this.cards.set(name, { name, x, y, el, summary, content: null, links: null });
  },

  // Check viewport: expand cards inside, collapse cards outside
  updateVisibility() {
    if (this._visibilityTimer) return;
    this._visibilityTimer = setTimeout(() => {
      this._visibilityTimer = null;
      this._doUpdateVisibility();
    }, 50);
  },

  _doUpdateVisibility() {
    const zoom = Transform.viewport.zoom;
    const shouldExpand = zoom >= this.visibleThreshold;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    
    for (const [name, card] of this.cards) {
      // Screen position of card
      const screen = Transform.toScreen(card.x, card.y);
      const cardW = card.el.offsetWidth * zoom;
      const cardH = card.el.offsetHeight * zoom;
      
      const inViewport = screen.x + cardW > 0 && screen.x < vw &&
                         screen.y + cardH > 0 && screen.y < vh;
      
      if (shouldExpand && inViewport) {
        if (card.el.dataset.mode !== 'expanded') {
          card.el.dataset.mode = 'expanded';
          this._loadContent(name);
        }
      } else {
        if (card.el.dataset.mode !== 'compact') {
          card.el.dataset.mode = 'compact';
          const body = card.el.querySelector('.card-body');
          body.innerHTML = card.summary || '';
        }
      }
    }
  },

  async _loadContent(name) {
    const card = this.cards.get(name);
    if (!card) return;
    try {
      const data = await fetch(`/api/mentals/${encodeURIComponent(name)}`).then(r => r.json());
      card.content = data.content;
      card.links = Link.parseLinks(data.content);
      if (card.el.dataset.mode === 'expanded') {
        const body = card.el.querySelector('.card-body');
        body.innerHTML = this._renderMarkdown(data.content);
      }
    } catch {}
  },

  // Public: force refresh a card (called from notify)
  async refresh(name) {
    await this._loadContent(name);
    Link.render();
  },

  _renderMarkdown(md) {
    if (!md) return '';
    return md
      .replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/^### (.+)$/gm, '<h4>$1</h4>')
      .replace(/^## (.+)$/gm, '<h3>$1</h3>')
      .replace(/^# (.+)$/gm, '<h2>$1</h2>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_, target, display) => 
        `<span class="wiki-link" data-target="${target}">${display || target}</span>`)
      .replace(/\n/g, '<br>');
  },

  _bindDrag(el, name) {
    let dragging = false;
    let offset = { x: 0, y: 0 };

    el.addEventListener('mousedown', (e) => {
      if (e.target.closest('.card-chat')) return;
      dragging = true;
      const card = this.cards.get(name);
      const cx = e.clientX / Transform.viewport.zoom + Transform.viewport.x;
      const cy = e.clientY / Transform.viewport.zoom + Transform.viewport.y;
      offset = { x: cx - card.x, y: cy - card.y };
      el.style.cursor = 'grabbing';
      e.stopPropagation();
    });

    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const card = this.cards.get(name);
      card.x = e.clientX / Transform.viewport.zoom + Transform.viewport.x - offset.x;
      card.y = e.clientY / Transform.viewport.zoom + Transform.viewport.y - offset.y;
      card.el.style.left = card.x + 'px';
      card.el.style.top = card.y + 'px';
      Link.render();
    });

    window.addEventListener('mouseup', () => {
      if (dragging) {
        dragging = false;
        el.style.cursor = '';
        App.saveCanvas();
      }
    });
  },

  getRect(name) {
    const card = this.cards.get(name);
    if (!card) return null;
    return { x: card.x, y: card.y, w: card.el.offsetWidth, h: card.el.offsetHeight };
  }
};