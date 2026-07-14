// === 会话源适配器 ===
// 分组对话现已是普通实例，Chat 面板统一走 instance 源，不再有 project 模式。
// 保留此层是为了 Chat/preset/self 的调用点无需改动。

import { Data } from './data.js';

// 旧实例源：直接转发到 Data 的实例 API
function instanceSource(inst) {
  return {
    mode: 'instance',
    id: inst,
    fetchEvents: () => Data.pollEvents(inst),
    fetchBranches: () => Data.fetchBranches(inst).catch(() => []),
    sendEvent: (text) => Data.sendEvent(inst, text),
    stopLoop: () => Data.stopLoop(inst),
    continueLoop: () => Data.continueLoop(inst),
    retryEvent: () => Data.retryEvent(inst),
    deleteEvents: (files) => Data.deleteEvents(inst, files),
    supportsBranch: true,
    supportsCommit: true,
  };
}

export const Source = {
  current: null,

  restore() {
    const inst = localStorage.getItem('mental-instance') || '';
    this.current = instanceSource(inst);
    return this.current;
  },

  useInstance(inst) {
    localStorage.setItem('mental-instance', inst);
    this.current = instanceSource(inst);
    return this.current;
  },

  get() { return this.current || this.restore(); },
};
