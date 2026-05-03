const system = require('./system');
const createNovelTools = require('./tools');
const { ensureSnapshot, buildContextEvents } = require('./context');
const toolLoop = require('../../../hooks/tool-loop');
const toolCmd = require('../../../hooks/tool-cmd');
const toolFile = require('../../../hooks/tool-file');
const toolMedia = require('../../../hooks/tool-media');
const { tools: eyeTools, injectEyeEvents } = require('../../../hooks/tool-eye');
const createLog = require('../../../hooks/output-log');

module.exports = function(instanceDir) {
  const log = createLog(instanceDir);
  const novelTools = createNovelTools(instanceDir);
  const tools = [...novelTools, ...toolLoop, ...toolCmd, ...toolFile, ...toolMedia, ...eyeTools];

  return {
    system,

    tools: () => tools,

    events: async (events) => {
      // Truncate before the last successful finalize
      let last = -1;
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].type === 'action' && events[i].tool === 'commit' && !events[i].error) {
          last = i;
          break;
        }
      }
      let filtered = last >= 0 ? events.slice(last + 1) : events;

      // Prepend context as synthetic events
      const snapshot = ensureSnapshot(instanceDir);
      const contextEvents = buildContextEvents(snapshot);
      if (contextEvents.length > 0) filtered = [...contextEvents, ...filtered];

      return injectEyeEvents(filtered);
    },

    output: (turn) => log.output(turn),
  };
};
