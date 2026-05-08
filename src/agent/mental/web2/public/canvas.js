const Canvas = {
  viewport: null,
  cardsLayer: null,
  linesCanvas: null,
  isDragging: false,
  dragStart: null,

  init() {
    this.viewport = document.getElementById('canvas-viewport');
    this.cardsLayer = document.getElementById('cards-layer');
    this.linesCanvas = document.getElementById('lines-canvas');
    this.resizeLines();
    this.bindEvents();
    this.updateTransform();
    // Initial visibility check after cards load
    setTimeout(() => Card.updateVisibility(), 200);
  },

  resizeLines() {
    this.linesCanvas.width = window.innerWidth;
    this.linesCanvas.height = window.innerHeight;
    window.addEventListener('resize', () => {
      this.linesCanvas.width = window.innerWidth;
      this.linesCanvas.height = window.innerHeight;
      Card.updateVisibility();
    });
  },

  bindEvents() {
    // Pan: drag on blank area
    this.viewport.addEventListener('mousedown', (e) => {
      if (e.target === this.viewport || e.target === this.linesCanvas) {
        this.isDragging = true;
        this.dragStart = {
          sx: e.clientX, sy: e.clientY,
          vx: Transform.viewport.x, vy: Transform.viewport.y
        };
        this.viewport.style.cursor = 'grabbing';
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.dragStart.sx;
      const dy = e.clientY - this.dragStart.sy;
      Transform.viewport.x = this.dragStart.vx - dx / Transform.viewport.zoom;
      Transform.viewport.y = this.dragStart.vy - dy / Transform.viewport.zoom;
      this.updateTransform();
    });

    window.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false;
        this.viewport.style.cursor = '';
        App.saveCanvas();
      }
    });

    // Zoom
    this.viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      Transform.zoomAt(e.clientX, e.clientY, factor);
      this.updateTransform();
      document.getElementById('zoom-indicator').textContent = 
        Math.round(Transform.viewport.zoom * 100) + '%';
    }, { passive: false });
  },

  updateTransform() {
    const { x, y, zoom } = Transform.viewport;
    this.cardsLayer.style.transform = `scale(${zoom}) translate(${-x}px, ${-y}px)`;
    Card.updateVisibility();
    Link.render();
  }
};