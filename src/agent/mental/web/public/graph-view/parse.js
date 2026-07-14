// === GraphView / Parse ===
// 职责：.graph 的 JSON 字符串 → 校验规整后的 data 对象
// data = { root, interfaces:[...], stores:[...] }
// 每个 interface: { id, kind, label, at, in[], steps[], edges[], writes, reads, refresh, desc }
// 每个 step:      { id, file, symbol, desc, in[], out[] }
// 每个 store:     { id, path, desc }

export function parseGraph(text) {
  var data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { error: 'JSON 解析失败: ' + e.message };
  }
  if (!data || typeof data !== 'object') return { error: '.graph 顶层必须是对象' };

  var root = data.root || '';
  var stores = Array.isArray(data.stores) ? data.stores : [];
  var rawIfaces = Array.isArray(data.interfaces) ? data.interfaces : [];
  if (!rawIfaces.length) return { error: '.graph 缺少 interfaces' };

  // 规整 store
  var storeMap = {};
  for (var si = 0; si < stores.length; si++) {
    var s = stores[si];
    if (!s || !s.id) continue;
    storeMap[s.id] = { id: s.id, path: s.path || '', desc: s.desc || '' };
  }

  // 规整每个接口
  var interfaces = [];
  for (var ii = 0; ii < rawIfaces.length; ii++) {
    var raw = rawIfaces[ii];
    if (!raw || !raw.id) continue;

    var steps = [];
    var rawSteps = Array.isArray(raw.steps) ? raw.steps : [];
    for (var ti = 0; ti < rawSteps.length; ti++) {
      var st = rawSteps[ti];
      if (!st) continue;
      steps.push({
        id: st.id || (raw.id + '_s' + ti),
        file: st.file || '',
        symbol: st.symbol || '',
        desc: st.desc || '',
        external: !!st.external,
        service: st.service || '',
        in: toArr(st.in),
        out: toArr(st.out)
      });
    }

    interfaces.push({
      id: raw.id,
      kind: raw.kind || 'command',              // command | query | http | ws | cron | duplex
      group: raw.group || '其他',
      groupHint: raw.groupHint || 'top',        // left | right | overlay | top（布局参考）
      label: raw.label || raw.id,
      at: raw.at || '',
      desc: raw.desc || '',
      refresh: raw.refresh || '',
      in: toArr(raw.in),
      writes: toArr(raw.writes),                // store id 列表
      reads: toArr(raw.reads),
      edges: Array.isArray(raw.edges) ? raw.edges.slice() : [],  // {from,to,kind,label}
      steps: steps
    });
  }

  return { root: root, interfaces: interfaces, stores: storeMap, error: null };
}

// 接受 string | string[] | undefined → 统一 string[]
function toArr(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.filter(function(x) { return x != null; }).map(String);
  return [String(v)];
}

// 收集一个接口涉及的所有文件（step.file 去重，保序），供泳道用
export function collectFiles(iface) {
  var seen = {};
  var files = [];
  for (var i = 0; i < iface.steps.length; i++) {
    var f = iface.steps[i].file;
    if (f && !seen[f]) { seen[f] = 1; files.push(f); }
  }
  return files;
}
