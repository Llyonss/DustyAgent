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
 * Returns { mtime, offset, limit } parsed from the read event, or null.
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
      if (m) return {
        mtime: Number(m[1]),
        offset: e.input.offset || undefined,
        limit: e.input.limit || undefined,
      };
      return null;
    }
  }
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
    execute: async (input, ctrl, eventsDir) => {
      const currentMtime = Math.floor(fs.statSync(input.path).mtimeMs);

      // Check if file is unchanged since last read with same offset/limit
      const lastRead = findLastRead(eventsDir, input.path);
      if (lastRead) {
        const sameOffset = (input.offset || undefined) === lastRead.offset;
        const sameLimit = (input.limit || undefined) === lastRead.limit;
        if (sameOffset && sameLimit && currentMtime === lastRead.mtime) {
          return `[File unchanged: ${input.path} | Modified: ${currentMtime}]`;
        }
      }

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

      return truncate(numbered + `\n[File: ${input.path} | Lines: ${offset}-${endLine}/${totalLines} | Modified: ${currentMtime}]`);
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
- When copying text from read output, preserve the exact indentation as it appears AFTER the line number prefix. Never include the line number prefix itself in old or new.
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
      let content = fs.readFileSync(input.path, 'utf-8');
      if (!content.includes(input.old)) {
        const snippet = input.old.length > 200 ? input.old.substring(0, 200) + '...' : input.old;
        const totalLines = content.split('\n').length;
        throw new Error(`text not found in file (${totalLines} lines). String: "${snippet}"`);
      }
      const matches = content.split(input.old).length - 1;
      if (matches > 1) {
        throw new Error(`found ${matches} matches of the string to replace. Provide more surrounding context to uniquely identify the target. String: "${input.old.length > 200 ? input.old.substring(0, 200) + '...' : input.old}"`);
      }
      content = content.replace(input.old, input.new);
      fs.writeFileSync(input.path, content);
      return 'File edited successfully.';
    },
  },
];
