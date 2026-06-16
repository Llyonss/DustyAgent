module.exports = [
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
