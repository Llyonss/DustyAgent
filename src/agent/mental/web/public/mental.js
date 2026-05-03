// === Mental Content Viewer/Editor ===
const Mental = {
  editMode: null,
  cache: {},

  async select(name) {
    App.currentMental = name;
    App.closeSidebar();

    // Show content view, hide graph and story
    document.getElementById('graphView').classList.add('hidden');
    document.getElementById('contentView').classList.remove('hidden');
    document.getElementById('storyView').classList.add('hidden');
    this.cancelEdit();
    Graph.highlight(name);
    // Update mobile title
    const mt = document.querySelector('.mental-mobile-title');
    if (mt) mt.textContent = name === 'self' ? '◆ self' : name;

    if (name === 'self') {
      const data = await (await fetch('/api/instance?name=' + encodeURIComponent(App.instance))).json();
      document.getElementById('contentName').textContent = 'self';
      document.getElementById('contentBody').innerHTML = '';
      document.getElementById('contentLinks').innerHTML = '';
      document.getElementById('contentScroll').style.display = '';
      document.getElementById('editArea').classList.add('hidden');
      document.getElementById('messagePreview').classList.add('hidden');
      // Show system prompt section
      const section = document.getElementById('systemPromptSection');
      const body = document.getElementById('systemPromptBody');
      body.textContent = data.systemMd || '(空)';
      section.classList.remove('hidden');
      // Show ENV info below system prompt
      const envEl = document.getElementById('systemEnvInfo');
      if (envEl) envEl.textContent = data.env || '';
      // Show tools section
      this.loadTools();
      return;
    }

    // Hide system prompt & tools when viewing non-self
    document.getElementById('systemPromptSection').classList.add('hidden');
    document.getElementById('toolsSection').classList.add('hidden');

    try {
      const data = await (await fetch('/api/room?name=' + encodeURIComponent(name))).json();
      this.cache[name] = data;
      this.renderContent(name, data.content, data.links);
    } catch {
      document.getElementById('contentName').textContent = name;
      document.getElementById('contentBody').innerHTML = '<div class="empty">心智不存在</div>';
      document.getElementById('contentLinks').innerHTML = '';
    }
  },



  renderContent(name, content, links) {
    document.getElementById('contentName').textContent = name;
    document.getElementById('contentBody').innerHTML = md(content);
    document.getElementById('contentScroll').style.display = '';
    document.getElementById('editArea').classList.add('hidden');
    document.getElementById('messagePreview').classList.add('hidden');

    let html = '';
    if (links) {
      const parsed = links.split('\n').filter(l => l.trim()).map(l => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
      if (parsed.length) {
        html += '<div class="links-section">';
        html += parsed.map(link => {
          const cls = link.parent ? 'link-item link-parent' : 'link-item';
          const prefix = link.parent ? '▴ ' : '· ';
          return `<div class="${cls}" onclick="Mental.select('${esc(link.name)}')">${prefix}${esc(link.name)}<span class="link-tag">${esc(link.summary || '')}</span></div>`;
        }).join('');
        html += '</div>';
      }
    }
    document.getElementById('contentLinks').innerHTML = html;
  },

  showGraph() {
    App.currentMental = null;
    App.closeSidebar();
    document.getElementById('graphView').classList.remove('hidden');
    document.getElementById('contentView').classList.add('hidden');
    document.getElementById('storyView').classList.add('hidden');
    Graph.highlight(null);
    Graph.render();
    const mt = document.querySelector('.mental-mobile-title');
    if (mt) mt.textContent = '心智图谱';
  },

  // Show stories related to current mental
  async showMentalStories() {
    const name = App.currentMental;
    if (!name) return;
    document.getElementById('graphView').classList.add('hidden');
    document.getElementById('contentView').classList.add('hidden');
    document.getElementById('storyView').classList.remove('hidden');
    document.getElementById('storyTitle').textContent = `📜 ${name} 的故事`;

    const stories = await (await fetch('/api/mental-stories?name=' + encodeURIComponent(name))).json();
    if (!stories.length) {
      document.getElementById('storyBody').innerHTML = '<div class="empty">暂无相关故事</div>';
      document.getElementById('storyEvents').innerHTML = '';
      return;
    }
    document.getElementById('storyBody').innerHTML = stories.map(s =>
      `<div class="story-card" onclick="Mental.showStory('${esc(s.instance)}',${s.index})">` +
      `<div class="story-card-title"><span class="story-num">v${s.index}</span> ${esc(s.title)} <span class="story-instance">[${esc(s.instance)}]</span></div>` +
      `<div class="story-card-body">${esc(s.story.substring(0, 200))}${s.story.length > 200 ? '...' : ''}</div>` +
      (Array.isArray(s.entities) && s.entities.length ? `<div class="story-card-entities">${s.entities.map(e => `<span onclick="event.stopPropagation();Mental.select('${esc(e)}')">${esc(e)}</span>`).join(' ')}</div>` : '') +
      `</div>`
    ).join('');
    document.getElementById('storyEvents').innerHTML = '';
  },

  // Show a specific story with events
  async showStory(instance, index) {
    App.closeSidebar();
    document.getElementById('graphView').classList.add('hidden');
    document.getElementById('contentView').classList.add('hidden');
    document.getElementById('storyView').classList.remove('hidden');

    // Load story info from history
    const hist = await (await fetch('/api/history?instance=' + encodeURIComponent(instance))).json();
    const story = hist[index - 1];
    const titleText = story ? `📜 v${index}: ${story.title}` : `📜 v${index}`;
    document.getElementById('storyTitle').textContent = titleText;
    const mt = document.querySelector('.mental-mobile-title');
    if (mt) mt.textContent = titleText;

    let bodyHtml = '';
    if (story) {
      bodyHtml += `<div class="story-detail-story">${md(story.story || '')}</div>`;
      if (Array.isArray(story.entities) && story.entities.length) {
        bodyHtml += `<div class="story-card-entities">${story.entities.map(e => `<span onclick="Mental.select('${esc(e)}')">${esc(e)}</span>`).join(' ')}</div>`;
      }
    }
    document.getElementById('storyBody').innerHTML = bodyHtml;

    // Load events for this commit interval
    const events = await (await fetch(`/api/story-events?instance=${encodeURIComponent(instance)}&index=${index}`)).json();
    if (!events.length) {
      document.getElementById('storyEvents').innerHTML = '<div class="empty" style="padding:12px">无事件记录</div>';
      return;
    }
    document.getElementById('storyEvents').innerHTML = '<div class="story-events-title">事件记录</div>' + this.renderEvents(events);
  },

  // Render events (uses Chat's tool rendering)
  renderEvents(events) {
    let html = '';
    for (const e of events) {
      if (e.type === 'user') {
        html += `<div class="msg-user">${esc(e.content)}</div>`;
      } else if (e.type === 'assistant') {
        html += `<div class="msg-ai">${md(e.content)}</div>`;
      } else if (e.type === 'action') {
        if (e.tool === 'think' || e.tool === 'thinking') {
          const thinkContent = e.tool === 'thinking' ? (e.output || '') : (e.input?.content || '');
          const thinkLabel = e.tool === 'thinking' ? '💭 深度思考' : '💭 思考';
          html += `<div class="msg-think"><div class="think-label">${thinkLabel}</div>${md(thinkContent)}</div>`;
        } else if (e.tool === 'commit') {
          html += `<div class="msg-commit">┄┄ 🧠 ${esc(e.input?.title || 'commit')} ┄┄</div>`;
        } else if (e.tool === 'speak') {
          html += `<div class="msg-ai">${md(typeof e.output === 'string' ? e.output : '')}</div>`;
        } else {
          html += `<div class="msg-tool">${Chat.toolSummary(e)}</div>`;
          html += `<div class="msg-tool-detail open">${Chat.renderToolDetail(e)}</div>`;
        }
      } else if (e.type === 'error') {
        html += `<div class="msg-error"><span>❌ ${esc(e.error || '')}</span></div>`;
      }
    }
    return html;
  },

  toggleStoryTool(uid) {
    const el = document.getElementById(uid);
    if (el) el.classList.toggle('open');
  },

  edit(mode) {
    if (!App.currentMental && mode !== 'system') return;
    if (App.currentMental === 'self' && mode !== 'system') return;

    // Links mode: use tag editor instead of textarea
    if (mode === 'links') {
      this.editLinks();
      return;
    }

    this.editMode = mode;
    const ta = document.getElementById('editTextarea');
    const labels = { content: '编辑内容', system: '编辑 System Prompt' };
    document.getElementById('editLabel').textContent = labels[mode] || '编辑内容';

    if (mode === 'system') {
      fetch('/api/instance?name=' + encodeURIComponent(App.instance)).then(r => r.json()).then(d => {
        ta.value = d.systemMd || '';
      });
    } else {
      const data = this.cache[App.currentMental];
      ta.value = data?.content || '';
    }
    document.getElementById('contentScroll').style.display = 'none';
    document.getElementById('editArea').classList.remove('hidden');
    ta.focus();
  },

  // --- Link tag editor ---
  _linksEditing: null,

  async editLinks() {
    if (App.currentMental === 'self') return;
    let linksText = '';
    const data = this.cache[App.currentMental];
    linksText = data?.links || '';
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
    const ta = document.getElementById('editTextarea');
    ta.style.display = 'none';
    document.getElementById('editLabel').textContent = '编辑链接';
    this.editMode = 'links-tags';

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
        `<span class="link-tag-name">${esc(link.name)}</span>` +
        (link.summary ? `<span class="link-tag-summary">${esc(link.summary)}</span>` : '') +
        `<button class="link-tag-remove" onclick="Mental.removeLinkTag(${i})">×</button>` +
        `</div>`;
    });
    html += '</div>';
    html += '<div class="link-tag-add">' +
      '<input id="linkTagName" placeholder="心智名" class="link-tag-input">' +
      '<input id="linkTagSummary" placeholder="摘要" class="link-tag-input link-tag-input-wide">' +
      '<label class="link-tag-parent-label"><input type="checkbox" id="linkTagParent"> parent</label>' +
      '<button class="btn btn-small" onclick="Mental.addLinkTag()">添加</button>' +
      '</div>';
    el.innerHTML = html;

    // Enter key to add
    setTimeout(() => {
      const nameInput = document.getElementById('linkTagName');
      if (nameInput) nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') Mental.addLinkTag(); });
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
    document.getElementById('linkTagName').value = '';
    document.getElementById('linkTagSummary').value = '';
    document.getElementById('linkTagParent').checked = false;
    document.getElementById('linkTagName').focus();
  },

  removeLinkTag(idx) {
    this._linksEditing.splice(idx, 1);
    this._renderLinkTags();
  },

  cancelEdit() {
    this.editMode = null;
    this._linksEditing = null;
    document.getElementById('editArea').classList.add('hidden');
    document.getElementById('contentScroll').style.display = '';
    // Cleanup link tag editor
    const el = document.getElementById('linkTagEditor');
    if (el) el.style.display = 'none';
    document.getElementById('editTextarea').style.display = '';
  },

  // --- Tools ---
  toolsData: null,

  async loadTools() {
    const data = await (await fetch('/api/tools?instance=' + encodeURIComponent(App.instance))).json();
    this.toolsData = data;
    const section = document.getElementById('toolsSection');
    const list = document.getElementById('toolsList');
    section.classList.remove('hidden');

    const disabledSet = new Set(data.config.disabled || []);
    const customNames = new Set(data.custom.map(c => c.name));
    let html = '';
    let idx = 0;

    // Render builtins
    for (const t of data.builtins) {
      const off = disabledSet.has(t.name);
      const replaced = customNames.has(t.name);
      if (replaced) continue; // will show in custom section
      const cls = off ? 'tool-item disabled' : 'tool-item';
      const tog = off ? '✗' : '✓';
      const desc = (data.config.overrides?.[t.name]?.description || t.description || '').substring(0, 60);
      html += `<div class="${cls}" onclick="Mental.toggleToolDetail('td${idx}')">`;
      html += `<span class="tool-toggle" onclick="event.stopPropagation();Mental.toggleTool('${esc(t.name)}')">${tog}</span>`;
      html += `<span class="tool-name">${esc(t.name)}</span>`;
      html += `<span class="tool-desc">${esc(desc)}</span>`;
      html += `<span class="tool-actions"><button class="btn-icon btn-small" onclick="event.stopPropagation();Mental.editToolDesc('${esc(t.name)}')" title="编辑描述">✏️</button></span>`;
      html += `</div>`;
      const detail = data.config.overrides?.[t.name]?.description || t.description || '';
      html += `<div class="tool-detail" id="td${idx}">${esc(detail)}</div>`;
      idx++;
    }

    // Render custom tools
    for (const t of data.custom) {
      const off = disabledSet.has(t.name);
      const cls = off ? 'tool-item disabled' : 'tool-item';
      const tog = off ? '✗' : '✓';
      const desc = (t.description || '').substring(0, 60);
      html += `<div class="${cls}" onclick="Mental.toggleToolDetail('td${idx}')">`;
      html += `<span class="tool-toggle" onclick="event.stopPropagation();Mental.toggleTool('${esc(t.name)}')">${tog}</span>`;
      html += `<span class="tool-name custom">${esc(t.name)}</span>`;
      html += `<span class="tool-desc">${esc(desc)}</span>`;
      html += `<span class="tool-actions"><button class="btn-icon btn-small" onclick="event.stopPropagation();Mental.editToolCode('${esc(t.file)}')" title="编辑代码">✏️</button></span>`;
      html += `</div>`;
      html += `<div class="tool-detail" id="td${idx}">${esc(t.description || '')}</div>`;
      idx++;
    }

    list.innerHTML = html || '<div style="padding:8px 10px;color:#555;font-size:12px">(无工具)</div>';
  },

  togglePanel(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('collapsed');
    // Update arrow in header
    const header = el.previousElementSibling;
    if (header) {
      const label = header.querySelector('.system-prompt-label, .tools-label');
      if (label) label.textContent = label.textContent.replace(/^[▸▾]/, el.classList.contains('collapsed') ? '▸' : '▾');
    }
  },

  toggleToolDetail(id) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('open');
  },

  async toggleTool(name) {
    if (!this.toolsData) return;
    const config = this.toolsData.config;
    const disabled = new Set(config.disabled || []);
    if (disabled.has(name)) disabled.delete(name); else disabled.add(name);
    config.disabled = [...disabled];
    await fetch('/api/self-save', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instance: App.instance, suffix: 'tools.json', content: JSON.stringify(config, null, 2) }) });
    this.loadTools();
  },

  editToolDesc(name) {
    if (!this.toolsData) return;
    this.editMode = 'tool-desc';
    this._editToolName = name;
    const ta = document.getElementById('editTextarea');
    document.getElementById('editLabel').textContent = `编辑 ${name} 描述`;
    // Show override or original
    const override = this.toolsData.config.overrides?.[name]?.description;
    const builtin = this.toolsData.builtins.find(t => t.name === name);
    ta.value = override ?? builtin?.description ?? '';
    document.getElementById('contentScroll').style.display = 'none';
    document.getElementById('editArea').classList.remove('hidden');
    ta.focus();
  },

  editToolCode(file) {
    if (!this.toolsData) return;
    this.editMode = 'tool-code';
    this._editToolFile = file;
    const ta = document.getElementById('editTextarea');
    const tool = this.toolsData.custom.find(t => t.file === file);
    document.getElementById('editLabel').textContent = `编辑 ${file}`;
    ta.value = tool?.code || '';
    document.getElementById('contentScroll').style.display = 'none';
    document.getElementById('editArea').classList.remove('hidden');
    ta.focus();
  },

  async newTool() {
    const name = prompt('工具名称（英文）：');
    if (!name || !name.match(/^[a-zA-Z_]\w*$/)) return;
    const template = `module.exports = {
  name: '${name}',
  description: '描述这个工具的功能',
  input_schema: {
    type: 'object',
    properties: {
      input: { type: 'string', description: '输入参数' },
    },
  },
  execute: async (input, ctrl, eventsDir) => {
    return 'result';
  },
};
`;
    await fetch('/api/self-save', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instance: App.instance, suffix: `tools/${name}.js`, content: template }) });
    this.loadTools();
  },

  async saveEdit() {
    if (!this.editMode) return;

    // Link tags mode: convert tags to JSONL and save
    if (this.editMode === 'links-tags') {
      const links = this._linksEditing || [];
      const jsonl = links.map(l => JSON.stringify(l)).join('\n');
      await fetch('/api/room-save', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: App.currentMental, suffix: '.links', content: jsonl }) });
      this.cancelEdit();
      Graph.load(); Tree.load();
      this.select(App.currentMental || 'self');
      return;
    }

    const content = document.getElementById('editTextarea').value;
    if (this.editMode === 'tool-desc') {
      // Save description override to tools.json
      const config = this.toolsData?.config || { disabled: [], overrides: {} };
      if (!config.overrides) config.overrides = {};
      if (content === (this.toolsData.builtins.find(t => t.name === this._editToolName)?.description ?? '')) {
        delete config.overrides[this._editToolName];
      } else {
        config.overrides[this._editToolName] = { description: content };
      }
      await fetch('/api/self-save', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instance: App.instance, suffix: 'tools.json', content: JSON.stringify(config, null, 2) }) });
    } else if (this.editMode === 'tool-code') {
      await fetch('/api/self-save', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instance: App.instance, suffix: `tools/${this._editToolFile}`, content }) });
    } else if (this.editMode === 'system') {
      await fetch('/api/self-save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instance: App.instance, suffix: 'system.md', content }) });
    } else {
      await fetch('/api/room-save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: App.currentMental, suffix: '.md', content }) });
    }
    this.cancelEdit();
    // Reload graph + tree after edit
    Graph.load();
    Tree.load();
    this.select(App.currentMental || 'self');
  },
};

document.getElementById('editTextarea').addEventListener('keydown', e => {
  if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); Mental.saveEdit(); }
  if (e.key === 'Escape') Mental.cancelEdit();
  if (e.key === 'Tab') { e.preventDefault(); const ta = e.target, s = ta.selectionStart; ta.value = ta.value.substring(0, s) + '  ' + ta.value.substring(ta.selectionEnd); ta.selectionStart = ta.selectionEnd = s + 2; }
});
