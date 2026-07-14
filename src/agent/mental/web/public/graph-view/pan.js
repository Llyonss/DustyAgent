// === GraphView / Pan ===
// 职责：给滚动容器加鼠标左键按住拖拽平移

export function initPan(scrollEl) {
  if (!scrollEl || scrollEl._gvPanBound) return;
  scrollEl._gvPanBound = true;

  var dragging = false;
  var startX = 0, startY = 0, startL = 0, startT = 0;
  var moved = false;

  scrollEl.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;          // 仅左键
    dragging = true; moved = false;
    startX = e.clientX; startY = e.clientY;
    startL = scrollEl.scrollLeft; startT = scrollEl.scrollTop;
    scrollEl.classList.add('gv-panning');
  });

  window.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    var dx = e.clientX - startX, dy = e.clientY - startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    scrollEl.scrollLeft = startL - dx;
    scrollEl.scrollTop = startT - dy;
  });

  window.addEventListener('mouseup', function() {
    if (!dragging) return;
    dragging = false;
    scrollEl.classList.remove('gv-panning');
  });

  // 拖拽结束后抑制点击穿透（避免误触节点）
  scrollEl.addEventListener('click', function(e) {
    if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; }
  }, true);
}
