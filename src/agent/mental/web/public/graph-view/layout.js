// === GraphView / Layout ===
// 职责：单个接口 → positions + lanes（算坐标，不碰 DOM）
// Y 轴 = 文件/存储在泳道中的位置；X 轴 = 执行链拓扑序（step 数组序）
// store 节点作为中间立柱，X 落在各 step 的中位

import { collectFiles } from './parse.js';

var NODE_W = 210;
var NODE_H = 74;
var STORE_W = 240;
var GAP_X = 70;              // 相邻拓扑列水平间距（列心到列心 = NODE_W + GAP_X）
var LANE_H = 96;             // 单条泳道高度
var PAD_L = 40;              // 画布左内边距（泳道标签区之后）
var PAD_T = 24;
var LANE_LABEL_W = 0;        // 泳道标签画在左侧树里，画布内不占宽

export function layoutInterface(iface, storeMap) {
  var files = collectFiles(iface);

  // ---- 用到的 store（保序：先 writes 后 reads，去重）----
  var usedStores = [];
  var seenStore = {};
  var wr = iface.writes.concat(iface.reads);
  for (var wi = 0; wi < wr.length; wi++) {
    var sid = wr[wi];
    if (storeMap[sid] && !seenStore[sid]) { seenStore[sid] = 1; usedStores.push(sid); }
  }

  // ---- 泳道：文件在上，存储区在下 ----
  var lanes = [];
  var laneY = {};
  var y = PAD_T;
  for (var fi = 0; fi < files.length; fi++) {
    laneY[files[fi]] = y;
    lanes.push({ key: files[fi], label: files[fi], y: y, h: LANE_H, isStore: false });
    y += LANE_H;
  }
  for (var sti = 0; sti < usedStores.length; sti++) {
    var stid = usedStores[sti];
    laneY['store:' + stid] = y;
    lanes.push({ key: 'store:' + stid, label: storeMap[stid].path || stid, y: y, h: LANE_H, isStore: true });
    y += LANE_H;
  }

  // ---- step 节点：X = 数组序，Y = 文件泳道 ----
  var positions = {};
  var maxCol = 0;
  for (var i = 0; i < iface.steps.length; i++) {
    var s = iface.steps[i];
    var col = i;
    if (col > maxCol) maxCol = col;
    var laneTop = laneY[s.file] != null ? laneY[s.file] : PAD_T;
    positions[s.id] = {
      x: PAD_L + col * (NODE_W + GAP_X),
      y: laneTop + (LANE_H - NODE_H) / 2,
      w: NODE_W, h: NODE_H,
      col: col, kind: 'step', external: s.external
    };
  }

  // ---- store 节点：X 居中（所有 step 列的中位），Y = 存储泳道 ----
  for (var ui = 0; ui < usedStores.length; ui++) {
    var storeId = usedStores[ui];
    var midCol = maxCol / 2;
    var laneTopS = laneY['store:' + storeId];
    positions['store:' + storeId] = {
      x: PAD_L + midCol * (NODE_W + GAP_X) + (NODE_W - STORE_W) / 2,
      y: laneTopS + (LANE_H - NODE_H) / 2,
      w: STORE_W, h: NODE_H,
      col: midCol, kind: 'store'
    };
  }

  // ---- 画布尺寸 ----
  var canvasW = PAD_L + (maxCol + 1) * (NODE_W + GAP_X) + 60;
  var canvasH = y + PAD_T;

  return {
    positions: positions,
    lanes: lanes,
    canvasW: Math.max(canvasW, 600),
    canvasH: Math.max(canvasH, 200)
  };
}
