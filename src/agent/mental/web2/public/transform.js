const Transform = {
  viewport: { x: 0, y: 0, zoom: 1 },

  toScreen(cx, cy) {
    return {
      x: (cx - this.viewport.x) * this.viewport.zoom,
      y: (cy - this.viewport.y) * this.viewport.zoom
    };
  },

  toCanvas(sx, sy) {
    return {
      x: sx / this.viewport.zoom + this.viewport.x,
      y: sy / this.viewport.zoom + this.viewport.y
    };
  },

  zoomAt(sx, sy, factor) {
    const pivot = this.toCanvas(sx, sy);
    this.viewport.zoom = Math.max(0.1, Math.min(5, this.viewport.zoom * factor));
    this.viewport.x = pivot.x - sx / this.viewport.zoom;
    this.viewport.y = pivot.y - sy / this.viewport.zoom;
  },

  getZoomLevel() {
    const z = this.viewport.zoom;
    if (z < 0.3) return 'far';
    if (z < 0.7) return 'mid';
    if (z < 1.5) return 'near';
    return 'edit';
  }
};
