const system = require('../../hooks/system-default');
const toolLoop = require('../../hooks/tool-loop');
const toolCmd = require('../../hooks/tool-cmd');
const toolFile = require('../../hooks/tool-file');
const toolMedia = require('../../hooks/tool-media');
const { tools: eyeTools, injectEyeEvents } = require('../../hooks/tool-eye');
const createMask = require('../../hooks/message-mask');
const createLog = require('../../hooks/output-log');

module.exports = function(instanceDir) {
  const mask = createMask(instanceDir);
  const log = createLog(instanceDir);
  const tools = [...toolLoop, ...toolCmd, ...toolFile, ...toolMedia, ...eyeTools];

  return {
    system,
    tools: () => tools,
    events: async (events) => injectEyeEvents(mask.events(events)),
    output: (turn) => log.output(turn),
  };
};
