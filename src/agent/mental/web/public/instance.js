// === 实例管理 ===
// 职责：切换、新建、删除当前实例

import { Data } from './data.js';
import { Chat } from './chat/index.js';
import { Graph } from './graph/index.js';
import { Tree } from './graph/tree.js';
import { Preset } from './preset.js';

export const Instance = {
  current: localStorage.getItem('mental-instance') || '',

  async init() {
    const list = await Data.fetchInstances();
    const sel = document.getElementById('instanceSelect');
    sel.innerHTML = list.map(n =>
      `<option value="${n}" ${n === this.current ? 'selected' : ''}>${n}</option>`
    ).join('');
    if (!this.current && list.length) this.current = list[0];
    sel.value = this.current;
  },

  async switch(name) {
    this.current = name;
    localStorage.setItem('mental-instance', name);
    // 先清空旧内容，避免闪烁
    document.getElementById('chatMessages').innerHTML = '<div class="empty">加载中...</div>';
    document.getElementById('mentalTree').innerHTML = '';
    document.getElementById('graphSvg').innerHTML = '';
    document.getElementById('contentBody').innerHTML = '<div class="empty">从目录或图谱选择心智</div>';
    document.getElementById('contentLinks').innerHTML = '';

    // 停止旧轮询
    Chat.stopPoll();
    Chat.lastEventsJson = '';

    // 等待数据加载
    await Promise.allSettled([
      (async () => {
        const graphData = await Data.fetchGraph(true);
        Graph.render(graphData);
        Tree.renderMental(graphData);
      })(),
      Preset.refresh(),
    ]);

    // 数据就绪后再启动轮询
    Chat.startPoll();
  },

  async create() {
    const name = prompt('实例名:');
    if (!name) return;
    await Data.createInstance(name);
    this.current = name;
    localStorage.setItem('mental-instance', name);
    const sel = document.getElementById('instanceSelect');
    sel.innerHTML += `<option value="${name}">${name}</option>`;
    sel.value = name;
    await reloadAll();
  },

  async remove() {
    if (!this.current) return;
    if (!confirm(`确定删除实例 "${this.current}"？所有对话和故事将被永久删除。`)) return;
    await Data.deleteInstance(this.current);
    const list = await Data.fetchInstances();
    const sel = document.getElementById('instanceSelect');
    sel.innerHTML = list.map(n =>
      `<option value="${n}" ${n === this.current ? 'selected' : ''}>${n}</option>`
    ).join('');
    this.current = list[0] || '';
    sel.value = this.current;
    localStorage.setItem('mental-instance', this.current);
    if (!this.current) return;
    await reloadAll();
  },

  async restart() {
    if (!confirm('确定重启 Mental 服务？')) return;
    await Data.restartService();
    setTimeout(() => location.reload(), 2000);
  }
};

async function reloadAll() {
  Chat.stopPoll();
  Chat.lastEventsJson = '';
  await Promise.allSettled([
    (async () => {
      const graphData = await Data.fetchGraph(true);
      Graph.render(graphData);
      Tree.renderMental(graphData);
    })(),
    Preset.refresh(),
  ]);
  Chat.startPoll();
}
