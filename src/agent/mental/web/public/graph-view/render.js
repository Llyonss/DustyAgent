// === GraphView / Render ===
// 职责：iface + positions + lanes → SVG 字符串（拼字符串，不算坐标）

var SVG_NS = 'http://www.w3.org/2000/svg';

// 边的类型 → 颜色 + 是否虚线
var EDGE_STYLE = {
  call:  { color: '#4ecdc4', dash: 'none',  label: '' },
  http:  { color: '#ffe66d', dash: 'none',  label: 'HTTP' },
  ws:    { color: '#a855f7', dash: 'none',  label: 'WS' },
  async: { color: '#f97316', dash: '6 4',   label: 'async' },
  fs:    { color: '#84cc16', dash: '2 5',   label: 'fs' },
  write: { color: '#ff6b81', dash: '4 4',   label: '写' },
  read:  { color: '#06b6d4', dash: '4 4',   label: '读' }
};

// 接口 kind → 徽标
var KIND_BADGE = {
  command: { icon: '▶', color: '#4ecdc4' },
  query:   { icon: '◉', color: '#06b6d4' },
  http:    { icon: '⇢', color: '#ffe66d' },
  ws:      { icon: '⇄', color: '#a855f7' },
  cron:    { icon: '⏱', color: '#f97316' },
  duplex:  { icon: '⇄', color: '#a855f7' }
};

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// desc 截断到 maxLines 行、每行 maxChars 字符，超出末行加省略号
function clampDesc(desc, maxChars, maxLines) {
  var words = String(desc || '').split('');
  var lines = [];
  var cur = '';
  for (var i = 0; i < words.length; i++) {
    cur += words[i];
    if (cur.length >= maxChars) { lines.push(cur); cur = ''; if (lines.length >= maxLines) break; }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  var truncated = (words.length > lines.join('').length);
  if (truncated && lines.length) lines[lines.length - 1] = lines[lines.length - 1].replace(/.$/, '…');
  return lines;
}

export function renderSVG(iface, lay, storeMap) {
  var positions = lay.positions;
  var parts = [];
  parts.push('<svg class="gv-svg" width="' + lay.canvasW + '" height="' + lay.canvasH
    + '" viewBox="0 0 ' + lay.canvasW + ' ' + lay.canvasH + '" xmlns="' + SVG_NS + '">');

  // defs：箭头
  parts.push('<defs>');
  for (var k in EDGE_STYLE) {
    if (!EDGE_STYLE.hasOwnProperty(k)) continue;
    parts.push('<marker id="gv-arr-' + k + '" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">'
      + '<path d="M0,0 L8,3 L0,6 Z" fill="' + EDGE_STYLE[k].color + '"/></marker>');
  }
  parts.push('</defs>');

  // 背景
  parts.push('<rect x="0" y="0" width="' + lay.canvasW + '" height="' + lay.canvasH + '" fill="#0c0c16"/>');

  // 泳道背景（隔行浅色 + 存储区高亮）
  for (var li = 0; li < lay.lanes.length; li++) {
    var lane = lay.lanes[li];
    var fill = lane.isStore ? 'rgba(255,107,129,0.05)' : (li % 2 ? 'rgba(255,255,255,0.015)' : 'transparent');
    parts.push('<rect x="0" y="' + lane.y + '" width="' + lay.canvasW + '" height="' + lane.h
      + '" fill="' + fill + '" data-gv-lane="' + esc(lane.key) + '" class="gv-lane"/>');
    parts.push('<line x1="0" y1="' + (lane.y + lane.h) + '" x2="' + lay.canvasW + '" y2="' + (lane.y + lane.h)
      + '" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>');
  }

  // ---- 边 ----
  parts.push(renderEdges(iface, positions, storeMap));

  // ---- 节点 ----
  for (var i = 0; i < iface.steps.length; i++) {
    parts.push(renderStepNode(iface.steps[i], positions[iface.steps[i].id]));
  }
  var usedStores = collectUsedStores(iface, storeMap);
  for (var ui = 0; ui < usedStores.length; ui++) {
    var sid = usedStores[ui];
    parts.push(renderStoreNode(storeMap[sid], positions['store:' + sid]));
  }

  parts.push('</svg>');
  return parts.join('');
}

function collectUsedStores(iface, storeMap) {
  var seen = {}, out = [];
  var wr = iface.writes.concat(iface.reads);
  for (var i = 0; i < wr.length; i++) {
    if (storeMap[wr[i]] && !seen[wr[i]]) { seen[wr[i]] = 1; out.push(wr[i]); }
  }
  return out;
}

function edgePath(from, to) {
  var x1 = from.x + from.w, y1 = from.y + from.h / 2;
  var x2 = to.x, y2 = to.y + to.h / 2;
  // store 立柱：从上方/下方连入，走垂直
  var mx = (x1 + x2) / 2;
  return 'M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2;
}

// 竖直方向连 store（step→store 上下关系）
function edgePathV(from, to) {
  var fromBelow = to.y > from.y;
  var x1 = from.x + from.w / 2, y1 = fromBelow ? from.y + from.h : from.y;
  var x2 = to.x + to.w / 2,     y2 = fromBelow ? to.y : to.y + to.h;
  var my = (y1 + y2) / 2;
  return 'M' + x1 + ',' + y1 + ' C' + x1 + ',' + my + ' ' + x2 + ',' + my + ' ' + x2 + ',' + y2;
}

function drawEdge(d, style, label, markerKind) {
  var s = '';
  s += '<path d="' + d + '" stroke="' + style.color + '" stroke-opacity="0.65" fill="none" stroke-width="2"'
    + ' stroke-dasharray="' + style.dash + '" marker-end="url(#gv-arr-' + markerKind + ')" class="gv-edge"/>';
  s += '<path d="' + d + '" stroke="' + style.color + '" stroke-opacity="0.08" fill="none" stroke-width="7" pointer-events="none"/>';
  if (label) {
    // 标签放路径中点附近（粗略取起点，交给 SVG 自然）
    var m = d.match(/M([\d.]+),([\d.]+).*?([\d.]+),([\d.]+)$/);
    if (m) {
      var lx = (parseFloat(m[1]) + parseFloat(m[3])) / 2;
      var ly = (parseFloat(m[2]) + parseFloat(m[4])) / 2 - 6;
      s += '<rect x="' + (lx - label.length * 3.5 - 4) + '" y="' + (ly - 10) + '" width="' + (label.length * 7 + 8)
        + '" height="14" rx="3" fill="#0c0c16" fill-opacity="0.85"/>';
      s += '<text x="' + lx + '" y="' + (ly + 1) + '" text-anchor="middle" fill="' + style.color
        + '" font-size="9.5" font-family="monospace" font-weight="600">' + esc(label) + '</text>';
    }
  }
  return s;
}

function renderEdges(iface, positions, storeMap) {
  var out = [];
  var explicit = {};   // 已被 edges 显式声明的 from->to，避免与相邻默认边重复

  // 1. 显式 edges
  for (var ei = 0; ei < iface.edges.length; ei++) {
    var e = iface.edges[ei];
    var from = positions[e.from], to = positions[e.to];
    if (!from || !to) continue;
    explicit[e.from + '>' + e.to] = 1;
    var style = EDGE_STYLE[e.kind] || EDGE_STYLE.call;
    var d = edgePath(from, to);
    out.push(drawEdge(d, style, e.label || style.label, EDGE_STYLE[e.kind] ? e.kind : 'call'));
  }

  // 2. 相邻 step 默认 call 边（未被显式声明时）
  for (var i = 0; i + 1 < iface.steps.length; i++) {
    var a = iface.steps[i], b = iface.steps[i + 1];
    if (explicit[a.id + '>' + b.id]) continue;
    var pa = positions[a.id], pb = positions[b.id];
    if (!pa || !pb) continue;
    out.push(drawEdge(edgePath(pa, pb), EDGE_STYLE.call, '', 'call'));
  }

  // 3. step ↔ store：最后一个 step 连 writes；第一个 step 连 reads
  //    命令链写存储：末 step → store（写）；查询链读存储：store → 首 step（读）
  var steps = iface.steps;
  if (steps.length) {
    for (var wi = 0; wi < iface.writes.length; wi++) {
      var sp = positions['store:' + iface.writes[wi]];
      var last = positions[steps[steps.length - 1].id];
      if (sp && last) out.push(drawEdge(edgePathV(last, sp), EDGE_STYLE.write, EDGE_STYLE.write.label, 'write'));
    }
    for (var ri = 0; ri < iface.reads.length; ri++) {
      var sp2 = positions['store:' + iface.reads[ri]];
      var first = positions[steps[0].id];
      if (sp2 && first) out.push(drawEdge(edgePathV(sp2, first), EDGE_STYLE.read, EDGE_STYLE.read.label, 'read'));
    }
  }

  return out.join('');
}

function renderStepNode(step, pos) {
  if (!pos) return '';
  var g = '<g class="gv-node' + (step.external ? ' gv-external' : '') + '" data-gv-nid="' + esc(step.id)
    + '" data-gv-file="' + esc(step.file) + '" transform="translate(' + pos.x + ',' + pos.y + ')">';
  var stroke = step.external ? 'rgba(255,255,255,0.12)' : 'rgba(120,220,210,0.35)';
  g += '<rect x="0" y="0" width="' + pos.w + '" height="' + pos.h + '" rx="8" fill="'
    + (step.external ? '#141420' : '#151d2e') + '" stroke="' + stroke + '" stroke-width="1.2" class="gv-node-rect"/>';

  // symbol（标题）
  g += '<text x="12" y="20" fill="#e6f2ee" font-size="12.5" font-weight="700" font-family="\'Cascadia Code\',monospace">'
    + esc(clip(step.symbol, 26)) + '</text>';
  // desc（灰色小字，截断 2 行）
  var lines = clampDesc(step.desc, 26, 2);
  for (var i = 0; i < lines.length; i++) {
    g += '<text x="12" y="' + (38 + i * 15) + '" fill="#8a99a8" font-size="10.5" font-family="system-ui">'
      + esc(lines[i]) + '</text>';
  }
  // 入端口（左）
  g += portDots(step.in, 0, pos.h, 'in');
  // 出端口（右）
  g += portDots(step.out, pos.w, pos.h, 'out');
  g += '</g>';
  return g;
}

function portDots(list, cx, h, side) {
  if (!list || !list.length) return '';
  var s = '';
  var n = list.length;
  for (var i = 0; i < n; i++) {
    var cy = (i + 1) * h / (n + 1);
    s += '<circle cx="' + cx + '" cy="' + cy + '" r="4.5" fill="#151d2e" stroke="#7cdcd2" stroke-width="1.8"/>';
    s += '<circle cx="' + cx + '" cy="' + cy + '" r="2" fill="#7cdcd2"/>';
    var tx = side === 'in' ? cx - 8 : cx + 8;
    var anchor = side === 'in' ? 'end' : 'start';
    s += '<text x="' + tx + '" y="' + (cy + 3) + '" text-anchor="' + anchor
      + '" fill="#6a8a86" font-size="9" font-family="monospace">' + esc(clip(list[i], 14)) + '</text>';
  }
  return s;
}

function renderStoreNode(store, pos) {
  if (!pos || !store) return '';
  var g = '<g class="gv-node gv-store" data-gv-nid="store:' + esc(store.id)
    + '" transform="translate(' + pos.x + ',' + pos.y + ')">';
  g += '<rect x="0" y="0" width="' + pos.w + '" height="' + pos.h + '" rx="8" fill="rgba(255,107,129,0.08)"'
    + ' stroke="#ff6b81" stroke-opacity="0.5" stroke-width="1.4" class="gv-node-rect"/>';
  g += '<text x="12" y="22" fill="#ffb3c0" font-size="12.5" font-weight="700" font-family="\'Cascadia Code\',monospace">🗄 '
    + esc(clip(store.path || store.id, 28)) + '</text>';
  var lines = clampDesc(store.desc, 30, 2);
  for (var i = 0; i < lines.length; i++) {
    g += '<text x="12" y="' + (40 + i * 15) + '" fill="#c99aa4" font-size="10.5" font-family="system-ui">'
      + esc(lines[i]) + '</text>';
  }
  g += '</g>';
  return g;
}

function clip(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export { KIND_BADGE };
