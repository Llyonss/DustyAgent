// === GraphView / 真实目录树 ===
// 职责：从 /api/files 懒加载真实目录内容，渲染可展开树（建一次）
//      切接口时只切换高亮 + 展开相关目录，不重建
//
// 文件行身份：data-gv-path = 项目根规范路径（跨接口稳定）
//            data-gv-lane = laneKey（画布泳道联动）

import { Data } from '../data.js';

function esc(s) {
  return (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

var dirCache = {};   // 项目根路径 -> entries[]

// 建一次真实目录树（root 全部展开一层，其余按需）
// spec: { rootPath, rootName, onFileHover(laneKey,on), onFileClick(laneKey) }
export async function buildRealTree(container, spec) {
  container._spec = spec;
  container.innerHTML = '';
  var rootRow = makeDirRow(spec.rootName, spec.rootPath, 0, true);
  container.appendChild(rootRow);
  var rootChildren = document.createElement('div');
  rootChildren.className = 'gv-tree-children';
  container.appendChild(rootChildren);
  bindDirToggle(rootRow, rootChildren, spec.rootPath, 1, spec);
  rootChildren._loaded = true;
  await expandDir(rootChildren, spec.rootPath, 1, spec);
}

async function expandDir(childrenEl, dirPath, depth, spec) {
  var entries = dirCache[dirPath];
  if (!entries) {
    childrenEl.innerHTML = '<div class="gv-tree-loading" style="padding-left:' + (depth * 14 + 12) + 'px">…</div>';
    try {
      var data = await Data.fetchFiles(dirPath);
      entries = data.entries || [];
      dirCache[dirPath] = entries;
    } catch (e) {
      childrenEl.innerHTML = '<div class="gv-tree-loading" style="padding-left:' + (depth * 14 + 12) + 'px;color:#a55">读取失败</div>';
      return;
    }
  }
  childrenEl.innerHTML = '';
  for (var i = 0; i < entries.length; i++) {
    var en = entries[i];
    if (en.type === 'dir') {
      var row = makeDirRow(en.name, en.path, depth, false);
      childrenEl.appendChild(row);
      var sub = document.createElement('div');
      sub.className = 'gv-tree-children';
      sub.style.display = 'none';
      childrenEl.appendChild(sub);
      bindDirToggle(row, sub, en.path, depth + 1, spec);
    } else {
      childrenEl.appendChild(makeFileRow(en.name, en.path, depth, spec));
    }
  }
}

function makeDirRow(name, path, depth, isRoot) {
  var row = document.createElement('div');
  row.className = 'gv-tree-item gv-tree-dir';
  row.style.paddingLeft = (depth * 14 + 12) + 'px';
  row.setAttribute('data-open', isRoot ? '1' : '0');
  row.setAttribute('data-gv-path', path);
  row.innerHTML = '<span class="gv-tree-caret">' + (isRoot ? '▾' : '▸') + '</span>'
    + '<span class="gv-tree-icon">📁</span><span class="gv-tree-name" title="' + esc(name) + '">' + esc(name) + '</span>';
  return row;
}

function makeFileRow(name, path, depth, spec) {
  var row = document.createElement('div');
  row.className = 'gv-tree-item gv-tree-file';
  row.style.paddingLeft = (depth * 14 + 12 + 12) + 'px';
  row.setAttribute('data-gv-path', path);
  row.innerHTML = '<span class="gv-tree-icon">📄</span><span class="gv-tree-name" title="' + esc(name) + '">' + esc(name) + '</span>';
  // hover/click 联动（仅当行为相关时 laneKey 存在，applyRelated 时挂）
  row.addEventListener('mouseenter', function() { if (row._lane) spec.onFileHover(row._lane, true); });
  row.addEventListener('mouseleave', function() { if (row._lane) spec.onFileHover(row._lane, false); });
  row.addEventListener('click', function() { if (row._lane) spec.onFileClick(row._lane); });
  return row;
}

function bindDirToggle(row, childrenEl, dirPath, childDepth, spec) {
  row.addEventListener('click', async function(e) {
    e.stopPropagation();
    await toggleDir(row, childrenEl, dirPath, childDepth, spec);
  });
}

async function toggleDir(row, childrenEl, dirPath, childDepth, spec, forceOpen) {
  var open = row.getAttribute('data-open') === '1';
  if (open && !forceOpen) {
    row.setAttribute('data-open', '0');
    row.querySelector('.gv-tree-caret').textContent = '▸';
    childrenEl.style.display = 'none';
  } else {
    row.setAttribute('data-open', '1');
    row.querySelector('.gv-tree-caret').textContent = '▾';
    childrenEl.style.display = '';
    if (!childrenEl._loaded) {
      childrenEl._loaded = true;
      await expandDir(childrenEl, dirPath, childDepth, spec);
    }
  }
}

// 确保某项目根路径的祖先目录都已展开（懒加载逐级拉）
async function ensurePathExpanded(container, projPath, spec) {
  // 逐级找目录行并展开
  var segs = projPath.split('/');
  var rootSegs = spec.rootPath.split('/');
  // 只处理 root 下的路径
  for (var depth = rootSegs.length; depth < segs.length; depth++) {
    var dirPath = segs.slice(0, depth).join('/');
    var row = container.querySelector('.gv-tree-dir[data-gv-path="' + cssEsc(dirPath) + '"]');
    if (!row) return; // 结构未加载到这层，且父级已尝试展开——安全退出
    var childrenEl = row.nextElementSibling;
    if (row.getAttribute('data-open') !== '1') {
      await toggleDir(row, childrenEl, dirPath, depth - rootSegs.length + 1, spec, true);
    }
  }
}

function cssEsc(s) { return String(s).replace(/(["\\])/g, '\\$1'); }

// 切接口：清旧高亮 → 展开相关目录 → 加新高亮 + 挂 laneKey
// projPathsMap: { projPath: laneKey }
export async function applyRelated(container, projPathsMap, spec) {
  // 清旧
  var old = container.querySelectorAll('.gv-tree-related, .gv-tree-hi');
  for (var i = 0; i < old.length; i++) { old[i].classList.remove('gv-tree-related', 'gv-tree-hi'); old[i]._lane = null; }

  // 展开相关文件的祖先目录（逐个 ensure）
  var paths = Object.keys(projPathsMap);
  for (var p = 0; p < paths.length; p++) {
    if (paths[p].indexOf('store:') === 0 || paths[p].indexOf('svc:') === 0) continue;
    await ensurePathExpanded(container, paths[p], spec);
  }

  // 加高亮 + 挂 laneKey
  for (var q = 0; q < paths.length; q++) {
    var pp = paths[q];
    if (pp.indexOf('store:') === 0 || pp.indexOf('svc:') === 0) continue;
    var row = container.querySelector('.gv-tree-file[data-gv-path="' + cssEsc(pp) + '"]');
    if (row) { row.classList.add('gv-tree-related'); row._lane = projPathsMap[pp]; }
  }
}
