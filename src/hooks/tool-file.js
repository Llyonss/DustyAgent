const fs = require('fs');
const path = require('path');

function normalizeEndings(s) {
  return s.replace(/\r\n/g, '\n');
}

module.exports = [
  {
    name: 'read',
    description: `读取文件内容。

用法：
- path 参数必须是绝对路径。
- 只能读文本文件，不能读目录。列目录请用 cmd 的 "dir" 或 "ls"。`,
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to read' },
      },
      required: ['path'],
    },
    execute: async (input, ctrl) => {
      const filePath = path.normalize(input.path);
      const raw = fs.readFileSync(filePath, 'utf-8');
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
    description: `将内容写入文件，自动创建目录。

用法：
- 用于创建新文件或完整重写已有文件。
- 修改已有文件优先用 edit 工具——只传改动部分，更快、更省、更不容易出错。
- 非任务明确要求时不要写文件。
- content 完整发送，受单次输出 token 限制，最高 3000 字。如超出建议分步写入或用 cmd 生成。`,
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to write' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
    execute: async (input) => {
      const filePath = path.normalize(input.path);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, input.content);
      return 'File written successfully.';
    },
  },
  {
    name: 'edit',
    description: `替换文件中的文本，支持多次 old/new 依次替换。

用法：
- old 必须是文件中的精确子串（逐字匹配，含空白和换行）。
- 若 old 匹配到多处，编辑会失败——请提供更多上下文使其唯一。
- 修改已有文件优先用此工具而非 write。
- 适合局部修改。old + new 总计超过 200 行时，考虑用 write 重写整个文件。`,
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
      const filePath = path.normalize(input.path);
      const raw = fs.readFileSync(filePath, 'utf-8');
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
      fs.writeFileSync(filePath, content);
      return 'File edited successfully.';
    },
  },
];
