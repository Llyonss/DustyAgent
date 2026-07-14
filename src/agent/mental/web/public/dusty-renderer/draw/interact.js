// === Dusty Draw / Interact ===
// 数据流图交互：±层级切换（重聚类重画）+ 缩放平移 + 悬停高亮
// 层级由同一个 clusterOnLayout 算法产生（复用 L0 坐标，合并不重排），interact 只负责触发重渲染与视图操作。

import { clusterOnLayout } from '../layout/cluster.js';
import { renderSVG } from '../render/svg.js';

export function initDataFlowInteraction(rootEl) {
  if (rootEl.dataset.dfInit) return;
  rootEl.dataset.dfInit = '1';

  // ---- boot 数据：原始细粒度 graph ----
  var boot = null;
  var bootEl = rootEl.querySelector('.df-boot');
  if (bootEl) { try { boot = JSON.parse(bootEl.textContent); } catch (e) {} }
  if (!boot) return;
  var graph = boot;

  var view = rootEl.querySelector('.df-view');
  var label = rootEl.querySelector('.df-lv-label');
  var btnInc = rootEl.querySelector('.df-lv-inc');
  var btnDec = rootEl.querySelector('.df-lv-dec');

  var level = 0;
  var listeners = [];
  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    listeners.push({ target: target, type: type, fn: fn });
  }

  // ---- 重渲染某层级（复用 L0 坐标，合并不重排） ----
  function rerender() {
    var c = clusterOnLayout(graph.nodes, graph.edges, graph.positions, graph.layerOf, level);
    var pos = {}, lines = {};
    for (var i = 0; i < c.nodes.length; i++) {
      var b = c.nodes[i];
      pos[b.id] = { x: b.x, y: b.y, w: b.w, h: b.h };
      lines[b.id] = (b.text || '').split('\n');
    }
    // 保存当前视角（viewBox）与画布尺寸，层级切换后恢复，避免画布归零/跳变
    var prevSvg = view.querySelector('.df-svg');
    var savedVB = null, savedW = null, savedH = null;
    if (prevSvg) {
      var pvb = prevSvg.viewBox.baseVal;
      savedVB = { x: pvb.x, y: pvb.y, w: pvb.width, h: pvb.height };
      savedW = prevSvg.getAttribute('width');
      savedH = prevSvg.getAttribute('height');
    }

    view.innerHTML = renderSVG(c.nodes, c.edges, graph.containers,
      pos, graph.containerPositions, function (s) { return esc(s); }, lines);

    var newSvg = view.querySelector('.df-svg');
    if (newSvg && savedVB) {
      // 画布 DOM 尺寸沿用 L0，保证元素不跳变
      if (savedW) newSvg.setAttribute('width', savedW);
      if (savedH) newSvg.setAttribute('height', savedH);
      // viewBox 沿用上一层级视角
      var nvb = newSvg.viewBox.baseVal;
      nvb.x = savedVB.x; nvb.y = savedVB.y;
      nvb.width = savedVB.w; nvb.height = savedVB.h;
    }

    if (label) label.textContent = 'L' + level;
    bindSvg();
  }

  function esc(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- ± 按钮 ----
  if (btnInc) on(btnInc, 'click', function () { level++; rerender(); });
  if (btnDec) on(btnDec, 'click', function () { if (level > 0) { level--; rerender(); } });

  // ---- 绑定当前 SVG 的缩放/平移/悬停 ----
  var svgListeners = [];
  function bindSvg() {
    // 清理上一版 SVG 的监听
    for (var i = 0; i < svgListeners.length; i++) {
      svgListeners[i].target.removeEventListener(svgListeners[i].type, svgListeners[i].fn);
    }
    svgListeners = [];

    var svg = view.querySelector('.df-svg');
    if (!svg) return;
    var vb = svg.viewBox.baseVal;

    function sOn(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      svgListeners.push({ target: target, type: type, fn: fn });
    }
    function getPos(e) {
      var r = svg.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
    }
    function zoomAt(scale, cx, cy, rw, rh) {
      var vx = vb.x + cx * vb.width / rw;
      var vy = vb.y + cy * vb.height / rh;
      vb.width = Math.max(200, Math.min(20000, vb.width * scale));
      vb.height = Math.max(100, Math.min(20000, vb.height * scale));
      vb.x = vx - cx * vb.width / rw;
      vb.y = vy - cy * vb.height / rh;
    }

    sOn(svg, 'wheel', function (e) {
      e.preventDefault();
      var p = getPos(e);
      zoomAt(e.deltaY > 0 ? 1.1 : 0.9, p.x, p.y, p.w, p.h);
    }, { passive: false });

    var panning = false, sx, sy;
    function isPannable(el) {
      if (!el || el === svg) return true;
      if (el.classList.contains('df-container-rect')) return true;
      if (el.tagName === 'rect' && el.parentNode === svg && !el.classList.length) return true;
      if (el.closest('foreignObject')) return true;
      return false;
    }
    sOn(svg, 'mousedown', function (e) {
      if (isPannable(e.target)) { panning = true; sx = e.clientX; sy = e.clientY; svg.style.cursor = 'grabbing'; }
    });
    sOn(window, 'mousemove', function (e) {
      if (!panning) return;
      var r = svg.getBoundingClientRect();
      vb.x -= (e.clientX - sx) * vb.width / r.width;
      vb.y -= (e.clientY - sy) * vb.height / r.height;
      sx = e.clientX; sy = e.clientY;
    });
    sOn(window, 'mouseup', function () { panning = false; svg.style.cursor = ''; });

    // 触屏
    var pinching = false, pinchDist0, pinchCX, pinchCY, vbW0, vbH0, vbX0, vbY0;
    sOn(svg, 'touchstart', function (e) {
      if (e.touches.length === 1) { panning = true; pinching = false; sx = e.touches[0].clientX; sy = e.touches[0].clientY; }
      else if (e.touches.length === 2) {
        panning = false; pinching = true;
        var t0 = e.touches[0], t1 = e.touches[1];
        pinchDist0 = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        pinchCX = (t0.clientX + t1.clientX) / 2; pinchCY = (t0.clientY + t1.clientY) / 2;
        vbW0 = vb.width; vbH0 = vb.height; vbX0 = vb.x; vbY0 = vb.y;
      }
    }, { passive: false });
    sOn(svg, 'touchmove', function (e) {
      e.preventDefault();
      var r = svg.getBoundingClientRect();
      if (panning && e.touches.length === 1) {
        vb.x -= (e.touches[0].clientX - sx) * vb.width / r.width;
        vb.y -= (e.touches[0].clientY - sy) * vb.height / r.height;
        sx = e.touches[0].clientX; sy = e.touches[0].clientY;
      } else if (pinching && e.touches.length === 2) {
        var t0 = e.touches[0], t1 = e.touches[1];
        var dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        var sc = pinchDist0 / dist;
        var cx = pinchCX - r.left, cy = pinchCY - r.top;
        vb.width = Math.max(200, Math.min(20000, vbW0 * sc));
        vb.height = Math.max(100, Math.min(20000, vbH0 * sc));
        vb.x = vbX0 + cx * vbW0 / r.width - cx * vb.width / r.width;
        vb.y = vbY0 + cy * vbH0 / r.height - cy * vb.height / r.height;
      }
    }, { passive: false });
    sOn(svg, 'touchend', function () { panning = false; pinching = false; });

    // 悬停高亮
    var tooltip = ensureTooltip();
    sOn(svg, 'mouseover', function (e) {
      var port = e.target.closest('.df-port');
      var nr = e.target.closest('.df-node-rect');
      var edge = e.target.closest('.df-edge');
      svg.querySelectorAll('.df-hl').forEach(function (el) { el.classList.remove('df-hl'); });
      if (port) {
        var v = port.dataset.dfVar;
        svg.querySelectorAll('.df-port').forEach(function (p) { if (p.dataset.dfVar === v) p.classList.add('df-hl'); });
        svg.querySelectorAll('.df-edge').forEach(function (ed) { if (ed.dataset.dfVar === v) ed.classList.add('df-hl'); });
        tooltip.style.display = 'block'; tooltip.textContent = '变量: ' + v;
      } else if (nr) {
        var nid = nr.closest('.df-node').dataset.dfNid;
        nr.classList.add('df-hl');
        var vars = {};
        svg.querySelectorAll('.df-port').forEach(function (p) { if (p.dataset.dfNid === nid) { p.classList.add('df-hl'); vars[p.dataset.dfVar] = true; } });
        svg.querySelectorAll('.df-edge').forEach(function (ed) { if (vars[ed.dataset.dfVar]) ed.classList.add('df-hl'); });
        tooltip.style.display = 'block';
        var titleEl = nr.closest('.df-node').querySelector('title');
        tooltip.textContent = (titleEl && titleEl.textContent || '').replace(/&#10;/g, ' | ');
      } else if (edge) {
        edge.classList.add('df-hl');
        var ev = edge.dataset.dfVar;
        svg.querySelectorAll('.df-port').forEach(function (p) { if (p.dataset.dfVar === ev) p.classList.add('df-hl'); });
        tooltip.style.display = 'block'; tooltip.textContent = '变量: ' + ev;
      }
    });
    sOn(svg, 'mousemove', function (e) {
      if (tooltip.style.display === 'block') {
        var r = svg.getBoundingClientRect();
        tooltip.style.left = (e.clientX - r.left + 15) + 'px';
        tooltip.style.top = (e.clientY - r.top - 30) + 'px';
      }
    });
    sOn(svg, 'mouseout', function (e) {
      if (!e.target.closest('.df-port') && !e.target.closest('.df-node-rect') && !e.target.closest('.df-edge')) {
        svg.querySelectorAll('.df-hl').forEach(function (el) { el.classList.remove('df-hl'); });
        tooltip.style.display = 'none';
      }
    });
  }

  function ensureTooltip() {
    var tooltip = rootEl.querySelector('.df-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.className = 'df-tooltip';
      tooltip.style.cssText = 'position:absolute;background:rgba(0,0,0,0.88);color:#fff;padding:6px 10px;border-radius:4px;font-size:12px;pointer-events:none;display:none;z-index:100;white-space:nowrap;';
      rootEl.style.position = 'relative';
      rootEl.appendChild(tooltip);
    }
    return tooltip;
  }

  // 初次绑定已渲染的 L0 SVG
  bindSvg();

  rootEl._dfDestroy = function () {
    for (var i = 0; i < listeners.length; i++) listeners[i].target.removeEventListener(listeners[i].type, listeners[i].fn);
    for (var j = 0; j < svgListeners.length; j++) svgListeners[j].target.removeEventListener(svgListeners[j].type, svgListeners[j].fn);
    listeners = []; svgListeners = [];
  };
}
