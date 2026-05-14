// === 事件渲染管道 ===
// 职责：把事件数组渲染为对话HTML
// 包含：commit切分 → turn分组 → task树构建 → HTML渲染

const TurnGrouper = {
  group(events) {
    const groups = [];
    let cur = null;

    for (const e of events) {
      if (e.type === 'user' || e.type === 'error') {
        groups.push({ type: 'turn', events: [e] });
        cur = null;
      } else if (e.type === 'action') {
        const t = e.turn ?? null;
        if (!cur || cur._turn !== t) {
          cur = { type: 'turn', _turn: t, events: [e] };
          groups.push(cur);
        } else {
          cur.events.push(e);
        }
      } else {
        if (!cur) { cur = { type: 'turn', events: [e] }; groups.push(cur); }
        else cur.events.push(e);
      }
    }

    for (const g of groups) {
      g._files = g.events.map(e => e._file).filter(Boolean);
      g.taskStart = null;
      g.taskDone = null;
      for (const e of g.events) {
        if (e.type === 'action' && e.tool === 'task' && !e.error) {
          if (e.input?.start) g.taskStart = { name: e.input.start, requirement: e.input.requirement || '' };
          if (e.input?.done) {
            const out = e.output || '';
            const m = out.match(/\[折叠摘要:\s*([^\]]*)\]/);
            g.taskDone = { name: e.input.done, result: m ? m[1].trim() : (e.input.conclusion || e.input.result || '') };
          }
        }
      }
    }
    return groups;
  }
};

const TaskTree = {
  foldState: {},
  _taskNameCount: {},

  build(turns) {
    this._taskNameCount = {};
    const stack = [];
    const root = [];

    const pushTo = (node) => {
      if (stack.length > 0) stack[stack.length - 1].children.push(node);
      else root.push(node);
    };

    for (const g of turns) {
      if (g.taskStart && g.taskDone && g.taskStart.name === g.taskDone.name) {
        pushTo({ type: 'task', name: g.taskStart.name, requirement: g.taskStart.requirement, result: g.taskDone.result, closed: true, children: [g] });
        continue;
      }
      if (g.taskDone) {
        let matchIdx = -1;
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].name === g.taskDone.name) { matchIdx = i; break; }
        }
        if (matchIdx >= 0) {
          while (stack.length - 1 > matchIdx) {
            const orphan = stack.pop();
            pushTo({ type: 'task', name: orphan.name, requirement: orphan.requirement, result: null, closed: false, children: orphan.children });
          }
          const entry = stack.pop();
          entry.children.push(g);
          pushTo({ type: 'task', name: entry.name, requirement: entry.requirement, result: g.taskDone.result, closed: true, children: entry.children });
        } else {
          pushTo(g);
        }
        if (!g.taskStart) continue;
      }
      if (g.taskStart) {
        stack.push({ name: g.taskStart.name, requirement: g.taskStart.requirement, children: [g] });
        continue;
      }
      pushTo(g);
    }

    while (stack.length > 0) {
      const orphan = stack.pop();
      pushTo({ type: 'task', name: orphan.name, requirement: orphan.requirement, result: null, closed: false, children: orphan.children });
    }
    return root;
  },

  getFoldState(taskId) {
    if (taskId in this.foldState) return this.foldState[taskId] === 'closed';
    return true;
  },

  setFoldState(taskId, closed) {
    this.foldState[taskId] = closed ? 'closed' : 'open';
  }
};

export const Renderer = {
  _toolUid: 0,
  _turnNum: 0,
  _turnGid: 0,
  _turnRefs: {},
  _eventsRef: null,
  expandedTools: new Set(),
  // 分支渲染状态
  _forkPointMap: {},
  _activeInstance: '',

  render(events, options = {}) {
    this._toolUid = 0;
    this._turnNum = 0;
    this._turnGid = 0;
    this._turnRefs = {};
    this._eventsRef = events;
    this._activeInstance = options.instance || '';
    TaskTree._taskNameCount = {};

    const interactive = options.interactive !== false;
    this._usages = options.usages || [];

    // 构建分叉点映射：事件文件名 → 分支信息
    this._forkPointMap = {};
    const rootInst = (options.instance || '').split('/')[0];
    this._flattenBranches(options.branches || [], rootInst || '');

    // 按 commit 切段
    const commits = [];
    for (let i = 0; i < events.length; i++) {
      if (events[i].type === 'action' && events[i].tool === 'commit' && !events[i].error) commits.push(i);
    }

    let html = '', segStart = 0, commitIndex = 0;
    for (const ci of commits) {
      commitIndex++;
      html += this._renderSegment(events.slice(segStart, ci), interactive);
      if (interactive) {
        html += `<div class="msg-commit"><span class="commit-sep">┄┄ 🧠 ${window.esc(events[ci].input?.title || 'commit')} ┄┄</span><button class="commit-delete-btn" onclick="window._deleteCommit(${commitIndex})" title="删除此commit及其故事">×</button></div>`;
      } else {
        html += `<div class="msg-commit"><span class="commit-sep">┄┄ 🧠 ${window.esc(events[ci].input?.title || 'commit')} ┄┄</span></div>`;
      }
      segStart = ci + 1;
    }
    html += this._renderSegment(events.slice(segStart), interactive);
    return html;
  },

  _flattenBranches(branches, prefix) {
    if (!Array.isArray(branches)) return;
    for (const b of branches) {
      const key = prefix ? `${prefix}/${b.name}` : b.name;
      if (!this._forkPointMap[b.at]) this._forkPointMap[b.at] = [];
      this._forkPointMap[b.at].push({ name: b.name, key, children: b.children || [] });
      if (b.children && b.children.length) {
        this._flattenBranches(b.children, key);
      }
    }
  },

  _renderSegment(events, interactive) {
    if (!events.length) return '';
    const turns = TurnGrouper.group(events);
    const nodes = TaskTree.build(turns);
    return this._renderNodes(nodes, 0, interactive);
  },

  _renderNodes(nodes, depth, interactive) {
    let h = '';
    for (const node of nodes) {
      if (node.type === 'task') h += this._renderTask(node, depth);
      else h += this._renderTurn(node, depth, interactive);
    }
    return h;
  },

  _renderTask(task, depth) {
    if (!TaskTree._taskNameCount[task.name]) TaskTree._taskNameCount[task.name] = 0;
    TaskTree._taskNameCount[task.name]++;
    const taskId = task.name + '#' + TaskTree._taskNameCount[task.name];
    const folded = TaskTree.getFoldState(taskId);
    const d = Math.min(depth, 4);
    const arrow = folded ? '▶' : '▼';
    const stateClass = folded ? 'fold-closed' : 'fold-open';
    const resultHtml = task.result ? `<span class="task-result">· ${window.esc(task.result)}</span>` : '';
    const unclosedBadge = !task.closed ? ' <span class="task-unclosed">⏳ 进行中</span>' : '';
    const reqHtml = task.requirement && !task.result ? `<span class="task-req">· ${window.esc(task.requirement)}</span>` : '';

    let turns = 0;
    const countTurns = (n) => { if (n.type !== 'task') { turns++; return; } for (const c of n.children) countTurns(c); };
    countTurns(task);
    const countBadge = `<span class="task-count">${turns}t</span>`;

    let h = `<div class="task-fold depth-${d} ${stateClass}" data-task-id="${window.esc(taskId)}">`;
    h += `<div class="task-fold-header" onclick="window._toggleTask(this)">`;
    h += `<span class="task-arrow">${arrow}</span>`;
    h += `<span class="task-name">📋 ${window.esc(task.name)}</span>`;
    h += countBadge + resultHtml + reqHtml + unclosedBadge;
    h += `</div>`;
    h += `<div class="task-fold-body">`;
    h += this._renderNodes(task.children, depth + 1, true);
    h += `</div></div>`;
    return h;
  },

  _renderTurn(g, depth, interactive) {
    const num = ++this._turnNum;
    const gid = this._turnGid++;
    this._turnRefs[gid] = g;

    const usage = this._usages.find(u => u.turn === g._turn);
    const costHtml = usage?.cost != null
      ? `<span class="turn-cost">${usage.cost.toFixed(4)}</span>`
      : '';

    // 检查该 turn 是否是分叉点
    let forkBranches = [];
    let forkFiles = [];
    for (const f of g._files) {
      if (this._forkPointMap[f]) {
        forkBranches = this._forkPointMap[f];
        forkFiles.push(f);
      }
    }
    // 去重
    const seen = new Set();
    forkBranches = forkBranches.filter(b => { if (seen.has(b.key)) return false; seen.add(b.key); return true; });

    let h = `<div class="turn-block">`;
    if (interactive) {
      h += `<div class="turn-header">`;
      h += `<span class="turn-num">Turn ${num}</span>${costHtml}`;
      // 分叉按钮始终显示
      h += `<button class="fork-btn" onclick="window._forkBranch(${gid})" title="从此处分叉新分支">⑂</button>`;
      h += `<button class="turn-delete-btn" onclick="window._deleteTurn(${gid})" title="删除此turn所有事件">×</button>`;
      h += `</div>`;
    } else {
      h += `<div class="turn-header"><span class="turn-num">Turn ${num}</span>${costHtml}</div>`;
    }

    // 分叉点：渲染分支条
    if (forkBranches.length > 0) {
      h += `<div class="branch-bar">`;
      h += `<span class="branch-bar-label">▐</span>`;
      for (const b of forkBranches) {
        const isActive = this._activeInstance && (this._activeInstance.endsWith('/' + b.key) || this._activeInstance === b.key);
        h += `<span class="branch-tag${isActive ? ' active' : ''}" onclick="window._switchBranch('${window.esc(b.key)}')">${window.esc(b.name)}</span>`;
      }
      h += `<span class="branch-tag branch-tag-new" onclick="window._forkBranch(${gid})">+ 新建</span>`;
      h += `</div>`;
    }

    for (const e of g.events) {
      h += this._renderEvent(e, interactive);
    }
    h += `</div>`;
    return h;
  },

  _renderEvent(e, interactive) {
    if (e.type === 'user') return `<div class="msg-user">${window.esc(e.content)}</div>`;
    if (e.type === 'error') {
      let h = `<div class="msg-error"><span>❌ ${window.esc(e.error || e.message || '')}</span>`;
      if (interactive) h += `<button class="retry-btn" onclick="window._retry()">🔄 重试</button>`;
      h += `</div>`;
      return h;
    }
    if (e.type !== 'action') return '';

    if (e.tool === 'task' && !e.error) {
      if (e.input?.start) {
        return `<div class="msg-task-start"><div class="task-head"><span class="task-badge task-badge-start">▶ START</span><span class="task-label">${window.esc(e.input.start)}</span></div>${e.input.requirement ? `<div class="task-detail">${window.esc(e.input.requirement)}</div>` : ''}</div>`;
      }
      if (e.input?.done) {
        const concl = e.input.conclusion || e.input.result || '';
        return `<div class="msg-task-done"><div class="task-head"><span class="task-badge task-badge-done">✓ DONE</span><span class="task-label">${window.esc(e.input.done)}</span></div>${concl ? `<div class="task-detail">${window.esc(concl)}</div>` : ''}</div>`;
      }
    }

    if (e.tool === 'speak') return `<div class="msg-ai">${window.md(typeof e.output === 'string' ? e.output : '')}</div>`;
    if (e.tool === 'think') return `<div class="msg-think"><div class="think-label">💭 思考</div>${window.md(e.input?.content || '')}</div>`;

    if (e.tool === 'goal' && e.input?.ask && interactive) {
      const idx = this._eventsRef ? this._eventsRef.indexOf(e) : -1;
      const replied = idx >= 0 && this._eventsRef.slice(idx + 1).some(ev => ev.type === 'user');
      if (replied) {
        return `<div class="msg-ask-card ask-done"><div class="ask-goal">🎯 ${window.esc(e.input.name)}</div><div class="ask-question">${window.md(e.input.ask)}</div><div class="ask-status">✅ 已回复</div></div>`;
      }
      return `<div class="msg-ask-card"><div class="ask-goal">🎯 ${window.esc(e.input.name)}</div><div class="ask-question">${window.md(e.input.ask)}</div><textarea class="ask-input" id="askInput_${idx}" placeholder="输入反馈（可选）..."></textarea><div class="ask-actions"><button class="ask-confirm" onclick="window._replyAsk('${window.esc(e.input.name || '').replace(/'/g, "\\'")}',true,${idx})">✅ 确认</button><button class="ask-deny" onclick="window._replyAsk('${window.esc(e.input.name || '').replace(/'/g, "\\'")}',false,${idx})">❌ 否认</button></div></div>`;
    }

    const uid = 't' + (this._toolUid++);
    const open = this.expandedTools.has(uid);
    const detail = (e.input ? JSON.stringify(e.input, null, 2) : '') +
      (e.output ? '\n→ ' + (typeof e.output === 'string' ? e.output : JSON.stringify(e.output, null, 2)) : '') +
      (e.error ? '\n⚠ ' + e.error : '');
    return `<div class="msg-tool" onclick="window._toggleTool('${uid}')">${toolSummary(e)} ▸</div>` +
      `<div class="msg-tool-detail${open ? ' open' : ''}" id="${uid}">${window.esc(detail.substring(0, 3000))}${detail.length > 3000 ? '...' : ''}</div>`;
  }
};

function toolSummary(e) {
  const t = e.tool, inp = e.input || {};
  const icons = { mental: '🧠', links: '🔗', file: '📁', cmd: '⚡', think: '💭', commit: '🧠', eye: '👁', image: '🎨', video: '🎬', history: '📜' };
  const icon = icons[t] || '🔧';
  let summary = t;
  if (t === 'mental' || t === 'links') {
    const name = inp.name || 'self';
    summary = `${t} <span class="room-link" onclick="event.stopPropagation();window._selectMental('${window.esc(name)}')">${window.esc(name)}</span>`;
    if (inp.delete) summary += ' (删除)';
    else if (inp.set != null) summary += ' (写入)';
    else summary += ' (读取)';
  } else if (t === 'file' || t === 'read') {
    const p = inp.path || '';
    const short = p.split(/[/\\]/).slice(-2).join('/');
    summary = `${t} ${window.esc(short)}`;
    if (inp.delete) summary += ' (删除)';
    else if (inp.set != null && inp.select == null) summary += ' (写入)';
    else if (inp.select != null && inp.set != null) summary += ' (修改)';
    else summary += ' (读取)';
  } else if (t === 'cmd') {
    const c = (inp.command || '').substring(0, 60);
    summary = `cmd ${window.esc(c)}${(inp.command || '').length > 60 ? '...' : ''}`;
  } else if (t === 'think') {
    summary = '思考';
  }
  return `<span class="tool-icon">${icon}</span> ${summary}`;
}

// 全局函数
window._toggleTool = (uid) => {
  const el = document.getElementById(uid);
  if (!el) return;
  el.classList.toggle('open');
  if (el.classList.contains('open')) Renderer.expandedTools.add(uid);
  else Renderer.expandedTools.delete(uid);
};

window._toggleTask = (hdr) => {
  const fold = hdr.closest('.task-fold');
  if (!fold) return;
  const taskId = fold.dataset.taskId;
  const isClosed = fold.classList.contains('fold-closed');
  if (isClosed) {
    fold.classList.remove('fold-closed');
    fold.classList.add('fold-open');
    hdr.querySelector('.task-arrow').textContent = '▼';
    TaskTree.setFoldState(taskId, false);
  } else {
    fold.classList.remove('fold-open');
    fold.classList.add('fold-closed');
    hdr.querySelector('.task-arrow').textContent = '▶';
    TaskTree.setFoldState(taskId, true);
  }
};

// 分支操作
window._forkBranch = (gid) => {
  const g = Renderer._turnRefs[gid];
  if (!g || !g._files || !g._files.length) return;
  const name = prompt('分支名:');
  if (!name) return;
  // 找到该 turn 中第一个有 _file 的事件作为锚点
  const at = g._files[g._files.length - 1]; // 使用 turn 最后一个事件作为锚点
  if (window._doForkBranch) window._doForkBranch(name, at);
};

window._switchBranch = (key) => {
  if (window._doSwitchBranch) window._doSwitchBranch(key);
};
