const fs = require('fs');
const path = require('path');
const { infer } = require('../core/infer');

const THRESHOLD = 800000; // characters
let generating = false;

function readMask(instanceDir) {
  const file = path.join(instanceDir, 'mask.json');
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
  catch (e) { return null; }
}

function writeMask(instanceDir, mask) {
  fs.writeFileSync(path.join(instanceDir, 'mask.json'), JSON.stringify(mask, null, 2));
}

function applyMask(events, mask) {
  if (!mask || mask.length === 0) return events;

  const result = [];
  const inserted = new Set();

  for (const event of events) {
    const entry = mask.find(m => event.ts >= m.start && event.ts <= m.end);
    if (entry) {
      if (!inserted.has(entry)) {
        result.push({
          type: 'user',
          content: `[Summary of ${entry.start} to ${entry.end}]: ${entry.summary}`,
        });
        inserted.add(entry);
      }
      continue;
    }
    result.push(event);
  }

  return result;
}

async function generateMask(events, mask, instanceDir) {
  const view = applyMask(events, mask);

  const text = view.map(e => {
    if (e.type === 'user' && e.content.startsWith('[Summary of '))
      return `--- summary ---\n${e.content}\n---`;
    if (e.type === 'user')
      return `--- ${e.ts} ---\nuser: ${e.content}\n---`;
    if (e.type === 'action')
      return `--- ${e.ts} ---\naction(${e.tool}): input=${JSON.stringify(e.input)} output=${String(e.output).substring(0, 500)}\n---`;
    return `--- ${e.ts} ---\n${JSON.stringify(e)}\n---`;
  }).join('\n');

  const prompt = {
    model: process.env.LLM_MODEL,
    max_tokens: 8192,
    tools: [{
      name: 'write_mask',
      description: 'Write the mask.json file to compress conversation history.',
      input_schema: {
        type: 'object',
        properties: {
          mask: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                start: { type: 'number', description: 'Start timestamp' },
                end: { type: 'number', description: 'End timestamp' },
                summary: { type: 'string', description: 'One line summary of masked events' },
              },
              required: ['start', 'end', 'summary'],
            },
          },
        },
        required: ['mask'],
      },
    }],
    tool_choice: { type: 'tool', name: 'write_mask' },
    messages: [{
      role: 'user',
      content: `Below is a conversation history. Each event has a timestamp. Summaries of previously masked events show their timestamp range.

Generate a mask to compress older, less relevant events.

Rules:
- Mask events that are less relevant: resolved discussions, read file contents, failed attempts, verbose tool outputs
- Keep recent events unmasked (at least the last 30%)
- Group consecutive masked events by timestamp range
- Existing summaries can be included in a larger range to further compress

Events:
${text}`,
    }],
  };

  try {
    for await (const evt of infer(prompt)) {
      if (evt.type === 'tool_call' && evt.name === 'write_mask') {
        writeMask(instanceDir, evt.input.mask);
      }
    }
  } catch (e) {
    console.error('mask generation failed:', e.message);
  }
}

module.exports = function(instanceDir) {
  return {
    events: (events) => {
      const mask = readMask(instanceDir);
      const filtered = applyMask(events, mask);

      if (JSON.stringify(filtered).length > THRESHOLD && !generating) {
        generating = true;
        generateMask(events, mask, instanceDir)
          .finally(() => { generating = false; });
      }

      return filtered;
    },
  };
};
