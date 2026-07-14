// === Dusty Renderer ===
// JS 源码 → 数据流可视化图
// 每个语句块：左入参端口 · 代码文本 · 右出参端口，同变量名连线着色，控制流容器包裹
// 层级 L：同一聚类算法把连续语句合并成更粗的语句块（控制流为边界），±按钮切换

import { parseMarkers, hasMarkers } from './parse/markers.js';
import { analyzeDataFlow } from './parse/dataflow.js';
import { clusterOnLayout } from './layout/cluster.js';
import { layout } from './layout/layered.js';
import { renderSVG } from './render/svg.js';
import { initDataFlowInteraction } from './draw/interact.js';
import { getEsc } from './shared.js';

// 组块自带 x/y/w/h → positions 表（喂给 renderSVG，它只认 positions）
export function blocksToPositions(blocks) {
  var pos = {};
  var lines = {};
  for (var i = 0; i < blocks.length; i++) {
    var b = blocks[i];
    pos[b.id] = { x: b.x, y: b.y, w: b.w, h: b.h };
    lines[b.id] = (b.text || '').split('\n');
  }
  return { positions: pos, nodeLines: lines };
}

// graph + L0布局 + 层级 → SVG（供初次渲染与按钮切换复用）
export function renderGraphAtLevel(graph, lay, L, esc) {
  var c = clusterOnLayout(graph.nodes, graph.edges, lay.positions, lay.layerOf, L);
  var p = blocksToPositions(c.nodes);
  return renderSVG(c.nodes, c.edges, graph.containers, p.positions, lay.containerPositions, esc, p.nodeLines);
}

export const DustyRenderer = {
  render: function(text, opts) {
    if (!text) return '';
    opts = opts || {};
    var ext = opts.ext || '';
    var esc = getEsc(opts.esc);

    var rawSegments = parseMarkers(text);

    if (rawSegments.length === 1 && rawSegments[0].type === 'raw' && !hasMarkers(text)) {
      return this._renderCode(rawSegments[0].content, ext, esc);
    }

    var html = '';
    for (var i = 0; i < rawSegments.length; i++) {
      var seg = rawSegments[i];
      if (seg.type === 'card') {
        html += this._renderCode(seg.content, ext, esc);
      } else {
        if (seg.content.trim()) html += '<div class="dusty-raw">' + esc(seg.content) + '</div>';
      }
    }
    return html;
  },

  _renderCode: function(code, ext, esc) {
    var graph = analyzeDataFlow(code, ext);
    if (graph && graph.nodes.length) {
      // 布局只跑一次（L0），后续所有层级复用这套坐标，合并不重排
      var lay = layout(graph.nodes, graph.edges, graph.containers);
      if (lay.error) return '<div class="dusty-raw" style="color:#d45b5b">布局错误: ' + esc(lay.error) + '</div>';

      var svg = renderGraphAtLevel(graph, lay, 0, esc);

      // graph + L0 布局坐标序列化，供客户端按 L 重新聚类渲染
      var bootData = JSON.stringify({
        nodes: graph.nodes, edges: graph.edges, containers: graph.containers,
        positions: lay.positions, containerPositions: lay.containerPositions, layerOf: lay.layerOf
      }).replace(/</g, '\\u003c');

      return '<div class="df-wrapper">'
        + '<div class="df-toolbar">'
        +   '<button class="df-lv-dec" title="更粗">\u2212</button>'
        +   '<span class="df-lv-label">L0</span>'
        +   '<button class="df-lv-inc" title="更细">+</button>'
        +   '<span class="df-stats-inline">节点:' + graph.nodes.length + ' 连线:' + graph.edges.length + '</span>'
        + '</div>'
        + '<script type="application/json" class="df-boot">' + bootData + '</script>'
        + '<div class="df-view">' + svg + '</div>'
        + '</div>';
    }
    if (code.trim()) return '<div class="dusty-raw">' + esc(code) + '</div>';
    return '';
  },

  renderTo: function(el, text, opts) {
    opts = opts || {};
    var old = el.querySelectorAll('.df-wrapper');
    for (var oi = 0; oi < old.length; oi++) {
      if (old[oi]._dfDestroy) old[oi]._dfDestroy();
    }
    el.innerHTML = this.render(text, opts);
    requestAnimationFrame(function() {
      var wrappers = el.querySelectorAll('.df-wrapper');
      for (var i = 0; i < wrappers.length; i++) {
        initDataFlowInteraction(wrappers[i]);
      }
    });
  },

  hasDustyMarkers: hasMarkers
};
