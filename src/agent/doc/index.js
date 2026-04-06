const fs = require('fs');
const path = require('path');
const system = require('./system');
const createApplyTool = require('./tool-apply');
const toolLoop = require('../../hooks/tool-loop');
const toolCmd = require('../../hooks/tool-cmd');
const toolFile = require('../../hooks/tool-file');
const createLog = require('../../hooks/output-log');
const { readEvents } = require('../../core/event');

module.exports = function(instanceDir) {
  const docPath = path.join(instanceDir, 'doc.md');
  const eventsDir = path.join(instanceDir, 'events');
  const log = createLog(instanceDir);
  const applyTool = createApplyTool(docPath);
  const tools = [applyTool, ...toolLoop, ...toolCmd, ...toolFile];

  function readDoc() {
    try { return fs.readFileSync(docPath, 'utf-8'); }
    catch { return ''; }
  }

  return {
    system,

    tools: () => tools,

    events: (events) => {
      let lastApply = -1;
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].type === 'action' && events[i].tool === 'apply' && !events[i].error) {
          lastApply = i;
          break;
        }
      }
      return lastApply >= 0 ? events.slice(lastApply + 1) : events;
    },

    messages: (messages) => {
      const allEvents = readEvents(eventsDir);
      const applies = allEvents.filter(e => e.type === 'action' && e.tool === 'apply' && !e.error);
      const doc = readDoc();
      const prefix = [];

      if (applies.length > 0) {
        const historyText = applies.map((a, i) =>
          'v' + (i + 1) + ': ' + (a.input && a.input.summary || '(no summary)')
        ).join('\n');
        prefix.push(
          { role: 'user', content: [{ type: 'text', text: 'Version history:\n' + historyText }] },
          { role: 'assistant', content: [{ type: 'text', text: 'Noted.' }] },
        );
      }

      prefix.push(
        { role: 'user', content: [{ type: 'text', text: 'Current document:\n<document>\n' + (doc || '(empty)') + '\n</document>' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'I see the document. How would you like to proceed?', cache_control: { type: 'ephemeral' } }] },
      );

      return [...prefix, ...messages];
    },

    output: (turn) => log.output(turn),
  };
};
