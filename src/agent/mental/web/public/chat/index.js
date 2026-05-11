// === 对话面板 ===
// 职责：管理对话的消息发送、轮询和停止

import { Data } from '../data.js';
import { Renderer } from '../renderer/index.js';

export const Chat = {
  pollTimer: null,
  _polling: false,
  _pollFails: 0,
  lastEventsJson: '',
  isRunning: false,

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
      const data = await Data.pollEvents(inst);
      this._pollFails = 0;
      this.isRunning = data.running;
      document.getElementById('runningIndicator').classList.toggle('hidden', !data.running);
      document.getElementById('sendBtn').classList.toggle('hidden', data.running);
      document.getElementById('stopBtn').classList.toggle('hidden', !data.running);
      const json = JSON.stringify({ events: data.events, usages: data.usages });
      if (json !== this.lastEventsJson) {
        this._render(data.events, data.usages);
        this.lastEventsJson = json;
        this._syncMentalViews(data.events);
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

  _render(events, usages) {
    const el = document.getElementById('chatMessages');
    const wasAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;

    window._deleteTurn = (gid) => this._deleteTurn(gid);
    window._deleteCommit = (index) => this._deleteCommit(index);
    window._retry = () => this.retry();
    window._replyAsk = (goalName, confirmed, idx) => this.replyAsk(goalName, confirmed, idx);

    el.innerHTML = Renderer.render(events, { interactive: true, usages: usages || [] });
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

      // 动态 import，加载失败不影响聊天面板
      import('../content/index.js').then(({ Content }) => {
        if (Content.current && written.has(Content.current)) {
          Content.select(Content.current);
        }
      }).catch(() => {});
    } catch {} // 任何异常都不影响轮询和渲染
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