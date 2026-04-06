const fs = require('fs');
const path = require('path');

// --- helpers ---

const MAX_OUTPUT = 30000;

function truncate(s) {
  if (s.length <= MAX_OUTPUT) return s;
  const remaining = s.length - MAX_OUTPUT;
  return s.slice(0, MAX_OUTPUT) + `\n\n... [${remaining} characters truncated] ...`;
}

function addLineNumbers(text, offset) {
  const lines = text.split('\n');
  const width = String(offset + lines.length - 1).length;
  return lines
    .map((line, i) => String(offset + i).padStart(width) + '\t' + line)
    .join('\n');
}

/**
 * Find the most recent read event for a given file path by scanning events.
 * Returns { mtime } parsed from the read output's metadata line, or null.
 */
function findLastRead(eventsDir, filePath) {
  if (!eventsDir) return null;
  const { readEvents } = require('../core/event');
  const events = readEvents(eventsDir);
  // walk backwards to find latest read for this path
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'action' && e.tool === 'read' && e.input && e.input.path === filePath) {
      // parse mtime from output metadata line: [File: ... | Modified: <ms>]
      const m = String(e.output).match(/Modified:\s*(\d+)\]/);
      if (m) return { mtime: Number(m[1]) };
      return null;
    }
  }
  return null;
}

/**
 * Guard: for an existing file, verify it was read and not modified since.
 * Returns null if OK, or an error string.
 */
function checkReadGuard(filePath, eventsDir) {
  if (!fs.existsSync(filePath)) return null; // new file, no guard
  const last = findLastRead(eventsDir, filePath);
  if (!last) return `Error: file has not been read yet. Read it first before writing to it.`;
  const currentMtime = Math.floor(fs.statSync(filePath).mtimeMs);
  if (currentMtime !== last.mtime) return `Error: file has been modified since last read (read mtime=${last.mtime}, current mtime=${currentMtime}). Read it again before editing.`;
  return null;
}

// --- tools ---

module.exports = [
  {
    name: 'read',
    description: `Read the contents of a file.

Usage:
- The file_path parameter must be an absolute path, not a relative path.
- By default reads the entire file. Use offset and limit for large files.
- Results include line numbers (1-indexed) for precise location reference.
- When you need to edit a file later, always read it first — edit and write will verify this.
- This tool can only read text files, not directories. To list a directory, use cmd with "dir" or "ls".`,
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to read' },
        offset: { type: 'number', description: 'Line number to start reading from (1-indexed, default 1)' },
        limit: { type: 'number', description: 'Number of lines to read. Only provide for large files' },
      },
      required: ['path'],
    },
    execute: async (input) => {
      const content = fs.readFileSync(input.path, 'utf-8');
      const allLines = content.split('\n');
      const totalLines = allLines.length;
      const offset = Math.max(1, input.offset || 1);
      const startIdx = offset - 1;

      let lines;
      if (input.limit) {
        lines = allLines.slice(startIdx, startIdx + input.limit);
      } else {
        lines = allLines.slice(startIdx);
      }

      const numbered = addLineNumbers(lines.join('\n'), offset);
      const endLine = offset + lines.length - 1;
      const mtime = Math.floor(fs.statSync(input.path).mtimeMs);

      return truncate(numbered + `\n[File: ${input.path} | Lines: ${offset}-${endLine}/${totalLines} | Modified: ${mtime}]`);
    },
  },
  {
    name: 'write',
    description: `Write content to a file. Creates directories if needed.

Usage:
- Use for creating new files or complete rewrites of existing files.
- If the file already exists, you MUST read it first with the read tool. This tool will error if you did not read the file first.
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
    execute: async (input, ctrl, eventsDir) => {
      const guard = checkReadGuard(input.path, eventsDir);
      if (guard) throw new Error(guard);
      fs.mkdirSync(path.dirname(input.path), { recursive: true });
      fs.writeFileSync(input.path, input.content);
      return 'File written successfully.';
    },
  },
  {
    name: 'edit',
    description: `Edit a file by replacing text. Supports multiple old/new pairs applied in order.

Usage:
- You MUST read the file first with the read tool before editing. This tool will error if you did not.
- Each "old" must be an EXACT substring of the current file content (copy-paste precision, including whitespace and newlines).
- When copying text from read output, preserve the exact indentation as it appears AFTER the line number prefix. Never include the line number prefix itself in old or new.
- The edit will FAIL if "old" matches more than one location in the file. Provide more surrounding context to make it unique.
- Prefer this over "write" for modifying existing files — it is less error-prone and outputs less text.`,
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
    execute: async (input, ctrl, eventsDir) => {
      const guard = checkReadGuard(input.path, eventsDir);
      if (guard) throw new Error(guard);
      let content = fs.readFileSync(input.path, 'utf-8');
      for (const edit of input.edits) {
        if (!content.includes(edit.old)) {
          const snippet = edit.old.length > 200 ? edit.old.substring(0, 200) + '...' : edit.old;
          const totalLines = content.split('\n').length;
          throw new Error(`text not found in file (${totalLines} lines). String: "${snippet}"`);
        }
        const matches = content.split(edit.old).length - 1;
        if (matches > 1) {
          throw new Error(`found ${matches} matches of the string to replace. Provide more surrounding context to uniquely identify the target. String: "${edit.old.length > 200 ? edit.old.substring(0, 200) + '...' : edit.old}"`);
        }
        content = content.replace(edit.old, edit.new);
      }
      fs.writeFileSync(input.path, content);
      return 'File edited successfully.';
    },
  },
];
