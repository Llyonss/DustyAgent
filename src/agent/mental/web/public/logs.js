// === infer 日志查看器 ===
// 职责：浏览每轮 infer 的完整请求快照（system/tools/messages），标识缓存点
// 两个入口：顶栏 📋 全局列表；turn 标题 📋 直达该轮日志

import { Data } from './data.js';

function inst() { return localStorage.getItem('mental-instance') || ''; }

function fmtTime(ts) {
  if (!ts) return '\u2014';
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function fmtDur(ms) {
  if (!ms) return '\u2014';
  return ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(1) + 's';
}
function fmtTok(n) {
  if (n == null) return '0';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}
function modelShort(m) { return (m || '').split('/').pop() || '\u2014'; }

// 提取一个 content block / system 项 / tool 上的 cache_control，返回徽章 HTML 或 ''
function cacheBadge(obj) {
  const cc = obj && obj.cache_control;
  if (!cc) return '';
  const ttl = cc.ttl || (cc.type === 'ephemeral' ? '5m' : '');
  return `<span class="log-cache-badge" title="此处设置了 prompt 缓存断点">\ud83d\udd16 cache${ttl ? ' ' + ttl : ''}</span>`;
}

// 渲染单个 message 的内容（content 可能是字符串或 block 数组）
function renderContent(content) {
  if (content == null) return '<span class="log-empty">(空)</span>';
  if (typeof content === 'string') {
    return `<div class="log-text">${window.esc(content)}</div>`;
  }
  if (!Array.isArray(content)) {
    return `<div class="log-text">${window.esc(JSON.stringify(content))}</div>`;
  }
  let h = '';
  for (const b of content) {
    const t = b.type;
    if (t === 'text') {
      h += `<div class="log-block log-block-text"><div class="log-block-tag">text</div><div class="log-text">${window.esc(b.text || '')}</div>${cacheBadge(b)}</div>`;
    } else if (t === 'image' || t === 'image_url') {
      const src = t === 'image' ? (b.source?.data || '') : (b.image_url?.url || '');
      h += `<div class="log-block log-block-image"><div class="log-block-tag">\ud83d\uddbc image</div><div class="log-text log-mono">${window.esc(String(src))}</div>${cacheBadge(b)}</div>`;
    } else if (t === 'tool_use') {
      h += `<div class="log-block log-block-tooluse"><div class="log-block-tag">\ud83d\udd27 tool_use \u00b7 ${window.esc(b.name || '')}</div><pre class="log-json">${window.esc(JSON.stringify(b.input, null, 2))}</pre>${cacheBadge(b)}</div>`;
    } else if (t === 'tool_result') {
      const inner = typeof b.content === 'string' ? b.content : JSON.stringify(b.content, null, 2);
      h += `<div class="log-block log-block-toolresult"><div class="log-block-tag">\u21a9 tool_result</div><div class="log-text">${window.esc(inner || '')}</div>${cacheBadge(b)}</div>`;
    } else {
      h += `<div class="log-block"><div class="log-block-tag">${window.esc(t || '?')}</div><pre class="log-json">${window.esc(JSON.stringify(b, null, 2))}</pre>${cacheBadge(b)}</div>`;
    }
  }
  return h;
}

export const Logs = {
  _list: [],
  _current: null,   // 当前选中日志完整内容

  init() {
    document.getElementById('btnLogs')?.addEventListener('click', () => this.openModal());
    document.getElementById('btnLogsClose')?.addEventListener('click', () => this.closeModal());
    document.getElementById('logsModal')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.closeModal();
    });
    // turn 标题按钮直达
    window._showLog = (turn) => this.openByTurn(turn);
  },

  async openModal() {
    document.getElementById('logsModal').classList.remove('hidden');
    document.getElementById('logsListPanel').innerHTML = '<div class="log-loading">加载中...</div>';
    document.getElementById('logsDetailPanel').innerHTML = '<div class="log-placeholder">\u2190 选择一条日志查看请求快照</div>';
    await this._loadList();
  },

  async openByTurn(turn) {
    document.getElementById('logsModal').classList.remove('hidden');
    document.getElementById('logsListPanel').innerHTML = '<div class="log-loading">加载中...</div>';
    document.getElementById('logsDetailPanel').innerHTML = '<div class="log-loading">加载日志...</div>';
    await this._loadList();
    // 选中并展示该 turn
    const hit = this._list.find(l => l.turn === Number(turn));
    if (hit) this._select(hit.ts, Number(turn));
    else {
      try {
        const log = await Data.fetchLog(inst(), { turn: Number(turn) });
        this._current = log;
        this._renderDetail();
      } catch {
        document.getElementById('logsDetailPanel').innerHTML = '<div class="log-placeholder">未找到该轮日志（可能未启用日志或已清理）</div>';
      }
    }
  },

  closeModal() {
    document.getElementById('logsModal').classList.add('hidden');
  },

  async _loadList() {
    try {
      const r = await Data.fetchLogs(inst());
      this._list = r.logs || [];
    } catch { this._list = []; }
    this._renderList();
  },

  _renderList() {
    const el = document.getElementById('logsListPanel');
    if (!this._list.length) {
      el.innerHTML = '<div class="log-placeholder">暂无日志</div>';
      return;
    }
    const curTurn = this._current?.response?.start;
    let h = '';
    for (const l of this._list) {
      const active = curTurn != null && l.turn === curTurn ? ' active' : '';
      const cacheHit = l.cache_read_input_tokens > 0;
      const errCls = l.hasError ? ' has-error' : '';
      const errDot = l.hasError ? '<span class="log-item-err" title="本轮出错">\u26a0\ufe0f</span>' : '';
      h += `<div class="log-item${active}${errCls}" data-ts="${l.ts}" data-turn="${l.turn ?? ''}">`;
      h += `<div class="log-item-top"><span class="log-item-time">${errDot}${fmtTime(l.ts)}</span><span class="log-item-dur">${fmtDur(l.duration)}</span></div>`;
      h += `<div class="log-item-model">${window.esc(modelShort(l.model))}</div>`;
      h += `<div class="log-item-toks">`;
      h += `<span class="tok-in" title="输入">\u2193${fmtTok(l.input_tokens)}</span>`;
      h += `<span class="tok-out" title="输出">\u2191${fmtTok(l.output_tokens)}</span>`;
      if (cacheHit) h += `<span class="tok-cache" title="缓存读取">\ud83d\udd16${fmtTok(l.cache_read_input_tokens)}</span>`;
      h += `<span class="log-item-msgs" title="消息数">${l.msgCount}\u6761</span>`;
      h += `</div>`;
      h += `</div>`;
    }
    el.innerHTML = h;
    el.querySelectorAll('.log-item').forEach(it => {
      it.addEventListener('click', () => {
        const ts = Number(it.dataset.ts);
        const turn = it.dataset.turn ? Number(it.dataset.turn) : null;
        this._select(ts, turn);
      });
    });
  },

  async _select(ts, turn) {
    document.getElementById('logsDetailPanel').innerHTML = '<div class="log-loading">加载日志...</div>';
    try {
      const log = await Data.fetchLog(inst(), { ts, turn });
      this._current = log;
      this._renderDetail();
      this._renderList(); // 刷新选中高亮
    } catch {
      document.getElementById('logsDetailPanel').innerHTML = '<div class="log-placeholder">加载失败</div>';
    }
  },

  _renderDetail() {
    const el = document.getElementById('logsDetailPanel');
    const log = this._current;
    if (!log) { el.innerHTML = '<div class="log-placeholder">无数据</div>'; return; }

    let req = log.request || {};
    // 兼容旧日志：早期 request.messages 误存为整个 prompt 对象 { messages, system, tools }
    if (req.messages && !Array.isArray(req.messages) && Array.isArray(req.messages.messages)) {
      const inner = req.messages;
      req = { system: req.system || inner.system, tools: req.tools || inner.tools, messages: inner.messages };
    }
    const resp = log.response || {};
    const u = resp.usage || {};

    let h = '';

    // —— 错误横幅（infer 出错时）——
    const errs = Array.isArray(resp.errors) ? resp.errors : [];
    if (errs.length) {
      h += '<div class="log-error-banner">';
      h += '<div class="log-error-title">\u26a0\ufe0f 本轮 infer 出错</div>';
      for (const e of errs) h += `<div class="log-error-msg">${window.esc(String(e))}</div>`;
      h += '</div>';
    }

    // —— 概要卡 ——
    const totalIn = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    const hitRate = totalIn > 0 ? ((u.cache_read_input_tokens || 0) / totalIn * 100).toFixed(0) + '%' : '\u2014';
    h += '<div class="log-summary">';
    h += `<div class="log-sum-head"><span class="log-sum-model">${window.esc(modelShort(resp.model))}</span><span class="log-sum-time">${fmtTime(log.ts)} \u00b7 ${fmtDur(resp.duration)}</span></div>`;
    h += '<div class="log-sum-grid">';
    h += `<div class="log-stat"><span class="log-stat-v">${fmtTok(u.input_tokens)}</span><span class="log-stat-l">输入</span></div>`;
    h += `<div class="log-stat"><span class="log-stat-v">${fmtTok(u.output_tokens)}</span><span class="log-stat-l">输出</span></div>`;
    h += `<div class="log-stat"><span class="log-stat-v">${fmtTok(u.total_tokens)}</span><span class="log-stat-l">总计</span></div>`;
    h += `<div class="log-stat cache"><span class="log-stat-v">\ud83d\udd16 ${fmtTok(u.cache_read_input_tokens)}</span><span class="log-stat-l">缓存读取</span></div>`;
    h += `<div class="log-stat cache"><span class="log-stat-v">\ud83d\udd16 ${fmtTok(u.cache_creation_input_tokens)}</span><span class="log-stat-l">缓存写入</span></div>`;
    h += `<div class="log-stat"><span class="log-stat-v">${hitRate}</span><span class="log-stat-l">缓存命中率</span></div>`;
    h += '</div>';
    if (resp.id) h += `<div class="log-sum-id">id: ${window.esc(String(resp.id))}</div>`;
    h += '</div>';

    // —— System（可折叠）——
    const sys = req.system;
    if (sys != null) {
      let sysBody = '', sysCache = '';
      if (Array.isArray(sys)) {
        for (const s of sys) {
          if (typeof s === 'string') sysBody += window.esc(s) + '\n';
          else { sysBody += window.esc(s.text || '') + '\n'; if (s.cache_control) sysCache = cacheBadge(s); }
        }
      } else { sysBody = window.esc(String(sys)); }
      h += this._foldSection('system', '\u2699\ufe0f System', sysCache, `<div class="log-text">${sysBody}</div>`, false);
    }

    // —— Tools（可折叠）——
    const tools = req.tools;
    if (Array.isArray(tools) && tools.length) {
      let tBody = '<div class="log-tools">';
      for (const t of tools) {
        const cb = cacheBadge(t);
        tBody += `<div class="log-tool-item"><span class="log-tool-name">${window.esc(t.name || '?')}</span>${cb}</div>`;
      }
      tBody += '</div>';
      h += this._foldSection('tools', `\ud83e\uddf0 Tools (${tools.length})`, '', tBody, false);
    }

    // —— Messages（核心，带序号 + 缓存徽章）——
    const msgs = Array.isArray(req.messages) ? req.messages : [];
    let mBody = '';
    msgs.forEach((m, i) => {
      const role = m.role || '?';
      // 消息级缓存徽章：扫描 content 中任意 block 的 cache_control
      let msgCache = '';
      if (Array.isArray(m.content)) {
        for (const b of m.content) if (b && b.cache_control) { msgCache = cacheBadge(b); break; }
      }
      mBody += `<div class="log-msg role-${window.esc(role)}">`;
      mBody += `<div class="log-msg-head"><span class="log-msg-num">${i + 1}</span><span class="log-msg-role">${window.esc(role)}</span>${msgCache}</div>`;
      mBody += `<div class="log-msg-body">${renderContent(m.content)}</div>`;
      mBody += `</div>`;
    });
    h += this._foldSection('messages', `\ud83d\udcac Messages (${msgs.length})`, '', mBody || '<div class="log-placeholder">无消息</div>', true);

    // —— Response 完整元数据（折叠，原样展示所有字段）——
    const respJson = `<pre class="log-json">${window.esc(JSON.stringify(resp, null, 2))}</pre>`;
    h += this._foldSection('response', '\ud83d\udce6 Response (完整元数据)', '', respJson, false);

    el.innerHTML = h;
    // 折叠交互
    el.querySelectorAll('.log-fold-head').forEach(head => {
      head.addEventListener('click', () => head.parentElement.classList.toggle('open'));
    });
  },

  _foldSection(id, title, badge, bodyHtml, openByDefault) {
    return `<div class="log-fold${openByDefault ? ' open' : ''}" data-fold="${id}">`
      + `<div class="log-fold-head"><span class="log-fold-arrow">\u25b8</span><span class="log-fold-title">${title}</span>${badge}</div>`
      + `<div class="log-fold-body">${bodyHtml}</div>`
      + `</div>`;
  }
};
