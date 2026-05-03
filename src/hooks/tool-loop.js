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
    name: 'loop',
    description: `控制推理循环。
- continue: 启动下一轮推理循环
- stop: 停止当前循环，等待用户输入`,
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['continue', 'stop'], description: 'continue=继续循环, stop=停止等待用户' },
        reason: { type: 'string', description: 'Reason' },
      },
      required: ['action', 'reason'],
    },
    execute: async (input, ctrl) => {
      if (input.action === 'continue') { ctrl.wait(0); return 'Continuing.'; }
      ctrl.stop(); return 'Loop stopped.';
    },
  },
];
