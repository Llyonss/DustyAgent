// === Self 页面 ===
// 管理实例/项目对话的 system prompt、model、tools
// 通过 Source.current 统一适配旧实例和项目对话

import { Data } from '../data.js';
import { Source } from '../source.js';

function src() { return Source.get(); }

// 统一 fetch/self/save 适配器（分组对话即普通实例，统一走实例 API）
let agentName = null;
const SelfAPI = {
  fetchSelf: () => agentName ? Data.fetchAgentConfig(agentName) : Data.fetchSelf(src().id),
  fetchModel: () => agentName ? Data.fetchAgentModel(agentName) : Data.fetchModel(src().id),
  fetchModelPresets: () => agentName ? Data.fetchAgentModelPresets(agentName) : Data.fetchModelPresets(src().id),
  saveModel: (config, preset) => agentName ? Data.saveAgentModel(agentName, config, preset) : Data.saveModel(src().id, config, preset),
  fetchTools: () => agentName ? Data.fetchAgentTools(agentName) : Data.fetchTools(src().id),
  saveSelf: (suffix, content) => agentName ? Data.saveAgentFile(agentName, suffix, content) : Data.saveSelf(src().id, suffix, content),
};

export const Self = {
  modelData: null,

  async view() {
    agentName = null;
    return this._view();
  },

  async viewAgent(name) {
    agentName = name;
    return this._view();
  },

  async _view() {
    const data = await SelfAPI.fetchSelf();
    document.getElementById('configModalTitle').textContent = agentName ? `🤖 ${agentName} 配置` : '⚙️ 对话配置';
    document.getElementById('modelSection').classList.remove('hidden');
    document.getElementById('systemPromptSection').classList.remove('hidden');
    document.getElementById('systemPromptBody').textContent = data.systemMd || '(空)';
    document.getElementById('systemEnvInfo').textContent = data.env || '';
    const agentSection = document.getElementById('agentFilesSection');
    if (agentName) {
      agentSection.classList.remove('hidden');
      document.getElementById('agentWikiBody').textContent = data.wiki || '(空)';
      document.getElementById('agentListenBody').textContent = data.listen || '(空)';
    } else agentSection.classList.add('hidden');
    document.getElementById('configModal').classList.remove('hidden');
    this.loadModel();
    this.loadTools();
  },

  _fileSave: null,
  openFileEditor({ value, label, onSave }) {
    this._fileSave = onSave;
    document.getElementById('configSections').classList.add('hidden');
    document.getElementById('configFileEditor').classList.remove('hidden');
    document.getElementById('configFileEditorTitle').textContent = label;
    const ta = document.getElementById('configFileEditorText'); ta.value = value || ''; ta.focus();
  },
  async saveFileEditor() {
    if (this._fileSave) await this._fileSave(document.getElementById('configFileEditorText').value);
    this.closeFileEditor();
    if (agentName) await this.viewAgent(agentName); else await this.view();
  },
  closeFileEditor() {
    this._fileSave = null;
    document.getElementById('configFileEditor').classList.add('hidden');
    document.getElementById('configSections').classList.remove('hidden');
  },
  editAgentFile(suffix) {
    if (!agentName) return;
    SelfAPI.fetchSelf().then(data => {
      const key = suffix === 'wiki.md' ? 'wiki' : 'listen';
      this.openFileEditor({ value: data[key], label: `编辑 ${agentName} / ${suffix}`, onSave: value => SelfAPI.saveSelf(suffix, value) });
    });
  },

  // —— Model ——
  async loadModel() {
    const config = await SelfAPI.fetchModel();
    const presetsData = await SelfAPI.fetchModelPresets();
    this.modelData = config;
    const body = document.getElementById('modelBody');

    let presetHtml = '';
    const presets = presetsData.presets || {};
    const current = presetsData.current;
    const names = Object.keys(presets);
    if (names.length) {
      presetHtml = '<div class="model-presets">';
      for (const name of names) {
        const p = presets[name];
        const sel = name === current ? ' selected' : '';
        const label = (p.provider || '') + ' · ' + (p.model || '').replace('anthropic/', '');
        presetHtml += `<div class="model-preset-item${sel}" data-preset="${window.esc(name)}" onclick="window._selfSelectPreset('${window.esc(name)}')">` +
          `<span class="preset-dot">${sel ? '◆' : '◇'}</span>` +
          `<span class="preset-name">${window.esc(name)}</span>` +
          `<span class="preset-label">${window.esc(label)}</span>` +
          `</div>`;
      }
      presetHtml += '</div>';
    }

    const mask = (s) => s ? s.substring(0, 6) + '...' + s.substring(s.length - 4) : '';
    const hasConfig = config && (config.provider || config.model || config.baseUrl || config.apiKey);

    if (!hasConfig && !current) {
      body.innerHTML = presetHtml + '<div class="model-info">(使用全局 .env 配置)</div>';
    } else if (!hasConfig && current) {
      body.innerHTML = presetHtml;
    } else {
      body.innerHTML = presetHtml + `<div class="model-info">` +
        (config.provider ? `<div><span class="model-field">provider:</span> ${window.esc(config.provider)}</div>` : '') +
        (config.model ? `<div><span class="model-field">model:</span> ${window.esc(config.model)}</div>` : '') +
        (config.baseUrl ? `<div><span class="model-field">baseUrl:</span> ${window.esc(config.baseUrl)}</div>` : '') +
        (config.apiKey ? `<div><span class="model-field">apiKey:</span> ${window.esc(mask(config.apiKey))}</div>` : '') +
        `</div>`;
    }
  },

  async selectPreset(name) {
    await SelfAPI.saveModel(null, name);
    this.loadModel();
  },

  toggleModel() {
    const body = document.getElementById('modelBody');
    const label = document.querySelector('.model-label');
    body.classList.toggle('collapsed');
    label.textContent = label.textContent.replace(/^[▸▾]/, body.classList.contains('collapsed') ? '▸' : '▾');
  },

  editModel() {
    const config = this.modelData || {};
    document.getElementById('modelProvider').value = config.provider || '';
    document.getElementById('modelModel').value = config.model || '';
    document.getElementById('modelBaseUrl').value = config.baseUrl || '';
    document.getElementById('modelApiKey').value = config.apiKey || '';
    document.getElementById('modelEditForm').classList.remove('hidden');
    const body = document.getElementById('modelBody');
    const label = document.querySelector('.model-label');
    if (body.classList.contains('collapsed')) {
      body.classList.remove('collapsed');
      label.textContent = label.textContent.replace(/^[▸▾]/, '▾');
    }
  },

  async saveModel() {
    const config = {};
    const provider = document.getElementById('modelProvider').value.trim();
    const model = document.getElementById('modelModel').value.trim();
    const baseUrl = document.getElementById('modelBaseUrl').value.trim();
    const apiKey = document.getElementById('modelApiKey').value.trim();
    if (provider) config.provider = provider;
    if (model) config.model = model;
    if (baseUrl) config.baseUrl = baseUrl;
    if (apiKey) config.apiKey = apiKey;
    await SelfAPI.saveModel(config);
    document.getElementById('modelEditForm').classList.add('hidden');
    await this.loadModel();
  },

  cancelModel() {
    document.getElementById('modelEditForm').classList.add('hidden');
  },

  toggleSystemPrompt() {
    const body = document.getElementById('systemPromptBody');
    const label = document.querySelector('.system-prompt-label');
    body.classList.toggle('collapsed');
    label.textContent = label.textContent.replace(/^[▸▾]/, body.classList.contains('collapsed') ? '▸' : '▾');
  },

  editSystem() {
    SelfAPI.fetchSelf().then(data => {
      this.openFileEditor({
        value: data.systemMd || '',
        label: '编辑 System Prompt',
        onSave: value => SelfAPI.saveSelf('system.md', value),
      });
    });
  },

  // —— Tools ——
  toolsData: null,

  async loadTools() {
    const data = await SelfAPI.fetchTools();
    this.toolsData = data;
    const section = document.getElementById('toolsSection');
    const list = document.getElementById('toolsList');
    section.classList.remove('hidden');

    const disabledSet = new Set(data.config.disabled || []);
    const customNames = new Set(data.custom.map(c => c.name));
    let html = '';
    let idx = 0;

    for (const t of data.builtins) {
      if (customNames.has(t.name)) continue;
      const off = disabledSet.has(t.name);
      const desc = (data.config.overrides?.[t.name]?.description || t.description || '').substring(0, 60);
      html += toolItemHtml(t.name, desc, off, false, idx);
      html += `<div class="tool-detail" id="td${idx}">${window.esc(data.config.overrides?.[t.name]?.description || t.description || '')}</div>`;
      idx++;
    }
    for (const t of data.custom) {
      const off = disabledSet.has(t.name);
      const desc = (t.description || '').substring(0, 60);
      html += toolItemHtml(t.name, desc, off, true, idx, t.file);
      html += `<div class="tool-detail" id="td${idx}">${window.esc(t.description || '')}</div>`;
      idx++;
    }

    list.innerHTML = html || '<div style="padding:8px 10px;color:#555;font-size:12px">(无工具)</div>';
    bindToolEvents();
  },

  async toggleTool(name) {
    if (!this.toolsData) return;
    const config = this.toolsData.config;
    const disabled = new Set(config.disabled || []);
    if (disabled.has(name)) disabled.delete(name); else disabled.add(name);
    config.disabled = [...disabled];
    await SelfAPI.saveSelf('tools.json', JSON.stringify(config, null, 2));
    this.loadTools();
  },

  editToolDesc(name) {
    if (!this.toolsData) return;
    const override = this.toolsData.config.overrides?.[name]?.description;
    const builtin = this.toolsData.builtins.find(t => t.name === name);
    const initialValue = override ?? builtin?.description ?? '';
    this.openFileEditor({
      value: initialValue,
      label: `编辑 ${name} 描述`,
      onSave: async (value) => {
        const config = this.toolsData.config || { disabled: [], overrides: {} };
        if (!config.overrides) config.overrides = {};
        if (value === (builtin?.description ?? '')) {
          delete config.overrides[name];
        } else {
          config.overrides[name] = { description: value };
        }
        await SelfAPI.saveSelf('tools.json', JSON.stringify(config, null, 2));
      }
    });
  },

  editToolCode(file) {
    if (!this.toolsData) return;
    const tool = this.toolsData.custom.find(t => t.file === file);
    this.openFileEditor({
      value: tool?.code || '',
      label: `编辑 ${file}`,
      onSave: value => SelfAPI.saveSelf(`tools/${file}`, value),
    });
  },

  toggleTools() {
    const list = document.getElementById('toolsList');
    const label = document.querySelector('.tools-label');
    list.classList.toggle('collapsed');
    label.textContent = label.textContent.replace(/^[▸▾]/, list.classList.contains('collapsed') ? '▸' : '▾');
  },

  async newTool() {
    const name = prompt('工具名称（英文）:');
    if (!name || !name.match(/^[a-zA-Z_]\w*$/)) return;
    const template = `module.exports = {\n  name: '${name}',\n  description: '描述这个工具的功能',\n  input_schema: {\n    type: 'object',\n    properties: {\n      input: { type: 'string', description: '输入参数' },\n    },\n  },\n  execute: async (input, ctrl, eventsDir) => {\n    return 'result';\n  },\n};\n`;
    await SelfAPI.saveSelf(`tools/${name}.js`, template);
    this.loadTools();
  }
};

function toolItemHtml(name, desc, off, isCustom, idx, file) {
  const cls = off ? 'tool-item disabled' : 'tool-item';
  const tog = off ? '✕' : '✓';
  const customClass = isCustom ? ' custom' : '';
  const editAction = isCustom
    ? `onclick="event.stopPropagation();window._selfEditCode('${window.esc(file)}')"`
    : `onclick="event.stopPropagation();window._selfEditDesc('${window.esc(name)}')"`;
  return `<div class="${cls}" onclick="document.getElementById('td${idx}').classList.toggle('open')">` +
    `<span class="tool-toggle" onclick="event.stopPropagation();window._selfToggleTool('${window.esc(name)}')">${tog}</span>` +
    `<span class="tool-name${customClass}">${window.esc(name)}</span>` +
    `<span class="tool-desc">${window.esc(desc)}</span>` +
    `<span class="tool-actions"><button class="btn-icon btn-small" ${editAction} title="编辑">✏️</button></span>` +
    `</div>`;
}

function bindToolEvents() {
  window._selfToggleTool = (name) => Self.toggleTool(name);
  window._selfEditDesc = (name) => Self.editToolDesc(name);
  window._selfEditCode = (file) => Self.editToolCode(file);
}

window._selfSelectPreset = (name) => Self.selectPreset(name);
