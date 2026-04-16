const fs = require('fs');
const path = require('path');
const system = require('./system');
const createDocTools = require('./tool-apply');
const toolLoop = require('../../hooks/tool-loop');
const toolCmd = require('../../hooks/tool-cmd');
const toolFile = require('../../hooks/tool-file');
const toolMedia = require('../../hooks/tool-media');
const { tools: eyeTools, injectEye } = require('../../hooks/tool-eye');
const createLog = require('../../hooks/output-log');
const { readEvents } = require('../../core/event');

module.exports = function(instanceDir) {
  const docPath = path.join(instanceDir, 'doc.md');
  const draftPath = path.join(instanceDir, 'doc.draft.md');
  const eventsDir = path.join(instanceDir, 'events');
  const log = createLog(instanceDir);
  const docTools = createDocTools(docPath, draftPath);
  const tools = [...docTools, ...toolLoop, ...toolCmd, ...toolFile, ...toolMedia, ...eyeTools];

  // Ensure draft exists (working copy for apply/patch).
  // If draft already exists (e.g. crash recovery), keep it to preserve uncommitted edits.
  if (!fs.existsSync(draftPath)) {
    try { fs.copyFileSync(docPath, draftPath); }
    catch { /* doc.md doesn't exist yet — first run, draft will be created by apply */ }
  }

  function readDoc() {
    try { return fs.readFileSync(docPath, 'utf-8'); }
    catch { return ''; }
  }

  return {
    system,

    tools: () => tools,

    events: (events) => {
      let lastCommit = -1;
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].type === 'action' && events[i].tool === 'commit' && !events[i].error) {
          lastCommit = i;
          break;
        }
      }
      return lastCommit >= 0 ? events.slice(lastCommit + 1) : events;
    },

    messages: (messages) => {
      const allEvents = readEvents(eventsDir);
      const commits = allEvents.filter(e => e.type === 'action' && e.tool === 'commit' && !e.error);
      const doc = readDoc();
      const prefix = [];

      if (commits.length > 0) {
        const historyText = commits.map((a, i) =>
          'v' + (i + 1) + ': ' + (a.input && a.input.summary || '(无经历)')
        ).join('\n');
        prefix.push(
          { role: 'user', content: [{ type: 'text', text: '过往经历\n' + historyText }] },
          { role: 'assistant', content: [{ type: 'text', text: '收到。' }] },
        );
      }

      prefix.push(
        { role: 'user', content: [{ type: 'text', text: '请根据以下心智模型行动:\n<心智>\n' + (doc || '(空)') + '\n</心智>' }] },
        { role: 'assistant', content: [{ type: 'text', text: '好的, 我会以我的心智模型独立思考并行动, 以心智模型为主去审视吸收信息, 并多和用户讨论, 持续学习成长。' }] },
      );

      return injectEye([...prefix, ...messages]);
    },

    output: (turn) => log.output(turn),
  };
};
