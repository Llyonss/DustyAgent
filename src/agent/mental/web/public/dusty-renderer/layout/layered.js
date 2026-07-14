// === Dusty Layout / Layered ===
// 拓扑分层 (X轴) + 容器 DFS 序 (Y轴)
// 节点宽高自适应，长文本估算行数

var CHAR_W = 7.2;
var LINE_H = 17;
var PAD_NODE_X = 64;
var PAD_NODE_Y = 16;
var MIN_W = 160;
var MAX_W = 480;
var MIN_H = 36;
var GAP_X = 56;
var GAP_Y = 16;
var PAD_L = 40;
var PAD_T = 40;
var CONTAINER_GAP = 32;
var PAD_CX = 10;
var PAD_CY_TOP = 16;
var PAD_CY_BOT = 10;

export function layout(nodes, edges, containers) {
  try {
    return doLayout(nodes, edges, containers);
  } catch(e) {
    return { positions: {}, containerPositions: {}, maxLayer: 0, nodeLines: {}, error: e.message };
  }
}

function doLayout(nodes, edges, containers) {
  if (!nodes || !nodes.length) {
    return { positions: {}, containerPositions: {}, maxLayer: 0, nodeLines: {} };
  }
  containers = containers || [];
  edges = edges || [];

  // ---- 建查找表 ----
  var nodeMap = {};
  for (var i = 0; i < nodes.length; i++) {
    var nd = nodes[i];
    if (nd && nd.id) nodeMap[nd.id] = nd;
  }

  // ---- 1. 拓扑分层 ----
  var inDegree = {};
  var outEdges = {};
  for (var i2 = 0; i2 < nodes.length; i2++) {
    var n2 = nodes[i2];
    if (n2 && n2.id) { inDegree[n2.id] = 0; outEdges[n2.id] = []; }
  }
  for (var ei = 0; ei < edges.length; ei++) {
    var e = edges[ei];
    if (!e || !e.fromNode || !e.toNode) continue;
    if (!outEdges[e.fromNode]) outEdges[e.fromNode] = [];
    outEdges[e.fromNode].push(e.toNode);
    inDegree[e.toNode] = (inDegree[e.toNode] || 0) + 1;
  }

  var layer = {};
  var visited = {};
  var inDeg = {};
  for (var k in inDegree) { if (inDegree.hasOwnProperty(k)) inDeg[k] = inDegree[k]; }

  var queue = [];
  for (var i3 = 0; i3 < nodes.length; i3++) {
    var n3 = nodes[i3];
    if (n3 && n3.id && inDegree[n3.id] === 0) queue.push(n3);
  }
  var curLayer = 0;

  while (queue.length) {
    var next = [];
    for (var qi = 0; qi < queue.length; qi++) {
      var qn = queue[qi];
      if (!qn || !qn.id || visited[qn.id]) continue;
      visited[qn.id] = true;
      layer[qn.id] = curLayer;
      var outs = outEdges[qn.id] || [];
      for (var oi = 0; oi < outs.length; oi++) {
        var toId = outs[oi];
        inDeg[toId] = (inDeg[toId] || 1) - 1;
        if (inDeg[toId] === 0 && nodeMap[toId]) next.push(nodeMap[toId]);
      }
    }
    queue = next;
    curLayer++;
  }
  for (var i4 = 0; i4 < nodes.length; i4++) {
    var n4 = nodes[i4];
    if (n4 && n4.id && !(n4.id in layer)) layer[n4.id] = curLayer;
  }

  var maxLayer = 0;
  for (var lk in layer) { if (layer.hasOwnProperty(lk) && layer[lk] > maxLayer) maxLayer = layer[lk]; }

  // 容器层偏移：有入参的容器（如回调），内部节点不能比入参来源更左
  var containerMinLayer = {};
  for (var ei2 = 0; ei2 < edges.length; ei2++) {
    var e2 = edges[ei2];
    if (e2 && e2.toNode && e2.toNode[0] === 'c' && layer[e2.fromNode] !== undefined) {
      var needLayer = layer[e2.fromNode] + 1;
      if (needLayer > (containerMinLayer[e2.toNode] || 0)) containerMinLayer[e2.toNode] = needLayer;
    }
  }
  // 按深度降序排列容器（深层先处理），整体平移保持内部层差
  function cDepth(cid, d) {
    for (var ci = 0; ci < containers.length; ci++) {
      if (containers[ci].id === cid && containers[ci].parentId) return cDepth(containers[ci].parentId, d + 1);
    }
    return d;
  }
  var depthSorted = containers.slice().sort(function(a, b) {
    return cDepth(b.id, 0) - cDepth(a.id, 0);
  });
  for (var dsi = 0; dsi < depthSorted.length; dsi++) {
    var dsc = depthSorted[dsi];
    var needLayer = containerMinLayer[dsc.id];
    if (!needLayer) continue;
    // 找容器内当前最小层
    var curMin = Infinity;
    for (var ni2 = 0; ni2 < nodes.length; ni2++) {
      if (nodes[ni2].containerId === dsc.id && layer[nodes[ni2].id] < curMin) {
        curMin = layer[nodes[ni2].id];
      }
    }
    if (curMin === Infinity || curMin >= needLayer) continue;
    var offset = needLayer - curMin;
    // 整体平移容器内及子容器内所有节点
    function applyShift(pcid) {
      for (var ni3 = 0; ni3 < nodes.length; ni3++) {
        if (nodes[ni3].containerId === pcid) layer[nodes[ni3].id] += offset;
      }
      for (var cj = 0; cj < containers.length; cj++) {
        if (containers[cj].parentId === pcid) applyShift(containers[cj].id);
      }
    }
    applyShift(dsc.id);
  }
  // 重算 maxLayer
  maxLayer = 0;
  for (var lk2 in layer) { if (layer.hasOwnProperty(lk2) && layer[lk2] > maxLayer) maxLayer = layer[lk2]; }

  // 按层分组
  var layerNodes = {};
  for (var i5 = 0; i5 < nodes.length; i5++) {
    var n5 = nodes[i5];
    if (!n5 || !n5.id) continue;
    var l = layer[n5.id];
    if (!layerNodes[l]) layerNodes[l] = [];
    layerNodes[l].push(n5);
  }

  // ---- 2. 计算每层宽度 & 节点尺寸 ----
  var nodeSize = {};
  for (var l2 = 0; l2 <= maxLayer; l2++) {
    var ln = layerNodes[l2];
    if (!ln || !ln.length) continue;
    var maxTextW = 0;
    for (var li = 0; li < ln.length; li++) {
      var lines = (ln[li].text || '').split('\n');
      for (var lj = 0; lj < lines.length; lj++) {
        var tw = lines[lj].length * CHAR_W;
        if (tw > maxTextW) maxTextW = tw;
      }
    }
    var layerW = Math.max(MIN_W, Math.min(MAX_W, maxTextW + PAD_NODE_X));
    var charsPerLine = Math.max(1, Math.floor((layerW - PAD_NODE_X) / CHAR_W));

    for (var li2 = 0; li2 < ln.length; li2++) {
      var nd2 = ln[li2];
      var textLines = (nd2.text || '').split('\n');
      var estLines = 0;
      for (var tl = 0; tl < textLines.length; tl++) {
        estLines += Math.max(1, Math.ceil(textLines[tl].length / charsPerLine * 1.15));
      }
      var portNeed = Math.max((nd2.inputs || []).length + (nd2.literalInputs || []).length, (nd2.outputs || []).length, 1) * 22 + 18;
      nodeSize[nd2.id] = {
        w: layerW,
        h: Math.max(MIN_H, estLines * LINE_H + PAD_NODE_Y, portNeed)
      };
    }
  }

  // ---- 3. 层 X 累计位置 ----
  var layerX = {};
  var curX = PAD_L;
  for (var l3 = 0; l3 <= maxLayer; l3++) {
    layerX[l3] = curX;
    var ln2 = layerNodes[l3];
    if (ln2 && ln2.length > 0 && ln2[0] && nodeSize[ln2[0].id]) {
      curX += nodeSize[ln2[0].id].w + GAP_X;
    }
  }

  // ---- 4. 容器树 & Y 排序 ----
  var containerMap = {};
  var containerByParent = {};
  for (var ci = 0; ci < containers.length; ci++) {
    var c = containers[ci];
    if (!c || !c.id) continue;
    containerMap[c.id] = c;
    var cpid = c.parentId || '__root__';
    if (!containerByParent[cpid]) containerByParent[cpid] = [];
    containerByParent[cpid].push(c);
  }

  var nodeContainerPath = {};
  for (var i6 = 0; i6 < nodes.length; i6++) {
    var n6 = nodes[i6];
    if (!n6 || !n6.id) continue;
    var path = [];
    var cid = n6.containerId;
    while (cid) {
      path.unshift(cid);
      var pcont = containerMap[cid];
      cid = pcont ? pcont.parentId : null;
    }
    nodeContainerPath[n6.id] = path;
  }

  var directNodes = {};
  for (var i7 = 0; i7 < nodes.length; i7++) {
    var n7 = nodes[i7];
    if (!n7 || !n7.id) continue;
    var dcKey = n7.containerId || '__root__';
    if (!directNodes[dcKey]) directNodes[dcKey] = [];
    directNodes[dcKey].push(n7);
  }
  for (var dk in directNodes) {
    if (directNodes.hasOwnProperty(dk)) {
      directNodes[dk].sort(function(a, b) { return (a.line || 0) - (b.line || 0); });
    }
  }

  function firstLine(cid) {
    var dn = directNodes[cid] || [];
    if (dn.length && dn[0]) return dn[0].line || 0;
    var subs = containerByParent[cid] || [];
    for (var si = 0; si < subs.length; si++) {
      var fl = firstLine(subs[si].id);
      if (fl < Infinity) return fl;
    }
    return Infinity;
  }

  function collect(cid) {
    var items = [];
    var dn = directNodes[cid] || [];
    for (var di = 0; di < dn.length; di++) {
      items.push({ type: 'node', node: dn[di], line: dn[di].line || 0 });
    }
    var subs = containerByParent[cid] || [];
    for (var si2 = 0; si2 < subs.length; si2++) {
      items.push({ type: 'container', container: subs[si2], line: firstLine(subs[si2].id) });
    }
    items.sort(function(a, b) { return a.line - b.line; });

    var result = [];
    for (var ii = 0; ii < items.length; ii++) {
      if (items[ii].type === 'node') {
        result.push(items[ii].node);
      } else {
        var subResult = collect(items[ii].container.id);
        for (var si3 = 0; si3 < subResult.nodes.length; si3++) {
          result.push(subResult.nodes[si3]);
        }
      }
    }
    return { nodes: result };
  }

  var rootOrder = collect('__root__');

  // ---- 5. 分配坐标 ----
  var positions = {};
  var nodeLines = {};
  var curY = PAD_T;
  var prevPath = null;

  for (var ri = 0; ri < rootOrder.nodes.length; ri++) {
    var rn = rootOrder.nodes[ri];
    if (!rn || !rn.id) continue;
    var pathStr = (nodeContainerPath[rn.id] || []).join('/');

    if (prevPath !== null && pathStr !== prevPath) {
      var prevParts = prevPath.split('/').filter(Boolean);
      var curParts = pathStr.split('/').filter(Boolean);
      var div = 0;
      while (div < prevParts.length && div < curParts.length && prevParts[div] === curParts[div]) div++;
      curY += CONTAINER_GAP + Math.max(0, prevParts.length - div) * 14;
    }

    var sz = nodeSize[rn.id] || { w: MIN_W, h: MIN_H };
    positions[rn.id] = { x: layerX[layer[rn.id]] || PAD_L, y: curY, w: sz.w, h: sz.h };
    nodeLines[rn.id] = (rn.text || '').split('\n');
    curY += sz.h + GAP_Y;
    prevPath = pathStr;
  }

  // ---- 6. 容器包围盒 ----
  function containerDepth(cid, d) {
    var dc = containerMap[cid];
    return dc && dc.parentId ? containerDepth(dc.parentId, d + 1) : d;
  }

  var sortedByDepth = containers.slice().sort(function(a, b) {
    return containerDepth(b.id, 0) - containerDepth(a.id, 0);
  });

  function getBounds(cid) {
    var dn = directNodes[cid] || [];
    var subBounds = [];
    for (var sbi = 0; sbi < containers.length; sbi++) {
      var sc = containers[sbi];
      if (sc && sc.parentId === cid) {
        var sb = getBounds(sc.id);
        if (sb) subBounds.push(sb);
      }
    }
    var allPts = [];
    for (var ddi = 0; ddi < dn.length; ddi++) {
      var dpos = positions[dn[ddi].id];
      if (dpos) allPts.push(dpos);
    }
    for (var sbi2 = 0; sbi2 < subBounds.length; sbi2++) {
      allPts.push(subBounds[sbi2]);
    }
    if (!allPts.length) return null;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var pti = 0; pti < allPts.length; pti++) {
      var pt = allPts[pti];
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x + pt.w > maxX) maxX = pt.x + pt.w;
      if (pt.y + pt.h > maxY) maxY = pt.y + pt.h;
    }
    return { x: minX - PAD_CX, y: minY - PAD_CY_TOP, w: maxX - minX + 2 * PAD_CX, h: maxY - minY + PAD_CY_TOP + PAD_CY_BOT };
  }

  var containerPositions = {};
  for (var sci = 0; sci < sortedByDepth.length; sci++) {
    var sc = sortedByDepth[sci];
    if (!sc || !sc.id) continue;
    var bounds = getBounds(sc.id);
    if (bounds) containerPositions[sc.id] = bounds;
  }

  return { positions: positions, containerPositions: containerPositions, maxLayer: maxLayer, nodeLines: nodeLines, layerOf: layer };
}
