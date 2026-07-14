// === 实例管理 ===
// 职责：切换、新建、删除当前实例

import { Data } from './data.js';
import { Chat } from './chat/index.js';
import { Graph } from './graph/index.js';
import { UnifiedTree } from './unified-tree.js';
import { Preset } from './preset.js';
import { Source } from './source.js';

export const Instance = {
  current: localStorage.getItem('mental-instance') || '',

  async switch(name) {
    this.current = name;
    Source.useInstance(name);
    // 先清空旧内容，避免闪烁
    document.getElementById('chatMessages').innerHTML = '<div class="empty">加载中...</div>';
    document.getElementById('unifiedTree').innerHTML = '';
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
        await UnifiedTree.init();
      })(),
      Preset.refresh(),
    ]);

    // 数据就绪后再启动轮询
    Chat.startPoll();
  },

  async restart() {
    if (!confirm('确定重启 Mental 服务？')) return;
    await Data.restartService();
    setTimeout(() => location.reload(), 2000);
  }
};
