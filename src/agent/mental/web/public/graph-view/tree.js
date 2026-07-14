// === GraphView / Tree ===
// 职责：接口/全图 → 树数据（纯函数，不碰 DOM）
// 分三类：内部文件(root下) / 外部文件(root外真实路径,公共根归拢) / 外部服务(非路径)
//
// step.file 基准约定：
//   内部文件 = 相对 root（如 public/chat/index.js、index.js）
//   external 文件 = 相对 root，用 ../ 跳出（如 ../../core/loop.js）
//   external 服务 = 带 service 字段，file 是地址（如 zenmux.ai/api）
//
// 身份约定：文件行以【项目根规范路径 projPath】为唯一身份（跨接口稳定）
//          画布泳道联动用 laneKey（= step.file 原值，与 data-gv-file 对应）

function normSegs(p) {
  var segs = String(p || '').split('/');
  var out = [];
  for (var i = 0; i < segs.length; i++) {
    var s = segs[i];
    if (s === '' || s === '.') continue;
    if (s === '..') { if (out.length) out.pop(); else out.push('..'); }
    else out.push(s);
  }
  return out;
}

function looksLikeService(step) {
  if (step.service) return true;
  var last = String(step.file || '').split('/').pop();
  var hasCodeExt = /\.(js|mjs|cjs|ts|mts|cts|jsx|tsx|json|css|html|py|go|rs)$/i.test(last);
  var firstSeg = String(step.file || '').split('/')[0] || '';
  var isDomain = /\.[a-z]{2,}$/i.test(firstSeg);
  return !hasCodeExt && isDomain;
}

// 归一化一个 step 的 file → { kind, projPath, laneKey, service, addr }
// kind: 'service' | 'internal' | 'external'
function mapStepFile(step, rootSegs) {
  var laneKey = step.file;
  if (looksLikeService(step)) {
    return { kind: 'service', laneKey: laneKey, service: step.service || step.file, addr: step.file };
  }
  var projSegs = normSegs(rootSegs.join('/') + '/' + step.file);
  var rel = stripPrefix(projSegs, rootSegs);
  if (rel != null && !step.external) {
    return { kind: 'internal', laneKey: laneKey, projPath: projSegs.join('/'), projSegs: projSegs };
  }
  return { kind: 'external', laneKey: laneKey, projPath: projSegs.join('/'), projSegs: projSegs };
}

// ---- 全图收集：外部依赖完整树 + 服务全集 + 存储全集 ----
export function collectAll(interfaces, storeMap, root) {
  var rootSegs = normSegs(root);
  var extFiles = {};      // projPath -> { projSegs, laneKey }
  var services = {};      // addr -> { name, addr, laneKey }
  var stores = {};        // storeId -> { path, laneKey }

  for (var ii = 0; ii < interfaces.length; ii++) {
    var iface = interfaces[ii];
    for (var si = 0; si < iface.steps.length; si++) {
      var st = iface.steps[si];
      if (!st.file) continue;
      var m = mapStepFile(st, rootSegs);
      if (m.kind === 'service') { if (!services[m.addr]) services[m.addr] = { name: m.service, addr: m.addr, laneKey: m.laneKey }; }
      else if (m.kind === 'external') { if (!extFiles[m.projPath]) extFiles[m.projPath] = { projSegs: m.projSegs, laneKey: m.laneKey }; }
    }
    var wr = iface.writes.concat(iface.reads);
    for (var w = 0; w < wr.length; w++) {
      var s = storeMap[wr[w]];
      if (s && !stores[wr[w]]) stores[wr[w]] = { path: s.path || s.id, laneKey: 'store:' + s.id, projPath: 'store:' + s.id };
    }
  }

  // 外部文件公共根归拢 → 树
  var extList = Object.keys(extFiles).map(function(k) { return extFiles[k]; });
  var extGroup = null;
  if (extList.length) {
    var common = commonPrefix(extList.map(function(e) { return e.projSegs; }));
    var label = common.length ? common.join('/') : '外部';
    extGroup = { name: label, type: 'dir', children: [], open: true, isExternal: true, groupPrefix: common.join('/') };
    for (var e = 0; e < extList.length; e++) {
      var relSegs = extList[e].projSegs.slice(common.length);
      insertPath(extGroup, relSegs, extList[e].laneKey, extList[e].projSegs.join('/'), common.join('/'));
    }
  }

  var storeList = Object.keys(stores).map(function(k) { return stores[k]; });
  var svcList = Object.keys(services).map(function(k) { return services[k]; });

  return { rootPath: rootSegs.join('/'), rootName: root || '(root)', extGroup: extGroup, stores: storeList, services: svcList };
}

// ---- 单接口：相关身份集合（切高亮用）----
// 返回 { projPaths:{projPath:laneKey}, all:[projPath...] }
export function relatedOf(iface, storeMap, root) {
  var rootSegs = normSegs(root);
  var projPaths = {};
  for (var si = 0; si < iface.steps.length; si++) {
    var st = iface.steps[si];
    if (!st.file) continue;
    var m = mapStepFile(st, rootSegs);
    if (m.kind === 'service') projPaths['svc:' + m.addr] = m.laneKey;
    else projPaths[m.projPath] = m.laneKey;   // internal/external 统一用 projPath
  }
  var wr = iface.writes.concat(iface.reads);
  for (var w = 0; w < wr.length; w++) {
    var s = storeMap[wr[w]];
    if (s) projPaths['store:' + s.id] = 'store:' + s.id;
  }
  return { projPaths: projPaths };
}

function stripPrefix(fileSegs, prefixSegs) {
  if (fileSegs.length < prefixSegs.length) return null;
  for (var i = 0; i < prefixSegs.length; i++) {
    if (fileSegs[i] !== prefixSegs[i]) return null;
  }
  return fileSegs.slice(prefixSegs.length);
}

function commonPrefix(list) {
  if (!list.length) return [];
  var dirs = list.map(function(segs) { return segs.slice(0, segs.length - 1); });
  var pre = dirs[0].slice();
  for (var i = 1; i < dirs.length; i++) {
    var j = 0;
    while (j < pre.length && j < dirs[i].length && pre[j] === dirs[i][j]) j++;
    pre = pre.slice(0, j);
  }
  return pre;
}

// 插入路径段；记录每个文件节点的 projPath 与 laneKey
function insertPath(parent, segs, laneKey, projPath, prefixStr) {
  var cur = parent;
  var acc = prefixStr ? prefixStr.split('/') : [];
  for (var i = 0; i < segs.length; i++) {
    var isLast = (i === segs.length - 1);
    var seg = segs[i];
    acc.push(seg);
    var child = null;
    for (var c = 0; c < cur.children.length; c++) {
      if (cur.children[c].name === seg) { child = cur.children[c]; break; }
    }
    if (!child) {
      child = {
        name: seg,
        type: isLast ? 'file' : 'dir',
        children: [],
        open: true,
        isExternal: true,
        laneKey: isLast ? laneKey : null,
        projPath: isLast ? projPath : acc.join('/')
      };
      cur.children.push(child);
    }
    cur = child;
  }
}
