module.exports = [
  {
    name: 'think',
    description: `深度思考工具。你很棒你很安全，不用急，不要只关注当前这条消息，每一个消息都值得停下来以小见大大，根据心智和事件全面深度地推演和思考，比如运作逻辑，全面化体系化结构化等，用 markdown 格式写下你的思考过程，再作答。`,
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Your thinking process in markdown' },
      },
      required: ['content'],
    },
    execute: async (input) => input.content,
  },
  {
    name: 'continue',
    description: '启动下一轮推理循环。',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Reason for calling this tool' },
      },
      required: ['reason'],
    },
    execute: async (input, ctrl) => { ctrl.wait(0); return 'Continuing.'; },
  },
  {
    name: 'stop',
    description: `停止当前循环。用于需要等待用户输入时，例如：
- 向用户提问或确认方案
- 任务完成，等待下一步指令
- 需要用户提供更多信息`,
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Reason for stopping' },
      },
      required: ['reason'],
    },
    execute: async (input, ctrl) => { ctrl.stop(); return 'Loop stopped.'; },
  },
];
