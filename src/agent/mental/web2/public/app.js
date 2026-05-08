const App = {
  canvasData: null,

  async init() {
    // Load canvas state
    this.canvasData = await fetch('/api/canvas').then(r => r.json());
    Transform.viewport = this.canvasData.viewport || { x: 0, y: 0, zoom: 1 };

    // Load links data for layout clustering
    let linksData = {};
    try {
      linksData = await fetch('/api/links').then(r => r.json());
    } catch {}

    // Init modules
    Canvas.init();
    Link.init();
    await Card.loadAll(this.canvasData, linksData);
    
    // Expand visible cards after layout settles
    setTimeout(() => {
      Link.render();
      Card.updateVisibility();
    }, 300);

    Notify.connect();

    // Listen for updates
    Notify.on('mental-updated', (data) => Card.refresh(data.name));
    Notify.on('mental-created', (data) => {
      const pos = Transform.toCanvas(window.innerWidth / 2, window.innerHeight / 2);
      Card.create(data.name, pos.x, pos.y, '');
      this.saveCanvas();
    });
    Notify.on('mental-deleted', (data) => {
      const card = Card.cards.get(data.name);
      if (card) { card.el.remove(); Card.cards.delete(data.name); }
      Link.render();
    });

    // Toolbar
    document.getElementById('btn-add').onclick = () => {
      const name = prompt('心智名称:');
      if (!name || !name.trim()) return;
      fetch('/api/mentals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() })
      });
    };
  },

  async saveCanvas() {
    const cards = {};
    for (const [name, card] of Card.cards) {
      cards[name] = { x: card.x, y: card.y };
    }
    await fetch('/api/canvas', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ viewport: Transform.viewport, cards })
    });
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());