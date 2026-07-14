// === Dusty Layout / Cluster ===
// 职责：在【已布局好的 L0 坐标】上，按「数据流动层级（列号）」把语句块压平成类。
//   布局只跑一次，合并不重排 —— 合并类的 bbox = 成员位置的并集包围盒，画布尺寸与其它块位置不变。
//
// 层级 L 的定义（= 数据流动的步数 = 布局的列号 layer）：
//   L0：数据流动 0 步，每块独立。
//   Lk：把「列号 < k」的块压平 —— 同列 + 同作用域 + 版面上竖直连续的块合成一类；
//       列号 >= k 的块保持独立。（L1 合并第0列，L2 追加第1列，逐列向右吞）
//   "版面连续"：同列块按 Y 排序，相邻两块的 Y 区间内若夹了任何别的块（被隔断）则断开成两类。
//     （例：a、B、C 同在第0列且连续 → 一类；E 也在第0列但被 d 隔在下方 → 单独一类）
//
// 输入：rawNodes, rawEdges, positions（L0）, layerOf（nodeId→列号）, level
// 输出：{ nodes, edges }  —— nodes 是压平后的类块，各自带 x/y/w/h（并集 bbox）+ 聚合出入参。

export function clusterOnLayout(rawNodes, rawEdges, positions, layerOf, level) {
  layerOf = layerOf || {};
  var L = level || 0;

  // ---- 1. 按 (containerId, layer) 分组，组内按 Y 排序 ----
  var groups = {};   // key "cid|layer" → [node]
  for (var i = 0; i < rawNodes.length; i++) {
    var n = rawNodes[i];
    var layer = layerOf[n.id] || 0;
    var key = (n.containerId || '_') + '|' + layer;
    (groups[key] = groups[key] || []).push(n);
  }

  // 所有块按 Y 排序的全局序列（用于"版面连续"判定）
  var allByY = rawNodes.slice().sort(function(a, b) {
    return (posY(a) - posY(b));
  });
  function posY(n) { var p = positions[n.id]; return p ? p.y : 0; }
  function posBottom(n) { var p = positions[n.id]; return p ? p.y + p.h : 0; }

  // ---- 2. 每组内按"版面连续"切成子类 ----
  //   参与压平的条件：layer <= L。layer > L 的块各自独立成类。
  var classes = [];   // 每个 = [node...]
  for (var key2 in groups) {
    if (!groups.hasOwnProperty(key2)) continue;
    var g = groups[key2];
    g.sort(function(a, b) { return posY(a) - posY(b); });
    var layer2 = parseInt(key2.split('|')[1], 10);

    // Lk 压平「列号 < k」的块；列号 >= k 的保持独立（L0 → 全独立）
    if (layer2 >= L) {
      for (var x = 0; x < g.length; x++) classes.push([g[x]]);
      continue;
    }

    // 组内按版面连续切分：相邻两块之间若夹了别的块则断开
    var run = [g[0]];
    for (var j = 1; j < g.length; j++) {
      if (isAdjacent(run[run.length - 1], g[j])) {
        run.push(g[j]);
      } else {
        classes.push(run);
        run = [g[j]];
      }
    }
    classes.push(run);
  }

  // 判定两块在版面上竖直连续：它们的 Y 区间之间没有第三个块插入
  function isAdjacent(upper, lower) {
    var yTop = posBottom(upper);
    var yBot = posY(lower);
    for (var k = 0; k < allByY.length; k++) {
      var m = allByY[k];
      if (m === upper || m === lower) continue;
      var my = posY(m), mb = posBottom(m);
      // m 的竖直区间与 (upper底, lower顶) 之间的空隙重叠 → 被隔断
      if (my < yBot && mb > yTop) return false;
    }
    return true;
  }

  // ---- 3. 类 → 类块（并集 bbox + 聚合出入参 + 拼接文本） ----
  var classBlocks = [];
  var oldToClass = {};
  var seq = 0;
  for (var c = 0; c < classes.length; c++) {
    var members = classes[c];
    members.sort(function(a, b) { return (a.line || 0) - (b.line || 0); });
    var blk = makeClass(members, positions, seq++);
    classBlocks.push(blk);
    for (var mi = 0; mi < members.length; mi++) oldToClass[members[mi].id] = blk.id;
  }

  // ---- 4. 边重映射：类内内化，类间去重 ----
  var newEdges = [];
  var seen = {};
  for (var e = 0; e < rawEdges.length; e++) {
    var ed = rawEdges[e];
    var from = oldToClass[ed.fromNode] || ed.fromNode;   // 容器端点保留原样
    var to = oldToClass[ed.toNode] || ed.toNode;
    if (from === to) continue;
    var ekey = from + '>' + to + ':' + ed.fromVar;
    if (seen[ekey]) continue;
    seen[ekey] = true;
    newEdges.push({ fromNode: from, fromVar: ed.fromVar, toNode: to, toVar: ed.toVar });
  }

  return { nodes: classBlocks, edges: newEdges };
}

function makeClass(members, positions, seq) {
  if (members.length === 1) {
    var m = members[0];
    var p = positions[m.id] || { x: 0, y: 0, w: 160, h: 40 };
    return {
      id: m.id, text: m.text,
      inputs: (m.inputs || []).slice(), outputs: (m.outputs || []).slice(),
      literalInputs: (m.literalInputs || []).slice(),
      line: m.line || 0, containerId: m.containerId,
      x: p.x, y: p.y, w: p.w, h: p.h
    };
  }
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  var inSet = {}, outSet = {}, written = {}, texts = [], lits = [];
  for (var i = 0; i < members.length; i++) {
    var mm = members[i];
    var pp = positions[mm.id];
    if (pp) {
      if (pp.x < minX) minX = pp.x;
      if (pp.y < minY) minY = pp.y;
      if (pp.x + pp.w > maxX) maxX = pp.x + pp.w;
      if (pp.y + pp.h > maxY) maxY = pp.y + pp.h;
    }
    var ins = mm.inputs || [];
    for (var a = 0; a < ins.length; a++) if (!written[ins[a]]) inSet[ins[a]] = true;
    var outs = mm.outputs || [];
    for (var b = 0; b < outs.length; b++) { outSet[outs[b]] = true; written[outs[b]] = true; }
    texts.push(mm.text);
    var li = mm.literalInputs || [];
    for (var l = 0; l < li.length; l++) lits.push(li[l]);
  }
  return {
    id: 'cls_' + seq,
    text: texts.join('\n'),
    inputs: Object.keys(inSet),
    outputs: Object.keys(outSet),
    literalInputs: lits,
    line: members[0].line || 0,
    containerId: members[0].containerId,
    x: minX, y: minY, w: maxX - minX, h: maxY - minY
  };
}
