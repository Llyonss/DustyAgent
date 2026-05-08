const Panel = {
  active: null,       // currently shown instance name
  panels: new Map(),  // instanceName -> { el, pollInterval }
  anchors: new Map(), // instanceName -> { mental, select }

  async create(mental, select) {
    // Create conversation instance
    const resp = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mental, select })
    });
    const { instance } = await resp.json();

    this.anchors.set(instance, { mental, select });
    this._buildPanel(instance, mental, select);
    this._startPoll(instance);
    this.show(instance);
  },

  _buildPanel(instance, mental, select) {
    const layer = document.getElementById('panel-layer');

    const el = document.createElement('div');
    el.className = 'conv-panel';
    el.id = 'panel-' + instance;
    el.innerHTML = `
      <div class="conv-header">
        <span>💬 ${mental}${select ? ' · "' + select + '"' : ''}</span>
        <button class="conv-close">×</button>
      </div>
      <div class="conv-messages" id="msgs-${instance}">
        <div class="msg-placeholder">-- 对话已开始 --</div>
      </div>
      <div class="conv-input">
        <input type="text" id="input-${instance}" placeholder="说点什么..." autocomplete="off">
        <button id="send-${instance}">发</button>
      </div>
    `;

    // Close
    el.querySelector('.conv-close').onclick = () => this._close(instance);

    // Send
    const send = () => {
      const input = document.getElementById('input-' + instance);
      const content = input.value.trim();
      if (!content) return;
      input.value = '';

      // Get current selection in card
      const sel = window.getSelection();
      const selectText = sel && sel.rangeCount > 0 ? sel.toString() : null;
      const anchorMental = this.anchors.get(instance)?.mental || mental;

      fetch(`/api/conversations/${instance}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, anchor: { mental: anchorMental, select: selectText } })
      });
    };

    document.getElementById('send-' + instance).onclick = send;
    document.getElementById('input-' + instance).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') send();
    });

    layer.appendChild(el);
    this.panels.set(instance, { el });
  },

  show(instance) {
    // Hide previous
    if (this.active) {
      const prev = this.panels.get(this.active);
      if (prev) prev.el.classList.remove('active');
    }
    // Show new
    const panel = this.panels.get(instance);
    if (panel) panel.el.classList.add('active');
    this.active = instance;
  },

  _startPoll(instance) {
    const poll = setInterval(async () => {
      try {
        const data = await fetch(`/api/conversations/${instance}/events`).then(r => r.json());
        this._renderMessages(instance, data.events);
      } catch {}
    }, 500);
    const panel = this.panels.get(instance);
    if (panel) panel.pollInterval = poll;
  },

  _renderMessages(instance, events) {
    const el = document.getElementById('msgs-' + instance);
    if (!el || !events.length) return;

    let html = '';
    for (const e of events) {
      if (e.type === 'user') {
        const anchor = e.anchor || {};
        html += `<div class="msg msg-user">${this._escape(e.content)}`;
        if (anchor.mental) {
          html += `<div class="msg-anchor">📌 @${anchor.mental}${anchor.select ? ' "' + anchor.select + '"' : ''}</div>`;
        }
        html += `</div>`;
      } else if (e.type === 'action') {
        if (e.tool === 'speak') {
          html += `<div class="msg msg-ai">${this._renderMd(e.output || '')}</div>`;
        } else if (e.tool === 'think') {
          const text = typeof e.input === 'object' ? (e.input.content || '') : (e.input || '');
          html += `<div class="msg msg-think">💭 ${this._escape(text.slice(0, 120))}${text.length > 120 ? '...' : ''}</div>`;
        } else if (e.tool === 'commit') {
          html += `<div class="msg msg-commit">── 🧠 ${this._escape(e.output || '')} ──</div>`;
        } else if (e.error) {
          html += `<div class="msg msg-error">⚠️ ${this._escape(e.error)}</div>`;
        } else {
          html += `<div class="msg msg-tool">🔧 ${e.tool} ${e.ok ? '✓' : '✗'}</div>`;
        }
      }
    }
    el.innerHTML = html || '<div class="msg-placeholder">-- 对话已开始 --</div>';
    el.scrollTop = el.scrollHeight;
  },

  _close(instance) {
    clearInterval(this.panels.get(instance)?.pollInterval);
    fetch(`/api/conversations/${instance}/loop`, { method: 'DELETE' }).catch(() => {});
    this.panels.get(instance)?.el.remove();
    this.panels.delete(instance);
    this.anchors.delete(instance);
    if (this.active === instance) this.active = null;
  },

  _escape(s) {
    if (!s) return '';
    return String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },

  _renderMd(md) {
    if (!md) return '';
    return md
      .replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/^### (.+)$/gm, '<h4>$1</h4>')
      .replace(/^## (.+)$/gm, '<h3>$1</h3>')
      .replace(/^# (.+)$/gm, '<h2>$1</h2>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }
};
