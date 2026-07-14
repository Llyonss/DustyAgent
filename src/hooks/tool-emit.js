// emit 工具 — agent 在 ReAct 中向共享事件总线发布事件，触发其他 agent
const { writeEvent } = require('../core/event');

/**
 * @param {string} busDir — 共享总线 events 目录
 */
module.exports = function(busDir) {
  return {
    name: 'emit',
    description: `向事件总线发布事件。其他 agent 的 listen 脚本会判断是否被唤起。
用法：emit(type="事件类型", data="任意内容") — data 可以是字符串或 JSON 对象字符串。
事件对总线全员可见，但只有 listen 脚本匹配的 agent 会被唤醒。`,
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: '事件类型。如 "file-changed"、"review-requested"、"docs-needed"' },
        data: { type: 'string', description: '事件携带数据。字符串或 JSON 对象字符串。接收方 agent 从 event.data 读取' },
      },
      required: ['type'],
    },
    execute: async (input) => {
      const event = { type: input.type };
      if (input.data != null) {
        try { event.data = JSON.parse(input.data); } catch { event.data = input.data; }
      }
      const result = writeEvent(busDir, event);
      return `事件已发布: ${input.type} (${result.file})`;
    },
  };
};
