// === LLM 预设切换 ===
// 职责：在 chat-header 中展示当前 preset，支持一键切换

import { Data } from './data.js';
import { Instance } from './instance.js';

export const Preset = {
  presets: {},
  current: null,
  hasConfig: false,
  open: false,

  async init() {
    this.bindEvents();
    await this.refresh();
  },

  async refresh() {
    try {
      const data = await Data.fetchModelPresets(Instance.current);
      this.presets = data.presets || {};
      this.current = data.current;
      this.hasConfig = data.hasConfig;
    } catch {
      this.presets = {};
      this.current = null;
      this.hasConfig = false;
    }
    this.renderTrigger();
    this.renderDropdown();
  },

  // —— 触发器文字 ——
  label() {
    if (this.current) return this.current;
    if (this.hasConfig) return '自定义';
    return '默认(.env)';
  },

  icon() {
    return this.current ? '◆' : '◇';
  },

  // —— 渲染触发器 ——
  renderTrigger() {
    const el = document.getElementById('presetLabel');
    if (!el) return;
    el.textContent = this.label();
    const icon = document.getElementById('presetIcon');
    if (icon) icon.textContent = this.icon();
  },

  // —— 渲染下拉 ——
  renderDropdown() {
    const dd = document.getElementById('presetDropdown');
    if (!dd) return;
    const names = Object.keys(this.presets);
    if (!names.length) {
      dd.innerHTML = '<div class="preset-empty">无预设</div>';
      return;
    }
    let html = '';
    for (const name of names) {
      const p = this.presets[name];
      const sel = name === this.current ? ' selected' : '';
      const label = (p.provider || '') + ' · ' + (p.model || '').replace('anthropic/', '');
      html += `<div class="preset-drop-item${sel}" data-preset="${window.esc(name)}">` +
        `<span class="preset-dot">${sel ? '●' : '○'}</span>` +
        `<span class="preset-name">${window.esc(name)}</span>` +
        `<span class="preset-label">${window.esc(label)}</span>` +
        `</div>`;
    }
    dd.innerHTML = html;

    // 绑定点击
    dd.querySelectorAll('.preset-drop-item').forEach(item => {
      item.addEventListener('click', () => this.select(item.dataset.preset));
    });
  },

  // —— 切换下拉 ——
  toggle() {
    this.open = !this.open;
    const trigger = document.getElementById('presetTrigger');
    const dd = document.getElementById('presetDropdown');
    if (this.open) {
      dd.classList.remove('hidden');
      trigger.classList.add('open');
    } else {
      dd.classList.add('hidden');
      trigger.classList.remove('open');
    }
  },

  close() {
    if (!this.open) return;
    this.open = false;
    document.getElementById('presetDropdown').classList.add('hidden');
    document.getElementById('presetTrigger').classList.remove('open');
  },

  // —— 选择预设 ——
  async select(name) {
    const trigger = document.getElementById('presetTrigger');
    try {
      await Data.saveModel(Instance.current, null, name);
      this.current = name;
      this.hasConfig = true;
      this.renderTrigger();
      this.renderDropdown();
      this.close();
      // 闪绿
      trigger.classList.add('flash-green');
      setTimeout(() => trigger.classList.remove('flash-green'), 250);
    } catch {
      // 闪红
      trigger.classList.add('flash-red');
      setTimeout(() => trigger.classList.remove('flash-red'), 250);
    }
  },

  // —— 事件绑定 ——
  bindEvents() {
    document.getElementById('presetTrigger').addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });

    // 点击外部关闭
    document.addEventListener('click', (e) => {
      if (this.open && !e.target.closest('#presetTrigger') && !e.target.closest('#presetDropdown')) {
        this.close();
      }
    });
  }
};
