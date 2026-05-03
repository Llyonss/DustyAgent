// === Chat Panel ===
const Chat = {
  expandedTools: new Set(),
  foldState: {},       // { taskId: 'open'|'closed' } — survives re-render
  _taskNameCount: {},  // used during tree build to generate stable IDs

  startPoll() {
    this.stopPoll();
    this._poll();
    App.pollTimer = setInterval(() => this._poll(), 200);
  },

  stopPoll() {
    if (App.pollTimer) { clearInterval(App.pollTimer); App.pollTimer = null; }
  },

  async _poll() {
    if (!App.instance) return;
    try {
      const data = await (await fetch('/api/events?instance=' + encodeURIComponent(App.instance))).json();
      App.isRunning = data.running;
      document.getElementById('runningIndicator').classList.toggle('hidden', !data.running);
      document.getElementById('sendBtn').classList.toggle('hidden', data.running);
      document.getElementById('stopBtn').classList.toggle('hidden', !data.running);
      const json = JSON.stringify(data.events);
      if (json !== App.lastEventsJson) { App.lastEventsJson = json; this.render(data.events); }
      if (typeof Goals !== 'undefined') Goals.load();
    } catch {}
  },

  render(events) {
    const el = document.getElementById('chatMessages');
    const wasAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;

    this._toolUid = 0;
    this._eventsRef = events;
    this._taskNameCount = {};

    // Split by commits
    const commits = [];
    for (let i = 0; i < events.length; i++) {
      if (events[i].type === 'action' && events[i].tool === 'commit' && !events[i].error) commits.push(i);
    }

    let html = '', segStart = 0;
    for (const ci of commits) {
      html += this._renderSegment(events.slice(segStart, ci));
      html += `<div class="msg-commit">┄┄ 🧠 ${esc(events[ci].input?.title || 'commit')} ┄┄</div>`;
      segStart = ci + 1;
    }
    html += this._renderSegment(events.slice(segStart));

    el.innerHTML = html;
    if (wasAtBottom) el.scrollTop = el.scrollHeight;
  },

  // ═══════════════════════════════════════════
  // SEGMENT → TURN GROUPS → TASK TREE → HTML
  // ═══════════════════════════════════════════

  _renderSegment(events) {
    if (!events.length) return '';
    const groups = this._groupByTurn(events);
    const tree = this._buildTaskTree(groups);
    return this._renderNodes(tree, 0);
  },

  // ── Phase 1: Group events by turn ──

  _groupByTurn(events) {
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

    // Annotate each group with task start/done info
    for (const g of groups) {
      g.taskStart = null;
      g.taskDone = null;
      for (const e of g.events) {
        if (e.type === 'action' && e.tool === 'task' && !e.error) {
          if (e.input?.start) {
            g.taskStart = { name: e.input.start, requirement: e.input.requirement || '' };
          }
          if (e.input?.done) {
            const out = e.output || '';
            const m = out.match(/\[折叠摘要:\s*([^\]]*)\]/);
            g.taskDone = { name: e.input.done, result: m ? m[1].trim() : (e.input.conclusion || e.input.result || '') };
          }
        }
      }
    }
    return groups;
  },

  // ── Phase 2: Build task tree (clean stack algorithm) ──

  _buildTaskTree(groups) {
    const stack = []; // each: { name, requirement, children: [] }
    const root = [];

    const pushTo = (node) => {
      if (stack.length > 0) stack[stack.length - 1].children.push(node);
      else root.push(node);
    };

    for (const g of groups) {
      // Special case: same-turn same-name start+done (empty task)
      if (g.taskStart && g.taskDone && g.taskStart.name === g.taskDone.name) {
        const taskNode = {
          type: 'task', name: g.taskStart.name,
          requirement: g.taskStart.requirement,
          result: g.taskDone.result,
          closed: true, children: [g]
        };
        pushTo(taskNode);
        continue;
      }

      // Step 1: Process done first (LIFO — close innermost matching)
      if (g.taskDone) {
        let matchIdx = -1;
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].name === g.taskDone.name) { matchIdx = i; break; }
        }
        if (matchIdx >= 0) {
          // Flush any unclosed tasks above the match
          while (stack.length - 1 > matchIdx) {
            const orphan = stack.pop();
            const taskNode = {
              type: 'task', name: orphan.name,
              requirement: orphan.requirement,
              result: null, closed: false, children: orphan.children
            };
            pushTo(taskNode);
          }
          // Close the matched task
          const entry = stack.pop();
          entry.children.push(g); // done turn belongs inside the task
          const taskNode = {
            type: 'task', name: entry.name,
            requirement: entry.requirement,
            result: g.taskDone.result,
            closed: true, children: entry.children
          };
          pushTo(taskNode);
        } else {
          // No match found — treat as bare turn
          pushTo(g);
        }
        // If this group also has a start, fall through to step 2
        if (!g.taskStart) continue;
      }

      // Step 2: Process start (push new frame)
      if (g.taskStart) {
        const frame = { name: g.taskStart.name, requirement: g.taskStart.requirement, children: [g] };
        stack.push(frame);
        continue;
      }

      // Step 3: Bare turn (no task events)
      pushTo(g);
    }

    // Flush remaining unclosed tasks
    while (stack.length > 0) {
      const orphan = stack.pop();
      const taskNode = {
        type: 'task', name: orphan.name,
        requirement: orphan.requirement,
        result: null, closed: false, children: orphan.children
      };
      pushTo(taskNode);
    }

    return root;
  },

  // ── Phase 3: Render tree recursively ──

  _renderNodes(nodes, depth) {
    let h = '';
    for (const node of nodes) {
      if (node.type === 'task') h += this._renderTask(node, depth);
      else h += this._renderTurn(node, depth);
    }
    return h;
  },

  _getTaskId(name) {
    const count = this._taskNameCount[name] || 0;
    this._taskNameCount[name] = count + 1;
    return name + '#' + count;
  },

  _countTurns(node) {
    if (node.type !== 'task') return 1;
    let n = 0;
    for (const c of node.children) n += this._countTurns(c);
    return n;
  },

  _isFolded(taskId, task) {
    if (taskId in this.foldState) return this.foldState[taskId] === 'closed';
    // Default: closed tasks fold, open tasks expand
    return task.closed;
  },

  _renderTask(task, depth) {
    const taskId = this._getTaskId(task.name);
    const folded = this._isFolded(taskId, task);
    const d = Math.min(depth, 4);
    const turns = this._countTurns(task);
    const arrow = folded ? '▶' : '▼';
    const stateClass = folded ? 'fold-closed' : 'fold-open';

    const resultHtml = task.result ? `<span class="task-result">· ${esc(task.result)}</span>` : '';
    const unclosedBadge = !task.closed ? ' <span class="task-unclosed">⏳ 进行中</span>' : '';
    const reqHtml = task.requirement && !task.result ? `<span class="task-req">· ${esc(task.requirement)}</span>` : '';
    const countBadge = `<span class="task-count">${turns}t</span>`;

    let h = `<div class="task-fold depth-${d} ${stateClass}" data-task-id="${esc(taskId)}">`;
    h += `<div class="task-fold-header" onclick="Chat.toggleTask(this)">`;
    h += `<span class="task-arrow">${arrow}</span>`;
    h += `<span class="task-name">📋 ${esc(task.name)}</span>`;
    h += countBadge + resultHtml + reqHtml + unclosedBadge;
    h += `</div>`;
    h += `<div class="task-fold-body">`;
    h += this._renderNodes(task.children, depth + 1);
    h += `</div></div>`;
    return h;
  },

  _renderTurn(g, depth) {
    let h = `<div class="turn-block">`;
    for (const e of g.events) {
      h += this._renderEvent(e);
    }
    h += `</div>`;
    return h;
  },

  _renderEvent(e) {
    if (e.type === 'user') return `<div class="msg-user">${esc(e.content)}</div>`;
    if (e.type === 'error') return `<div class="msg-error"><span>❌ ${esc(e.error || e.message || '')}</span><button class="retry-btn" onclick="Chat.retry()">🔄 重试</button></div>`;
    if (e.type !== 'action') return '';

    // Task start/done distinctive rendering
    if (e.tool === 'task' && !e.error) {
      if (e.input?.start) {
        return `<div class="msg-task-start"><span class="task-badge task-badge-start">▶ START</span><span class="task-label">${esc(e.input.start)}</span>${e.input.requirement ? `<span class="task-detail">${esc(e.input.requirement)}</span>` : ''}</div>`;
      }
      if (e.input?.done) {
        const concl = e.input.conclusion || e.input.result || '';
        return `<div class="msg-task-done"><span class="task-badge task-badge-done">✓ DONE</span><span class="task-label">${esc(e.input.done)}</span>${concl ? `<span class="task-detail">${esc(concl)}</span>` : ''}</div>`;
      }
    }

    if (e.tool === 'speak') return `<div class="msg-ai">${md(typeof e.output === 'string' ? e.output : '')}</div>`;
    if (e.tool === 'think') return `<div class="msg-think"><div class="think-label">💭 思考</div>${md(e.input?.content || '')}</div>`;

    if (e.tool === 'goal' && e.input?.ask) {
      const gn = esc(e.input.name || '').replace(/'/g, "\\'");
      const idx = this._eventsRef ? this._eventsRef.indexOf(e) : -1;
      const replied = idx >= 0 && this._eventsRef.slice(idx + 1).some(ev => ev.type === 'user');
      if (replied) {
        return `<div class="msg-ask-card ask-done"><div class="ask-goal">🎯 ${esc(e.input.name)}</div><div class="ask-question">${md(e.input.ask)}</div><div class="ask-status">✅ 已回复</div></div>`;
      }
      return `<div class="msg-ask-card"><div class="ask-goal">🎯 ${esc(e.input.name)}</div><div class="ask-question">${md(e.input.ask)}</div><textarea class="ask-input" id="askInput_${idx}" placeholder="输入反馈（可选）..."></textarea><div class="ask-actions"><button class="ask-confirm" onclick="Chat.replyAsk('${gn}',true,${idx})">✅ 确认</button><button class="ask-deny" onclick="Chat.replyAsk('${gn}',false,${idx})">❌ 否认</button></div></div>`;
    }

    // Generic tool call
    const uid = 't' + (this._toolUid++);
    const open = this.expandedTools.has(uid);
    const detail = (e.input ? JSON.stringify(e.input, null, 2) : '') +
      (e.output ? '\n→ ' + (typeof e.output === 'string' ? e.output : JSON.stringify(e.output, null, 2)) : '') +
      (e.error ? '\n⚠ ' + e.error : '');
    return `<div class="msg-tool" onclick="Chat.toggleTool('${uid}')">${this.toolSummary(e)} ▸</div>` +
      `<div class="msg-tool-detail${open ? ' open' : ''}" id="${uid}">${esc(detail.substring(0, 3000))}${detail.length > 3000 ? '...' : ''}</div>`;
  },

  _toolUid: 0,

  // ── Interaction ──

  toggleTask(hdr) {
    const fold = hdr.closest('.task-fold');
    if (!fold) return;
    const taskId = fold.dataset.taskId;
    const isClosed = fold.classList.contains('fold-closed');
    // Toggle
    if (isClosed) {
      fold.classList.remove('fold-closed');
      fold.classList.add('fold-open');
      hdr.querySelector('.task-arrow').textContent = '▼';
      this.foldState[taskId] = 'open';
    } else {
      fold.classList.remove('fold-open');
      fold.classList.add('fold-closed');
      hdr.querySelector('.task-arrow').textContent = '▶';
      this.foldState[taskId] = 'closed';
    }
  },

  toggleTool(uid) {
    const el = document.getElementById(uid);
    if (!el) return;
    el.classList.toggle('open');
    if (el.classList.contains('open')) this.expandedTools.add(uid);
    else this.expandedTools.delete(uid);
  },

  toolSummary(e) {
    const t = e.tool, inp = e.input || {};
    const icons = { mental: '🧠', links: '🔗', file: '📁', cmd: '⚡', think: '💭', commit: '🧠', eye: '👁', image: '🎨', video: '🎬', continue: '▶', stop: '⏸', history: '📜', read: '📁' };
    const icon = icons[t] || '🔧';
    let summary = t;
    if (t === 'mental' || t === 'links') {
      const name = inp.name || 'self';
      summary = `${t} <span class="room-link" onclick="event.stopPropagation();Mental.select('${esc(name)}')">${esc(name)}</span>`;
      if (inp.delete) summary += ' (删除)';
      else if (inp.set != null) summary += ' (写入)';
      else summary += ' (读取)';
    } else if (t === 'file' || t === 'read') {
      const p = inp.path || '';
      const short = p.split(/[/\\]/).slice(-2).join('/');
      summary = `${t} ${esc(short)}`;
      if (inp.delete) summary += ' (删除)';
      else if (inp.set != null && inp.select == null) summary += ' (写入)';
      else if (inp.select != null && inp.set != null) summary += ' (修改)';
      else summary += ' (读取)';
    } else if (t === 'cmd') {
      const c = (inp.command || '').substring(0, 60);
      summary = `cmd ${esc(c)}${(inp.command || '').length > 60 ? '...' : ''}`;
    } else if (t === 'think') {
      summary = '思考';
    }
    return `<span class="tool-icon">${icon}</span> ${summary}`;
  },

  // ── Actions ──

  async send() {
    const inp = document.getElementById('chatInput');
    const text = inp.value.trim();
    if (!text || !App.instance) return;
    inp.value = '';
    await fetch('/api/events?instance=' + encodeURIComponent(App.instance), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: text })
    });
  },

  async abort() {
    if (!App.instance) return;
    await fetch('/api/loop?instance=' + encodeURIComponent(App.instance), { method: 'DELETE' });
  },

  async replyAsk(goalName, confirmed, idx) {
    const textarea = document.getElementById('askInput_' + idx);
    const message = textarea ? textarea.value.trim() : '';
    await fetch('/api/goals/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instance: App.instance, goalName, confirmed, message })
    });
  },

  async retry() {
    if (!App.instance) return;
    await fetch('/api/events?instance=' + encodeURIComponent(App.instance), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ retry: true })
    });
  },

  async toggleHistory() {
    const p = document.getElementById('historyPanel');
    if (p.classList.contains('hidden')) { p.classList.remove('hidden'); this.loadHistory(); }
    else p.classList.add('hidden');
  },

  async loadHistory() {
    const hist = await (await fetch('/api/history?instance=' + encodeURIComponent(App.instance))).json();
    const el = document.getElementById('historyPanel');
    if (!hist.length) { el.innerHTML = '<div class="empty" style="padding:16px">暂无故事</div>'; return; }
    el.innerHTML = [...hist].reverse().map((h, i) => {
      const v = hist.length - i;
      const ents = Array.isArray(h.entities) && h.entities.length
        ? `<div class="hist-entities">${h.entities.map(e => `<span onclick="Mental.select('${esc(e)}')">${esc(e)}</span>`).join(' ')}</div>` : '';
      return `<div class="hist-item"><div class="hist-title" onclick="this.nextElementSibling.classList.toggle('open')"><span class="hist-num">v${v}</span>${esc(h.title)}</div><div class="hist-story">${esc(h.story || '')}</div>${ents}</div>`;
    }).join('');
  },
};

const chatInput = document.getElementById('chatInput');
chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); Chat.send(); }
});
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
});
