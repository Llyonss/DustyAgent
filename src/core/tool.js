const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const tools = [
  {
    name: 'stop',
    description: 'Stop the current loop. Call when you have finished the task or are waiting for user input.',
    input_schema: { type: 'object', properties: {} },
    execute: async (input, ctrl) => {
      ctrl.stop();
      return 'Loop stopped.';
    },
  },
  {
    name: 'wait',
    description: 'Pause the loop for a number of seconds before continuing.',
    input_schema: {
      type: 'object',
      properties: { seconds: { type: 'number', description: 'Seconds to wait' } },
      required: ['seconds'],
    },
    execute: async (input, ctrl) => {
      ctrl.wait(input.seconds);
      return `Waiting ${input.seconds}s.`;
    },
  },
  {
    name: 'cmd',
    description: 'Execute a shell command and return stdout/stderr.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        timeout: { type: 'number', description: 'Timeout in seconds (default 30)' },
      },
      required: ['command'],
    },
    execute: async (input) => {
      try {
        const result = execSync(input.command, {
          timeout: (input.timeout || 30) * 1000,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        return result || '(no output)';
      } catch (e) {
        let out = '';
        if (e.stdout) out += e.stdout;
        if (e.stderr) out += '\nSTDERR: ' + e.stderr;
        out += '\nERROR: ' + e.message;
        return out.trim();
      }
    },
  },
  {
    name: 'read',
    description: 'Read the contents of a file.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'File path to read' } },
      required: ['path'],
    },
    execute: async (input) => {
      try {
        return fs.readFileSync(input.path, 'utf-8');
      } catch (e) {
        return `Error: ${e.message}`;
      }
    },
  },
  {
    name: 'write',
    description: 'Write content to a file. Creates directories if needed.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to write' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
    execute: async (input) => {
      try {
        const dir = path.dirname(input.path);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(input.path, input.content);
        return 'File written successfully.';
      } catch (e) {
        return `Error: ${e.message}`;
      }
    },
  },
  {
    name: 'edit',
    description: 'Edit a file by replacing text. Supports multiple old/new pairs applied in order.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to edit' },
        edits: {
          type: 'array',
          description: 'Array of replacements',
          items: {
            type: 'object',
            properties: {
              old: { type: 'string', description: 'Text to find (exact match)' },
              new: { type: 'string', description: 'Replacement text' },
            },
            required: ['old', 'new'],
          },
        },
      },
      required: ['path', 'edits'],
    },
    execute: async (input) => {
      try {
        let content = fs.readFileSync(input.path, 'utf-8');
        for (const edit of input.edits) {
          if (!content.includes(edit.old)) {
            return `Error: text not found: "${edit.old.substring(0, 80)}..."`;
          }
          content = content.replace(edit.old, edit.new);
        }
        fs.writeFileSync(input.path, content);
        return 'File edited successfully.';
      } catch (e) {
        return `Error: ${e.message}`;
      }
    },
  },
];

function getToolDefinitions() {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}

function getToolMap() {
  return Object.fromEntries(tools.map(t => [t.name, t]));
}

module.exports = { tools, getToolDefinitions, getToolMap };