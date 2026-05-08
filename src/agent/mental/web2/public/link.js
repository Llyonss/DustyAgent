const Link = {
  ctx: null,

  init() {
    this.ctx = document.getElementById('lines-canvas').getContext('2d');
  },

  render() {
    if (!this.ctx) return;
    const canvas = document.getElementById('lines-canvas');
    this.ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const [name, card] of Card.cards) {
      const links = card.links;
      if (!links || !links.length) continue;
      const isExpanded = card.el.dataset.mode === 'expanded';
      for (const link of links) {
        const targetCard = Card.cards.get(link.target);
        if (!targetCard) continue;
        if (isExpanded) {
          this._drawLineFromText(card, link, targetCard);
        } else {
          this._drawLineCardToCard(card, targetCard);
        }
      }
    }
  },

  parseLinks(content) {
    const re = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;
    const links = [];
    let match;
    while ((match = re.exec(content)) !== null) {
      links.push({ target: match[1], display: match[2] || match[1] });
    }
    return links;
  },

  _drawLineFromText(card, link, targetCard) {
    // Find wiki-link span in card body
    const spans = card.el.querySelectorAll('.wiki-link');
    for (const span of spans) {
      if (span.dataset.target === link.target) {
        const srcRect = span.getBoundingClientRect();
        const sx = srcRect.right;
        const sy = srcRect.top + srcRect.height / 2;
        const tx = targetCard.el.getBoundingClientRect().left;
        const ty = targetCard.el.getBoundingClientRect().top + targetCard.el.getBoundingClientRect().height / 2;
        this._bezier(sx, sy, tx, ty);
        return;
      }
    }
    // fallback: card edge to card edge
    this._drawLineCardToCard(card, targetCard);
  },

  _drawLineCardToCard(card, targetCard) {
    const srcRect = card.el.getBoundingClientRect();
    const dstRect = targetCard.el.getBoundingClientRect();
    const sx = srcRect.right;
    const sy = srcRect.top + srcRect.height / 2;
    const tx = dstRect.left;
    const ty = dstRect.top + dstRect.height / 2;
    this._bezier(sx, sy, tx, ty);
  },

  _bezier(x1, y1, x2, y2) {
    const cpOffset = Math.abs(x2 - x1) * 0.4;
    this.ctx.beginPath();
    this.ctx.moveTo(x1, y1);
    this.ctx.bezierCurveTo(x1 + cpOffset, y1, x2 - cpOffset, y2, x2, y2);
    this.ctx.strokeStyle = 'rgba(83, 146, 255, 0.25)';
    this.ctx.lineWidth = 1.2;
    this.ctx.stroke();
  }
};
