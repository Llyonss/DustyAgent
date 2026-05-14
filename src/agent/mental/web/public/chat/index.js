// === 对话面板 ===
// 职责：管理对话的消息发送、轮询、停止和分支操作

import { Data } from '../data.js';
import { Renderer } from '../renderer/index.js';
import { Instance } from '../instance.js';

export const Chat = {
  pollTimer: null,
  _polling: false,
  _pollFails: 0,
  lastEventsJson: '',
  isRunning: false,
  // 分支状态
  _branchesCache: [],
  _branchOverviewOpen: false,

  startPoll() {
    this.stopPoll();
    this._polling = false;
    this._pollFails = 0;
    this._scheduleNext();
  },

  stopPoll() {
    if (this.pollTimer) { clearTimeout(this.pollTimer); this.pollTimer = null; }
    this._polling = false;
  },

  _scheduleNext() {
    this.pollTimer = setTimeout(() => this._poll(), 200);
  },

  async _poll() {
    if (this._polling) return;
    this._polling = true;
    const inst = localStorage.getItem('mental-instance');
    if (!inst) { this._polling = false; this._scheduleNext(); return; }
    try {
      const [eventData, branchData] = await Promise.all([
        Data.pollEvents(inst),
        Data.fetchBranches(inst).catch(() => [])
      ]);
      this._pollFails = 0;
      this._branchesCache = branchData;
      this.isRunning = eventData.running;
      document.getElementById('runningIndicator').classList.toggle('hidden', !eventData.running);
      document.getElementById('sendBtn').classList.toggle('hidden', eventData.running);
      document.getElementById('stopBtn').classList.toggle('hidden', !eventData.running);
      const json = JSON.stringify({ events: eventData.events, usages: eventData.usages, branches: branchData });
      if (json !== this.lastEventsJson) {
        this._render(eventData.events, eventData.usages, branchData);
        this.lastEventsJson = json;
        this._syncMentalViews(eventData.events);
        this._updateBranchOverview();
      }
    } catch {
      this._pollFails++;
      if (this._pollFails >= 15) {
        this.isRunning = false;
        document.getElementById('runningIndicator').classList.add('hidden');
        document.getElementById('sendBtn').classList.remove('hidden');
        document.getElementById('stopBtn').classList.add('hidden');
      }
    } finally {
      this._polling = false;
      this._scheduleNext();
    }
  },

  _render(events, usages, branches) {
    const el = document.getElementById('chatMessages');
    const wasAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;

    window._deleteTurn = (gid) => this._deleteTurn(gid);
    window._deleteCommit = (index) => this._deleteCommit(index);
    window._retry = () => this.retry();
    window._replyAsk = (goalName, confirmed, idx) => this.replyAsk(goalName, confirmed, idx);
    window._doForkBranch = (name, at) => this.forkBranch(name, at);
    window._doSwitchBranch = (key) => this.switchBranch(key);

    const inst = localStorage.getItem('mental-instance') || '';
    el.innerHTML = Renderer.render(events, {
      interactive: true,
      usages: usages || [],
      branches: branches || [],
      instance: inst
    });
    mermaid.run({ nodes: el.querySelectorAll('.mermaid:not([data-processed])') });
    if (wasAtBottom) el.scrollTop = el.scrollHeight;
  },

  _syncMentalViews(events) {
    try {
      const written = new Set();
      for (const e of events) {
        if (e.type === 'action' && e.tool === 'mental' && e.input?.name && (e.input.set != null || e.input.delete)) {
          written.add(e.input.name);
        }
      }
      if (!written.size) return;

      for (const name of written) {
        delete Data.cache.mental[name];
      }

      import('../content/index.js').then(({ Content }) => {
        if (Content.current && written.has(Content.current)) {
          Content.select(Content.current);
        }
      }).catch(() => {});
    } catch {}
  },

  _updateBranchOverview() {
    const el = document.getElementById('branchOverview');
    if (!el) return;
    const inst = localStorage.getItem('mental-instance') || '';
    const isBranch = inst.includes('/');
    const rootInst = inst.split('/')[0];
    const branchName = isBranch ? inst.split('/').slice(1).join('/') : '';

    if (isBranch) {
      el.innerHTML = `<span class="branch-overview-label">🔀 分支:</span><span class="branch-overview-name">${window.esc(branchName || inst)}</span><span class="branch-overview-home" onclick="event.stopPropagation();window._doSwitchBranch('${window.esc(rootInst)}')" title="回主线">↩ 主线</span>`;
      el.style.cursor = 'pointer';
      el.title = '点击查看分支树';
      el.onclick = () => this.showBranchTree();
      el.classList.remove('hidden');
    } else if (this._branchesCache.length > 0) {
      const treeHtml = this._renderBranchTree(this._branchesCache, 0);
      const tagCount = this._countBranches(this._branchesCache);
      el.innerHTML = `<span class="branch-overview-label">🔀 ${tagCount}个分支</span><span class="branch-overview-arrow">▾</span>`;
      el.style.cursor = 'pointer';
      el.title = '点击查看分支树';
      el.onclick = () => this.showBranchTree();
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  },

  _countBranches(branches) {
    let n = 0;
    for (const b of branches) { n += 1 + this._countBranches(b.children || []); }
    return n;
  },

  _renderBranchTree(branches, depth, prefix) {
    if (!branches || !branches.length) return '';
    prefix = prefix || '';
    const inst = localStorage.getItem('mental-instance') || '';
    let h = '';
    for (const b of branches) {
      const key = prefix ? `${prefix}/${b.name}` : b.name;
      const isActive = inst.endsWith('/' + key) || inst === key;
      const indent = '&nbsp;'.repeat(depth * 4);
      const icon = b.children?.length ? '├─' : '└─';
      h += `<div class="branch-tree-item${isActive ? ' active' : ''}" data-branch-key="${window.esc(key)}" data-branch-name="${window.esc(b.name)}">`;
      h += `<span class="branch-tree-indent">${indent}</span>`;
      h += `<span class="branch-tree-icon">${icon}</span>`;
      h += `<span class="branch-tree-name">${window.esc(b.name)}</span>`;
      if (isActive) h += `<span class="branch-tree-active">● 当前</span>`;
      h += `<span class="branch-tree-del" title="删除分支">×</span>`;
      h += `</div>`;
      if (b.children?.length) {
        h += this._renderBranchTree(b.children, depth + 1, key);
      }
    }
    return h;
  },

  showBranchTree() {
    const modal = document.getElementById('branchTreeModal');
    const body = document.getElementById('branchTreeBody');
    if (!modal || !body) return;
    const inst = localStorage.getItem('mental-instance') || '';
    const rootInst = inst.split('/')[0];
    const isActive = !inst.includes('/');

    let html = `<div class="branch-tree-item${isActive ? ' active' : ''}" data-branch-key="${window.esc(rootInst)}">`;
    html += `<span class="branch-tree-icon">●</span>`;
    html += `<span class="branch-tree-name root">主线 (${window.esc(rootInst)})</span>`;
    if (isActive) html += `<span class="branch-tree-active">● 当前</span>`;
    html += `</div>`;
    html += this._renderBranchTree(this._branchesCache, 1, rootInst);

    if (!this._branchesCache.length) {
      html += `<div class="empty" style="padding:16px">暂无分支</div>`;
    }

    body.innerHTML = html;
    modal.classList.remove('hidden');

    // 点击节点切换分支（排除删除按钮）
    body.querySelectorAll('.branch-tree-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('branch-tree-del')) return;
        const key = el.dataset.branchKey;
        if (key) { this.switchBranch(key); modal.classList.add('hidden'); }
      });
      // 删除按钮
      const delBtn = el.querySelector('.branch-tree-del');
      if (delBtn) {
        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await this._deleteBranchNode(el);
        });
      }
    });
  },

  closeBranchTree() {
    document.getElementById('branchTreeModal')?.classList.add('hidden');
  },

  async _deleteBranchNode(el) {
    const name = el.dataset.branchName;
    const key = el.dataset.branchKey;
    if (!name || !key) return;
    if (!confirm(`删除分支 "${name}" 及其所有嵌套分支和事件？不可撤销。`)) return;

    const parts = key.split('/');
    const branchName = parts[parts.length - 1];
    const parentInstance = parts.slice(0, -1).join('/');

    try {
      await Data.deleteBranch(parentInstance, branchName);
      // 如果删除的是当前活跃分支，切回主线
      const inst = localStorage.getItem('mental-instance');
      if (inst === key || inst.startsWith(key + '/')) {
        await this.switchBranch(parentInstance.split('/')[0]);
      }
      // 刷新分支数据
      const rootInst = (localStorage.getItem('mental-instance') || '').split('/')[0];
      this._branchesCache = await Data.fetchBranches(rootInst).catch(() => []);
      this._updateBranchOverview();
      this.showBranchTree();
    } catch (e) {
      alert('删除失败: ' + (e.message || e));
    }
  },

  async forkBranch(branchName, at) {
    const inst = localStorage.getItem('mental-instance');
    if (!inst) return;
    try {
      const result = await Data.createBranch(inst, branchName, at);
      if (result.ok) {
        await this.switchBranch(result.branchKey);
      }
    } catch (e) {
      alert('创建分支失败: ' + (e.message || e));
    }
  },

  async switchBranch(key) {
    localStorage.setItem('mental-instance', key);
    document.getElementById('chatMessages').innerHTML = '<div class="empty">加载中...</div>';
    this.stopPoll();
    this.lastEventsJson = '';
    this._branchesCache = [];
    this.startPoll();
  },

  async send() {
    const inst = localStorage.getItem('mental-instance');
    if (!inst) return;
    const inp = document.getElementById('chatInput');
    const text = inp.value.trim();
    if (!text) return;
    inp.value = '';
    inp.style.height = 'auto';
    try {
      await Data.sendEvent(inst, text);
    } catch {
      inp.value = text;
      return;
    }
    this._polling = false;
    this._pollFails = 0;
    this._poll();
  },

  async abort() {
    const inst = localStorage.getItem('mental-instance');
    if (!inst) return;
    await Data.stopLoop(inst);
  },

  async retry() {
    const inst = localStorage.getItem('mental-instance');
    if (!inst) return;
    await Data.retryEvent(inst);
  },

  async _deleteTurn(gid) {
    const inst = localStorage.getItem('mental-instance');
    if (!inst) return;
    const g = Renderer._turnRefs[gid];
    if (!g || !g._files || !g._files.length) return;
    if (!confirm(`删除此 turn 的 ${g._files.length} 个事件？不可撤销。`)) return;
    await Data.deleteEvents(inst, g._files);
    this.lastEventsJson = '';
  },

  async _deleteCommit(index) {
    const inst = localStorage.getItem('mental-instance');
    if (!inst) return;
    if (!confirm(`删除 commit #${index} 及其对应的故事？不可撤销。`)) return;
    await Data.deleteCommit(inst, index);
    this.lastEventsJson = '';
  },

  async toggleHistory() {
    const p = document.getElementById('historyPanel');
    if (p.classList.contains('hidden')) {
      p.classList.remove('hidden');
      const inst = localStorage.getItem('mental-instance');
      if (!inst) return;
      const hist = await Data.fetchHistory(inst);
      if (!hist.length) { p.innerHTML = '<div class="empty" style="padding:16px">暂无故事</div>'; return; }
      p.innerHTML = [...hist].reverse().map((h, i) => {
        const v = hist.length - i;
        const ents = Array.isArray(h.entities) && h.entities.length
          ? `<div class="hist-entities">${h.entities.map(e => `<span onclick="window._selectMental('${window.esc(e)}')">${window.esc(e)}</span>`).join(' ')}</div>` : '';
        return `<div class="hist-item"><div class="hist-title" onclick="this.nextElementSibling.classList.toggle('open')"><span class="hist-num">v${v}</span>${window.esc(h.title)}</div><div class="hist-story">${window.esc(h.story || '')}</div>${ents}</div>`;
      }).join('');
    } else {
      p.classList.add('hidden');
    }
  },

  async replyAsk(goalName, confirmed, idx) {
    const inst = localStorage.getItem('mental-instance');
    if (!inst) return;
    // TODO: wire goal reply API
  }
};
