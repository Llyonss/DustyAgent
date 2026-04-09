module.exports = [
  {
    name: 'rethink',
    description: '启动下一轮推理循环。无参数。',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
    execute: async (input, ctrl) => { ctrl.wait(0); return 'Continuing.'; },
  },
];
