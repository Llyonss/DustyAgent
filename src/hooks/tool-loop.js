module.exports = [
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
