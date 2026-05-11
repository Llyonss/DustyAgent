// === 故事查看 ===
// 职责：展示心智相关故事和实例故事详情

import { Data } from '../data.js';
import { View } from '../view.js';
import { Renderer } from '../renderer/index.js';

export const Story = {

  // 心智相关故事列表
  renderMentalStories(name, stories) {
    View.showStory();
    View.closeSidebar();
    document.getElementById('storyTitle').textContent = `📜 ${name} 的故事`;
    View.updateMobileTitle(`📜 ${name} 的故事`);

    if (!stories.length) {
      document.getElementById('storyBody').innerHTML = '<div class="empty">暂无相关故事</div>';
      document.getElementById('storyEvents').innerHTML = '';
      return;
    }
    document.getElementById('storyBody').innerHTML = stories.map(s =>
      `<div class="story-card" onclick="window._showStory('${window.esc(s.instance)}',${s.index})">` +
      `<div class="story-card-title"><span class="story-num">v${s.index}</span> ${window.esc(s.title)} <span class="story-instance">[${window.esc(s.instance)}]</span></div>` +
      `<div class="story-card-body">${window.esc((s.story || '').substring(0, 200))}${(s.story || '').length > 200 ? '...' : ''}</div>` +
      (Array.isArray(s.entities) && s.entities.length ? `<div class="story-card-entities">${s.entities.map(e => `<span onclick="event.stopPropagation();window._selectMental('${window.esc(e)}')">${window.esc(e)}</span>`).join(' ')}</div>` : '') +
      `</div>`
    ).join('');
    document.getElementById('storyEvents').innerHTML = '';
  },

  // 故事详情 + 事件
  async viewStory(instance, index) {
    View.showStory();
    View.closeSidebar();

    const hist = await Data.fetchHistory(instance);
    const story = hist[index - 1];
    const titleText = story ? `📜 v${index}: ${story.title}` : `📜 v${index}`;
    document.getElementById('storyTitle').textContent = titleText;
    View.updateMobileTitle(titleText);

    let bodyHtml = '';
    if (story) {
      bodyHtml += `<div class="story-detail-story">${window.md(story.story || '')}</div>`;
      if (Array.isArray(story.entities) && story.entities.length) {
        bodyHtml += `<div class="story-card-entities">${story.entities.map(e => `<span onclick="window._selectMental('${window.esc(e)}')">${window.esc(e)}</span>`).join(' ')}</div>`;
      }
    }
    document.getElementById('storyBody').innerHTML = bodyHtml;
    mermaid.run({ nodes: document.getElementById('storyBody').querySelectorAll('.mermaid:not([data-processed])') });

    const events = await Data.fetchStoryEvents(instance, index);
    if (!events.length) {
      document.getElementById('storyEvents').innerHTML = '<div class="empty" style="padding:12px">无事件记录</div>';
      return;
    }
    const eventsEl = document.getElementById('storyEvents');
    eventsEl.innerHTML = '<div class="story-events-title">事件记录</div>' + Renderer.render(events, { interactive: false });
    mermaid.run({ nodes: eventsEl.querySelectorAll('.mermaid:not([data-processed])') });
  }
};
