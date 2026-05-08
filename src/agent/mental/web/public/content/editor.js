// === 统一编辑态 ===
// 职责：提供编辑态UI机制（textarea替换+tag编辑器+快捷键+保存/取消）

export const Editor = {
  mode: null,        // 'text' | 'links' | null
  onSave: null,
  onAfterSave: null,
  _linksEditing: null,

  // —— 文本编辑 ——

  enter({ initialValue, label, onSave, onAfterSave }) {
    this.mode = 'text';
    this.onSave = onSave;
    this.onAfterSave = onAfterSave;
    this._linksEditing = null;

    document.getElementById('contentScroll').style.display = 'none';
    document.getElementById('editArea').classList.remove('hidden');
    const ta = document.getElementById('editTextarea');
    ta.style.display = '';
    ta.value = initialValue;
    document.getElementById('editLabel').textContent = label;

    // 清理link tag编辑器
    const el = document.getElementById('linkTagEditor');
    if (el) el.style.display = 'none';

    ta.focus();
  },

  // —— 链接tag编辑 ——

  enterLinks(linksText, onSave, onAfterSave) {
    this.mode = 'links';
    this.onSave = onSave;
    this.onAfterSave = onAfterSave;

    const parsed = linksText.split('\n').filter(l => l.trim()).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
    this._linksEditing = parsed;
    this._renderLinkTags();
  },

  _renderLinkTags() {
    const links = this._linksEditing || [];
    document.getElementById('contentScroll').style.display = 'none';
    document.getElementById('editArea').classList.remove('hidden');
    document.getElementById('editLabel').textContent = '编辑链接';
    const ta = document.getElementById('editTextarea');
    ta.style.display = 'none';

    let el = document.getElementById('linkTagEditor');
    if (!el) {
      el = document.createElement('div');
      el.id = 'linkTagEditor';
      ta.parentElement.insertBefore(el, ta);
    }
    el.style.display = '';

    let html = '<div class="link-tags-list">';
    links.forEach((link, i) => {
      const cls = link.parent ? 'link-tag-item link-tag-parent' : 'link-tag-item';
      html += `<div class="${cls}">` +
        (link.parent ? '<span class="link-tag-badge">▴ parent</span>' : '') +
        `<span class="link-tag-name">${window.esc(link.name)}</span>` +
        (link.summary ? `<span class="link-tag-summary">${window.esc(link.summary)}</span>` : '') +
        `<button class="link-tag-remove" onclick="window._editorRemoveTag(${i})">×</button>` +
        `</div>`;
    });
    html += '</div>';
    html += '<div class="link-tag-add">' +
      '<input id="linkTagName" placeholder="心智名" class="link-tag-input">' +
      '<input id="linkTagSummary" placeholder="摘要" class="link-tag-input link-tag-input-wide">' +
      '<label class="link-tag-parent-label"><input type="checkbox" id="linkTagParent"> parent</label>' +
      '<button class="btn btn-small" onclick="window._editorAddTag()">添加</button>' +
      '</div>';
    el.innerHTML = html;

    setTimeout(() => {
      const nameInput = document.getElementById('linkTagName');
      if (nameInput) nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') window._editorAddTag(); });
    }, 0);
  },

  addLinkTag() {
    const name = document.getElementById('linkTagName')?.value?.trim();
    if (!name) return;
    const summary = document.getElementById('linkTagSummary')?.value?.trim() || '';
    const parent = document.getElementById('linkTagParent')?.checked || false;
    const link = { name, summary };
    if (parent) link.parent = true;
    this._linksEditing.push(link);
    this._renderLinkTags();
  },

  removeLinkTag(idx) {
    this._linksEditing.splice(idx, 1);
    this._renderLinkTags();
  },

  // —— 保存/取消 ——

  async save() {
    if (!this.mode) return;

    if (this.mode === 'links') {
      const jsonl = this._linksEditing.map(l => JSON.stringify(l)).join('\n');
      if (this.onSave) await this.onSave(jsonl);
    } else {
      const content = document.getElementById('editTextarea').value;
      if (this.onSave) await this.onSave(content);
    }

    this.reset();
    if (this.onAfterSave) await this.onAfterSave();
  },

  cancel() {
    if (this.mode === 'links' && this._linksEditing) {
      // 放弃链接编辑的修改
    }
    this.reset();
  },

  reset() {
    this.mode = null;
    this.onSave = null;
    this.onAfterSave = null;
    this._linksEditing = null;
    document.getElementById('editArea').classList.add('hidden');
    document.getElementById('contentScroll').style.display = '';
    const el = document.getElementById('linkTagEditor');
    if (el) el.style.display = 'none';
    document.getElementById('editTextarea').style.display = '';
  }
};

// 全局回调
window._editorAddTag = () => Editor.addLinkTag();
window._editorRemoveTag = (idx) => Editor.removeLinkTag(idx);
