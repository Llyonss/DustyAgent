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
    description: `执行 shell 命令，返回 stdout/stderr。

用法：
- 用于运行 shell 命令、构建脚本、git 操作等。
- 文件操作请用专用工具（read/write/edit），不要用 cmd。
- 多个独立命令可并行调用；有依赖关系的用 "&&" 串联。
- 可选 timeout 参数指定超时秒数（默认 30，最大 300）。
- 输出超过 ${MAX_OUTPUT} 字符会被截断。`,
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
