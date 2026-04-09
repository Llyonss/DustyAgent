const fs = require('fs');
const path = require('path');

function normalizeEndings(s) {
  return s.replace(/\r\n/g, '\n');
}

module.exports = [
  {
    name: 'read',
    description: `Read the contents of a file.

Usage:
- The file_path parameter must be an absolute path, not a relative path.
- This tool can only read text files, not directories. To list a directory, use cmd with "dir" or "ls".`,
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to read' },
      },
      required: ['path'],
    },
    execute: async (input, ctrl) => {
      const raw = fs.readFileSync(input.path, 'utf-8');
      const content = normalizeEndings(raw);

      // Check if file is unchanged since last read (from ctrl.events)
      if (ctrl && ctrl.events) {
        for (let i = ctrl.events.length - 1; i >= 0; i--) {
          const e = ctrl.events[i];
          if (e.type === 'action' && e.tool === 'read' && e.input && e.input.path === input.path) {
            if (e.output === content) return 'unchanged';
            break;
          }
        }
      }

      return content;
    },
  },
  {
    name: 'write',
    description: `Write content to a file. Creates directories if needed.

Usage:
- Use for creating new files or complete rewrites of existing files.
- Prefer the edit tool for modifying existing files — it only sends the changed parts, which is faster, cheaper, and less error-prone.
- NEVER write files unless explicitly required by the task.`,
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to write' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
    execute: async (input) => {
      fs.mkdirSync(path.dirname(input.path), { recursive: true });
      fs.writeFileSync(input.path, input.content);
      return 'File written successfully.';
    },
  },
  {
    name: 'edit',
    description: `Edit a file by replacing text. Supports multiple old/new pairs applied in order.

Usage:
- Each "old" must be an EXACT substring of the current file content (copy-paste precision, including whitespace and newlines).
- The edit will FAIL if "old" matches more than one location in the file. Provide more surrounding context to make it unique.
- Prefer this over "write" for modifying existing files — it is less error-prone and outputs less text.`,
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to edit' },
        old: { type: 'string', description: 'Text to find (exact match)' },
        new: { type: 'string', description: 'Replacement text' },
      },
      required: ['path', 'old', 'new'],
    },
    execute: async (input) => {
      const raw = fs.readFileSync(input.path, 'utf-8');
      const useCRLF = raw.includes('\r\n');
      let content = normalizeEndings(raw);
      const old = normalizeEndings(input.old);
      const replacement = normalizeEndings(input.new);

      if (!content.includes(old)) {
        const snippet = old.length > 200 ? old.substring(0, 200) + '...' : old;
        const totalLines = content.split('\n').length;
        throw new Error(`text not found in file (${totalLines} lines). String: "${snippet}"`);
      }
      const matches = content.split(old).length - 1;
      if (matches > 1) {
        throw new Error(`found ${matches} matches of the string to replace. Provide more surrounding context to uniquely identify the target. String: "${old.length > 200 ? old.substring(0, 200) + '...' : old}"`);
      }
      content = content.replace(old, replacement);
      if (useCRLF) content = content.replace(/\n/g, '\r\n');
      fs.writeFileSync(input.path, content);
      return 'File edited successfully.';
    },
  },
];
