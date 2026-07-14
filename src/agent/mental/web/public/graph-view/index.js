// === GraphView / 入口 ===
// 职责：编排 parse→layout→render→interact，管接口切换
// 挂载点：files/index.js 的 ext==='graph' 分支调用 GraphView.renderTo(el, text)

import { parseGraph } from './parse.js';
import { layoutInterface } from './layout.js';
import { renderSVG, KIND_BADGE } from './render.js';
import { initInteraction, destroyTip } from './interact.js';
import { collectAll, relatedOf } from './tree.js';
import { initPan } from './pan.js';
import { buildRealTree, applyRelated } from './gvtree.js';

function esc(s) {
  return (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const GraphView = {
  _data: null,
  _current: null,

  isGraphFile: function(ext) { return ext === 'graph'; },

  renderTo: function(el, text) {
    destroyTip();
    var parsed = parseGraph(text);
    if (parsed.error) {
      el.innerHTML = '<div class="empty">.graph 解析失败: ' + esc(parsed.error) + '</div>';
      return;
    }
    this._data = parsed;

    // 三区骨架：树区分 内部真实树 + 外部组（一次性构建，切接口只切高亮）
    el.innerHTML =
      '<div class="gv-root">'
      + '<div class="gv-tabs" id="gvTabs"></div>'
      + '<div class="gv-body">'
      +   '<div class="gv-tree" id="gvTree">'
      +     '<div id="gvTreeReal"></div>'
      +     '<div id="gvTreeExt"></div>'
      +   '</div>'
      +   '<div class="gv-canvas" id="gvCanvas"></div>'
      + '</div>'
      + '</div>';

    this._renderTabs();

    var self = this;
    // 全图收集：外部依赖完整树 + 服务全集 + 存储全集（一次）
    this._collected = collectAll(parsed.interfaces, parsed.stores, parsed.root);
    this._renderExtGroup(this._collected);
    // 内部真实目录树（一次，懒加载）
    var treeSpec = {
      rootPath: this._collected.rootPath,
      rootName: this._collected.rootName,
      onFileHover: function(laneKey, on) { self._hiLane(laneKey, on); },
      onFileClick: function(laneKey) { self._hiLane(laneKey, true, true); }
    };
    this._treeSpec = treeSpec;
    buildRealTree(document.getElementById('gvTreeReal'), treeSpec).then(function() {
      // 树建好后应用首个接口的高亮
      if (self._current) self._applyTreeHighlight(self._current);
    });

    // 默认选中第一个接口（画布立即渲染，树高亮在建好后补）
    if (parsed.interfaces.length) this.select(parsed.interfaces[0].id);
  },

  // 外部依赖/服务/存储组：全图汇总，渲染一次
  _renderExtGroup: function(col) {
    var el = document.getElementById('gvTreeExt');
    if (!el) return;
    var html = '';
    if (col.extGroup) {
      html += '<div class="gv-tree-title">外部依赖</div>' + renderExtNode(col.extGroup, 0);
    }
    if (col.stores.length) {
      html += '<div class="gv-tree-title">存储</div>';
      for (var s = 0; s < col.stores.length; s++) {
        var st = col.stores[s];
        html += '<div class="gv-tree-item gv-tree-file gv-tree-store" data-gv-path="' + esc(st.projPath)
          + '" data-gv-lane="' + esc(st.laneKey) + '" style="padding-left:24px">'
          + '<span class="gv-tree-icon">🗄</span><span class="gv-tree-name" title="' + esc(st.path) + '">'
          + esc(shortPath(st.path)) + '</span></div>';
      }
    }
    if (col.services.length) {
      html += '<div class="gv-tree-title">外部服务</div>';
      for (var v = 0; v < col.services.length; v++) {
        var sv = col.services[v];
        html += '<div class="gv-tree-item gv-tree-file gv-tree-svc" data-gv-path="svc:' + esc(sv.addr)
          + '" data-gv-lane="' + esc(sv.laneKey) + '" style="padding-left:24px">'
          + '<span class="gv-tree-icon">🌐</span><span class="gv-tree-name" title="' + esc(sv.addr) + '">'
          + esc(sv.name) + '（' + esc(sv.addr) + '）</span></div>';
      }
    }
    el.innerHTML = html;
    this._bindStaticTree(el);
  },

  _renderTabs: function() {
    var tabsEl = document.getElementById('gvTabs');
    if (!tabsEl) return;

    // 按 group 聚合，记录每组的 groupHint（取组内第一个接口的）
    var groups = {};      // group -> { hint, items:[] }
    var order = [];
    for (var i = 0; i < this._data.interfaces.length; i++) {
      var iface = this._data.interfaces[i];
      if (!groups[iface.group]) { groups[iface.group] = { hint: iface.groupHint, items: [] }; order.push(iface.group); }
      groups[iface.group].items.push(iface);
    }

    // 按 groupHint 分区，参考页面布局摆放：top 在上，left|right 并排在中，overlay 在右侧
    var zones = { top: [], left: [], right: [], overlay: [] };
    for (var g = 0; g < order.length; g++) {
      var gname = order[g];
      var hint = groups[gname].hint;
      (zones[hint] || zones.top).push(gname);
    }

    function blockHtml(gname) {
      var grp = groups[gname];
      var h = '<div class="gv-grp"><div class="gv-grp-title">' + esc(gname) + '</div><div class="gv-grp-items">';
      for (var k = 0; k < grp.items.length; k++) {
        var it = grp.items[k];
        var badge = KIND_BADGE[it.kind] || KIND_BADGE.command;
        h += '<button class="gv-tab" data-gv-iface="' + esc(it.id) + '" style="--gv-c:' + badge.color + '">'
          + '<span class="gv-tab-icon">' + badge.icon + '</span>' + esc(it.label) + '</button>';
      }
      return h + '</div></div>';
    }
    function zoneHtml(names, cls) {
      if (!names.length) return '';
      var h = '<div class="gv-zone gv-zone-' + cls + '">';
      for (var z = 0; z < names.length; z++) h += blockHtml(names[z]);
      return h + '</div>';
    }

    // 版面：top 一行；中间 left | right 并排；overlay 贴右
    var html = '<div class="gv-board">';
    html += zoneHtml(zones.top, 'top');
    html += '<div class="gv-board-mid">'
      + zoneHtml(zones.left, 'left')
      + zoneHtml(zones.right, 'right')
      + zoneHtml(zones.overlay, 'overlay')
      + '</div>';
    html += '</div>';
    tabsEl.innerHTML = html;

    var self = this;
    var btns = tabsEl.querySelectorAll('.gv-tab');
    for (var b = 0; b < btns.length; b++) {
      btns[b].addEventListener('click', function() { self.select(this.getAttribute('data-gv-iface')); });
    }
  },

  select: function(ifaceId) {
    var iface = null;
    for (var i = 0; i < this._data.interfaces.length; i++) {
      if (this._data.interfaces[i].id === ifaceId) { iface = this._data.interfaces[i]; break; }
    }
    if (!iface) return;
    this._current = ifaceId;

    // tab 高亮
    var tabs = document.querySelectorAll('.gv-tab');
    for (var t = 0; t < tabs.length; t++) {
      tabs[t].classList.toggle('gv-tab-active', tabs[t].getAttribute('data-gv-iface') === ifaceId);
    }

    var lay = layoutInterface(iface, this._data.stores);

    // 左侧树只切高亮（树本身建一次，不重建）
    this._applyTreeHighlight(ifaceId);

    // 画布
    var canvas = document.getElementById('gvCanvas');
    var head = '';
    if (iface.desc || iface.refresh || iface.at) {
      head = '<div class="gv-canvas-head">'
        + (iface.at ? '<span class="gv-head-at">📍 ' + esc(iface.at) + '</span>' : '')
        + (iface.in && iface.in.length ? '<span class="gv-head-in">入参: ' + esc(iface.in.join(', ')) + '</span>' : '')
        + (iface.refresh ? '<span class="gv-head-refresh">🔄 ' + esc(iface.refresh) + '</span>' : '')
        + (iface.desc ? '<div class="gv-head-desc">' + esc(iface.desc) + '</div>' : '')
        + '</div>';
    }
    canvas.innerHTML = head + '<div class="gv-scroll">' + renderSVG(iface, lay, this._data.stores) + '</div>';

    // 交互：构造 nodeInfo
    var nodeInfo = {};
    for (var s = 0; s < iface.steps.length; s++) {
      var st = iface.steps[s];
      nodeInfo[st.id] = { symbol: st.symbol, file: st.file, desc: st.desc, in: st.in, out: st.out, external: st.external };
    }
    var wr = iface.writes.concat(iface.reads);
    for (var w = 0; w < wr.length; w++) {
      var store = this._data.stores[wr[w]];
      if (store) nodeInfo['store:' + store.id] = { isStore: true, symbol: store.id, path: store.path, desc: store.desc };
    }
    var self = this;
    initInteraction(canvas, nodeInfo, {
      onEnter: function(file) { self.hiTreeFile(file, true); },
      onLeave: function(file) { self.hiTreeFile(file, false); }
    });
    initPan(canvas.querySelector('.gv-scroll'));
  },

  // 切接口：内部真实树 + 外部组 都只切高亮（树本身不重建）
  _applyTreeHighlight: function(ifaceId) {
    var iface = null;
    for (var i = 0; i < this._data.interfaces.length; i++) {
      if (this._data.interfaces[i].id === ifaceId) { iface = this._data.interfaces[i]; break; }
    }
    if (!iface) return;
    var rel = relatedOf(iface, this._data.stores, this._data.root);   // { projPaths: {projPath: laneKey} }

    // 内部真实树：清旧高亮 + 展开相关目录 + 加新高亮
    var realEl = document.getElementById('gvTreeReal');
    if (realEl) applyRelated(realEl, rel.projPaths, this._treeSpec);

    // 外部组（含存储/服务）：清旧 + 按 data-gv-path 匹配加高亮 + 挂 laneKey
    var extEl = document.getElementById('gvTreeExt');
    if (extEl) {
      var old = extEl.querySelectorAll('.gv-tree-related');
      for (var o = 0; o < old.length; o++) { old[o].classList.remove('gv-tree-related'); old[o]._lane = null; }
      var files = extEl.querySelectorAll('.gv-tree-file');
      for (var f = 0; f < files.length; f++) {
        var pp = files[f].getAttribute('data-gv-path');
        if (rel.projPaths.hasOwnProperty(pp)) {
          files[f].classList.add('gv-tree-related');
          files[f]._lane = files[f].getAttribute('data-gv-lane');
        }
      }
    }
  },

  // 外部组绑定：目录折叠 + 文件 hover/click 联动（仅相关行响应）
  _bindStaticTree: function(root) {
    var self = this;
    var dirs = root.querySelectorAll('.gv-tree-dir');
    for (var d = 0; d < dirs.length; d++) {
      dirs[d].addEventListener('click', function(e) {
        e.stopPropagation();
        var wrap = this.nextElementSibling;
        var open = this.getAttribute('data-open') === '1';
        this.setAttribute('data-open', open ? '0' : '1');
        this.querySelector('.gv-tree-caret').textContent = open ? '▸' : '▾';
        if (wrap && wrap.classList.contains('gv-tree-children')) wrap.style.display = open ? 'none' : '';
      });
    }
    var files = root.querySelectorAll('.gv-tree-file');
    for (var f = 0; f < files.length; f++) {
      files[f].addEventListener('mouseenter', function() { if (this._lane) self._hiLane(this._lane, true); });
      files[f].addEventListener('mouseleave', function() { if (this._lane) self._hiLane(this._lane, false); });
      files[f].addEventListener('click', function() { if (this._lane) self._hiLane(this._lane, true, true); });
    }
  },

  // 高亮画布泳道；sticky=点击后切换保持
  _hiLane: function(key, on, sticky) {
    if (!key) return;
    var lanesDom = document.querySelectorAll('.gv-lane');
    for (var l = 0; l < lanesDom.length; l++) {
      var match = lanesDom[l].getAttribute('data-gv-lane') === key;
      if (sticky) { if (match) lanesDom[l].classList.toggle('gv-lane-hi'); }
      else lanesDom[l].classList.toggle('gv-lane-hi', match && on);
    }
  },

  // 高亮左树对应文件行（画布节点 hover 时调用）——按 laneKey 匹配 _lane
  hiTreeFile: function(laneKey, on) {
    var items = document.querySelectorAll('#gvTree .gv-tree-file');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('gv-tree-hi', on && items[i]._lane === laneKey);
    }
  }
};

// 外部依赖树节点递归渲染（带 data-gv-path 供切高亮）
function renderExtNode(node, depth) {
  var pad = depth * 14 + 12;
  if (node.type === 'file') {
    return '<div class="gv-tree-item gv-tree-file gv-tree-ext" style="padding-left:' + (pad + 12) + 'px" data-gv-path="'
      + esc(node.projPath) + '" data-gv-lane="' + esc(node.laneKey) + '">'
      + '<span class="gv-tree-icon">📄</span><span class="gv-tree-name" title="' + esc(node.name) + '">'
      + esc(node.name) + '</span></div>';
  }
  var open = node.open !== false;
  var h = '<div class="gv-tree-item gv-tree-dir gv-tree-ext" style="padding-left:' + pad + 'px" data-open="' + (open ? '1' : '0') + '">'
    + '<span class="gv-tree-caret">' + (open ? '▾' : '▸') + '</span>'
    + '<span class="gv-tree-icon">📁</span><span class="gv-tree-name" title="' + esc(node.name) + '">'
    + esc(node.name) + '</span></div>';
  h += '<div class="gv-tree-children"' + (open ? '' : ' style="display:none"') + '>';
  for (var i = 0; i < node.children.length; i++) h += renderExtNode(node.children[i], depth + 1);
  h += '</div>';
  return h;
}

function shortPath(p) {
  var parts = String(p || '').split('/');
  if (parts.length <= 2) return p;
  return '…/' + parts.slice(-2).join('/');
}
