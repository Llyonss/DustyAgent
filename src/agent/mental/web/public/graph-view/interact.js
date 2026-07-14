// === GraphView / Interact ===
// 职责：给渲染好的 DOM 挂 hover 浮层 + 高亮泳道（不改数据）

// 浮层单例
var tip = null;
function ensureTip() {
  if (tip) return tip;
  tip = document.createElement('div');
  tip.className = 'gv-tip hidden';
  document.body.appendChild(tip);
  return tip;
}

function esc(s) {
  return (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 给一块画布挂交互；nodeInfo: nid -> { symbol, file, desc, in[], out[], external, isStore, laneKey }
// cb: { onEnter(laneKey), onLeave(laneKey) } 供联动左侧树
export function initInteraction(container, nodeInfo, cb) {
  var t = ensureTip();
  cb = cb || {};
  var nodes = container.querySelectorAll('.gv-node');

  for (var i = 0; i < nodes.length; i++) {
    (function(node) {
      var nid = node.getAttribute('data-gv-nid');
      var info = nodeInfo[nid];
      if (!info) return;
      var laneKey = info.isStore ? nid : info.file;  // store 节点 nid 即 'store:'+id

      node.addEventListener('mouseenter', function() {
        t.innerHTML = buildTip(info);
        t.classList.remove('hidden');
        // 高亮同文件泳道
        if (laneKey) {
          var lanes = container.querySelectorAll('.gv-lane');
          for (var li = 0; li < lanes.length; li++) {
            lanes[li].classList.toggle('gv-lane-hi', lanes[li].getAttribute('data-gv-lane') === laneKey);
          }
        }
        if (cb.onEnter) cb.onEnter(laneKey);
      });
      node.addEventListener('mousemove', function(e) {
        var pad = 16;
        var w = t.offsetWidth, h = t.offsetHeight;
        var x = e.clientX + pad, y = e.clientY + pad;
        if (x + w > window.innerWidth) x = e.clientX - w - pad;
        if (y + h > window.innerHeight) y = e.clientY - h - pad;
        t.style.left = x + 'px';
        t.style.top = y + 'px';
      });
      node.addEventListener('mouseleave', function() {
        t.classList.add('hidden');
        var lanes = container.querySelectorAll('.gv-lane-hi');
        for (var li = 0; li < lanes.length; li++) lanes[li].classList.remove('gv-lane-hi');
        if (cb.onLeave) cb.onLeave(laneKey);
      });
    })(nodes[i]);
  }
}

function buildTip(info) {
  var h = '';
  if (info.isStore) {
    h += '<div class="gv-tip-title">🗄 ' + esc(info.path || info.symbol) + '</div>';
    if (info.desc) h += '<div class="gv-tip-desc">' + esc(info.desc) + '</div>';
    return h;
  }
  h += '<div class="gv-tip-title">' + esc(info.symbol) + (info.external ? ' <span class="gv-tip-ext">外部</span>' : '') + '</div>';
  if (info.file) h += '<div class="gv-tip-file">' + esc(info.file) + '</div>';
  if (info.desc) h += '<div class="gv-tip-desc">' + esc(info.desc) + '</div>';
  if (info.in && info.in.length) h += '<div class="gv-tip-io"><span class="gv-tip-k">入</span> ' + esc(info.in.join(', ')) + '</div>';
  if (info.out && info.out.length) h += '<div class="gv-tip-io"><span class="gv-tip-k">出</span> ' + esc(info.out.join(', ')) + '</div>';
  return h;
}

// 页面销毁时清理浮层
export function destroyTip() {
  if (tip) { tip.remove(); tip = null; }
}
