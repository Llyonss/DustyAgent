const path = require('path');
const system = require('./system');
const createMentalTools = require('./tools');
const { buildContextMessages } = require('./context');
const toolLoop = require('../../../hooks/tool-loop');
const toolCmd = require('../../../hooks/tool-cmd');
const toolFile = require('../../../hooks/tool-file');
const toolMedia = require('../../../hooks/tool-media');
const { tools: eyeTools, injectEye } = require('../../../hooks/tool-eye');
const createLog = require('../../../hooks/output-log');

module.exports = function(instanceDir) {
  const mentalRoot = path.join(instanceDir, '..', '..');
  const log = createLog(instanceDir);
  const mentalTools = createMentalTools(instanceDir, mentalRoot);
  const tools = [...mentalTools, ...toolLoop, ...toolCmd, ...toolFile, ...toolMedia, ...eyeTools];

  return {
    system,

    tools: () => tools,

    events: (events) => {
      // Truncate before the last successful commit
      let last = -1;
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].type === 'action' && events[i].tool === 'commit' && !events[i].error) {
          last = i;
          break;
        }
      }
      return last >= 0 ? events.slice(last + 1) : events;
    },

    messages: async (messages) => {
      const prefix = buildContextMessages(instanceDir);
      return injectEye([...prefix, ...messages]);
    },

    output: (turn) => log.output(turn),
  };
};
