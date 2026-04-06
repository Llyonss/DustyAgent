const system = require('../../hooks/system-default');
const toolLoop = require('../../hooks/tool-loop');
const toolCmd = require('../../hooks/tool-cmd');
const toolFile = require('../../hooks/tool-file');
const createMask = require('../../hooks/message-mask');
const createLog = require('../../hooks/output-log');

module.exports = function(instanceDir) {
  const mask = createMask(instanceDir);
  const log = createLog(instanceDir);
  const tools = [...toolLoop, ...toolCmd, ...toolFile];

  return {
    system,
    tools: () => tools,
    events: (events) => mask.events(events),
    output: (turn) => log.output(turn),
  };
};
