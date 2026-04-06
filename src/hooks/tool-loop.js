module.exports = [
  {
    name: 'stop',
    description: 'Stop the current loop. Call when you have finished the task or are waiting for user input.',
    input_schema: { type: 'object', properties: {} },
    execute: async (input, ctrl) => { ctrl.stop(); return 'Loop stopped.'; },
  },
  {
    name: 'wait',
    description: 'Pause the loop for a number of seconds before continuing.',
    input_schema: {
      type: 'object',
      properties: { seconds: { type: 'number', description: 'Seconds to wait' } },
      required: ['seconds'],
    },
    execute: async (input, ctrl) => { ctrl.wait(input.seconds); return `Waiting ${input.seconds}s.`; },
  },
];
