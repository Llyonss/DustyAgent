module.exports = [
  {
    name: 'rethink',
    description: 'Continue to the next reasoning round. Call when your thinking is not yet complete and you need another round.',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Reason for calling this tool' },
      },
      required: ['reason'],
    },
    execute: async (input, ctrl) => { ctrl.wait(0); return 'Continuing.'; },
  },
];
