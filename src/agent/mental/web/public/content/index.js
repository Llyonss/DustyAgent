// === 心智内容 ===
// 职责：查看和编辑心智的内容与链接，协调self、story、editor

import { Data } from '../data.js';
import { View } from '../view.js';
import { Graph } from '../graph/index.js';
import { Tree } from '../graph/tree.js';
import { Self } from './self.js';
import { Story } from './story.js';
import { Editor } from './editor.js';

export const Content = {
  current: null,   // 当前心智名，null='self'表示self页

  async select(name) {
    this.current = name === 'self' ? null : name;
    View.showContent();
    View.closeSidebar();
    Graph.highlight(name === 'self' ? null : name);
    View.updateMobileTitle(name === 'self' ? '◆ self' : name);

    if (name === 'self') {
      await Self.view();
      return;
    }

    // 隐藏self相关区
    document.getElementById('modelSection').classList.add('hidden');
    document.getElementById('systemPromptSection').classList.add('hidden');
    document.getElementById('toolsSection').classList.add('hidden');
    Editor.reset();

    try {
      const data = await Data.fetchMental(name);
      document.getElementById('contentName').textContent = name;
      document.getElementById('contentBody').innerHTML = window.md(data.content);
      document.getElementById('contentLinks').innerHTML = renderLinks(data.links);
    } catch {
      document.getElementById('contentName').textContent = name;
      document.getElementById('contentBody').innerHTML = '<div class="empty">心智不存在</div>';
      document.getElementById('contentLinks').innerHTML = '';
    }
  },

  showGraph() {
    this.current = null;
    View.showGraph();
    View.closeSidebar();
    Graph.highlight(null);
    View.updateMobileTitle('心智图谱');
  },

  // —— 编辑 ——

  editContent() {
    if (!this.current) return;
    const data = Data.cache.mental[this.current];
    Editor.enter({
      initialValue: data?.content || '',
      label: '编辑内容',
      onSave: async (value) => {
        await Data.saveMental(this.current, '.md', value);
      },
      onAfterSave: async () => {
        await Data.fetchGraph(true);
        Graph.render(Data.cache.graph);
        Tree.renderMental(Data.cache.graph);
        await this.select(this.current);
      }
    });
  },

  editLinks() {
    if (!this.current) return;
    const data = Data.cache.mental[this.current];
    Editor.enterLinks(
      data?.links || '',
      async (links) => {
        await Data.saveMental(this.current, '.links', links);
      },
      async () => {
        await Data.fetchGraph(true);
        Graph.render(Data.cache.graph);
        Tree.renderMental(Data.cache.graph);
        await this.select(this.current);
      }
    );
  },

  editSystem() { Self.editSystem(); },
  toggleSystemPrompt() { Self.toggleSystemPrompt(); },
  toggleModel() { Self.toggleModel(); },
  editModel() { Self.editModel(); },
  saveModel() { Self.saveModel(); },
  cancelModel() { Self.cancelModel(); },
  toggleTools() { Self.toggleTools(); },
  newTool() { Self.newTool(); },

  saveEdit() { Editor.save(); },
  cancelEdit() { Editor.cancel(); },

  // —— 故事 ——

  async showRelatedStories() {
    if (!this.current) return;
    const stories = await Data.fetchMentalStories(this.current);
    Story.renderMentalStories(this.current, stories);
  },

  showStory(instance, index) {
    Story.viewStory(instance, index);
  }
};

function renderLinks(linksText) {
  if (!linksText) return '';
  const parsed = linksText.split('\n').filter(l => l.trim()).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
  if (!parsed.length) return '';
  let html = '<div class="links-section">';
  html += parsed.map(link => {
    const cls = link.parent ? 'link-item link-parent' : 'link-item';
    const prefix = link.parent ? '▴ ' : '· ';
    return `<div class="${cls}" onclick="window._selectMental('${window.esc(link.name)}')">${prefix}${window.esc(link.name)}<span class="link-tag">${window.esc(link.summary || '')}</span></div>`;
  }).join('');
  html += '</div>';
  return html;
}

// 全局回调（供tree和link点击使用）
window._selectMental = (name) => Content.select(name);
window._showStory = (instance, index) => Content.showStory(instance, index);
