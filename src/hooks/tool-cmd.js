const { execSync } = require('child_process');

const MAX_OUTPUT = 30000;

function truncate(s) {
  if (s.length <= MAX_OUTPUT) return s;
  const remaining = s.length - MAX_OUTPUT;
  return s.slice(0, MAX_OUTPUT) + `\n\n... [${remaining} characters truncated] ...`;
}

module.exports = [
  {
    name: 'cmd',
    description: `Execute a shell command and return stdout/stderr.

Usage:
- Use for running shell commands, build scripts, git operations, etc.
- Avoid using this tool for file operations that have dedicated tools (read, write, edit). Use the dedicated tools instead — they provide better experience and error handling.
- If multiple commands are independent, make multiple cmd calls in parallel. If they depend on each other, chain with "&&".
- You can specify an optional timeout in seconds (default 30, max 300).
- Output is truncated at ${MAX_OUTPUT} characters to avoid context overflow.`,
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
        const raw = execSync(input.command, {
          timeout: (input.timeout || 30) * 1000,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }) || '(no output)';
        return truncate(raw);
      } catch (e) {
        let out = '';
        if (e.stdout) out += e.stdout;
        if (e.stderr) out += '\nSTDERR: ' + e.stderr;
        out += '\nERROR: ' + e.message;
        return truncate(out.trim());
      }
    },
  },
];
