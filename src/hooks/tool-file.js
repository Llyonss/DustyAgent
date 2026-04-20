const fs = require('fs');
const path = require('path');

function normalizeEndings(s) { return s.replace(/\r\n/g, '\n'); }
function normalizeQuotes(s) { return s.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'"); }

const MAX_LINES = 500;
const MAX_CHARS = 30000;

function truncate(text) {
  const lines = text.split('\n');
  let chars = 0, n = 0;
  for (; n < lines.length; n++) {
    chars += lines[n].length + 1;
    if (n + 1 >= MAX_LINES || chars >= MAX_CHARS) { n++; break; }
  }
  if (n < lines.length) {
    return lines.slice(0, n).join('\n')
      + `\n[truncated: 1-${n} of ${lines.length} lines, ${(chars / 1000).toFixed(1)}k/${(text.length / 1000).toFixed(1)}k chars] Use from_line/to_line to read specific ranges.`;
  }
  return null; // no truncation
}

function readFile(input, ctrl) {
  const filePath = path.normalize(input.path);
  const raw = fs.readFileSync(filePath, 'utf-8');
  const content = normalizeEndings(raw);
  const allLines = content.split('\n');
  const totalLines = allLines.length;

  const hasRange = input.from_line != null || input.to_line != null;
  const from = (input.from_line || 1) - 1;
  const to = Math.min((input.to_line || totalLines), totalLines);
  const sliced = allLines.slice(from, to);

  let charCount = 0, lineCount = 0;
  for (let i = 0; i < sliced.length; i++) {
    charCount += sliced[i].length + 1;
    lineCount++;
    if (lineCount >= MAX_LINES || charCount >= MAX_CHARS) break;
  }
  const truncated = lineCount < sliced.length;
  const result = sliced.slice(0, lineCount).join('\n');

  if (truncated) {
    const shownFrom = from + 1, shownTo = from + lineCount;
    return result + `\n[truncated: ${shownFrom}-${shownTo} of ${totalLines} lines, ${(charCount / 1000).toFixed(1)}k/${(content.length / 1000).toFixed(1)}k chars] Use from_line/to_line to read specific ranges.`;
  }

  if (!hasRange && ctrl && ctrl.events) {
    for (let i = ctrl.events.length - 1; i >= 0; i--) {
      const e = ctrl.events[i];
      if (e.type === 'action' && e.tool === 'file' && e.input && path.normalize(e.input.path || '') === filePath && !e.input.content && !e.input.old && !e.input.delete) {
        if (e.output === result) return 'unchanged';
        break;
      }
    }
  }
  return result;
}

function readAgo(input, ctrl) {
  const filePath = path.normalize(input.path);
  const ago = input.ago;
  if (!ctrl || !ctrl.events) throw new Error('No events available for ago lookup');

  // Collect all historical versions of this file from events
  const versions = [];
  for (const evt of ctrl.events) {
    if (evt.type !== 'action') continue;
    const ep = evt.input?.path ? path.normalize(evt.input.path) : null;
    if (!ep || ep !== filePath) continue;
    // read tool (old name) or file tool in read mode
    if ((evt.tool === 'read' || evt.tool === 'file') && !evt.input.content && !evt.input.old && !evt.input.delete && !evt.input.ago) {
      if (typeof evt.output === 'string' && evt.output !== 'unchanged') {
        versions.push(evt.output);
      }
    }
    // write tool (old name) or file tool in write mode
    if ((evt.tool === 'write' || evt.tool === 'file') && typeof evt.input?.content === 'string') {
      versions.push(evt.input.content);
    }
  }

  if (ago > versions.length) throw new Error(`Only ${versions.length} version(s) found, cannot go back ${ago}`);
  const base = versions[versions.length - ago];

  // Apply subsequent edits after this version
  // Find the event index of this version
  let baseIdx = -1, count = 0;
  for (let i = 0; i < ctrl.events.length; i++) {
    const evt = ctrl.events[i];
    if (evt.type !== 'action') continue;
    const ep = evt.input?.path ? path.normalize(evt.input.path) : null;
    if (!ep || ep !== filePath) continue;
    if ((evt.tool === 'read' || evt.tool === 'file') && !evt.input.content && !evt.input.old && !evt.input.delete && !evt.input.ago) {
      if (typeof evt.output === 'string' && evt.output !== 'unchanged') count++;
    }
    if ((evt.tool === 'write' || evt.tool === 'file') && typeof evt.input?.content === 'string') count++;
    if (count === versions.length - ago + 1) { baseIdx = i; break; }
  }

  // No edits to apply — we want the version as-is before next version
  // Actually for ago, we just return that version directly
  const t = truncate(base);
  return t || base;
}

function writeFile(input) {
  const filePath = path.normalize(input.path);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, input.content);
  return 'ok';
}

function editFile(input) {
  const filePath = path.normalize(input.path);
  const raw = fs.readFileSync(filePath, 'utf-8');
  const useCRLF = raw.includes('\r\n');
  let content = normalizeEndings(raw);
  const old = normalizeEndings(input.old);
  const replacement = normalizeEndings(input.new);

  let matchOld = old;
  if (!content.includes(old)) {
    const nc = normalizeQuotes(content), no = normalizeQuotes(old);
    if (nc.includes(no)) {
      const idx = nc.indexOf(no);
      matchOld = content.substring(idx, idx + old.length);
    } else {
      const snippet = old.length > 200 ? old.substring(0, 200) + '...' : old;
      throw new Error(`text not found in file (${content.split('\n').length} lines). String: "${snippet}"`);
    }
  }
  const matches = content.split(matchOld).length - 1;
  if (matches > 1) {
    throw new Error(`found ${matches} matches. Provide more context to uniquely identify. String: "${matchOld.length > 200 ? matchOld.substring(0, 200) + '...' : matchOld}"`);
  }
  content = content.replace(matchOld, replacement);
  if (useCRLF) content = content.replace(/\n/g, '\r\n');
  fs.writeFileSync(filePath, content);
  return 'ok';
}

function deleteFile(input) {
  const filePath = path.normalize(input.path);
  fs.unlinkSync(filePath);
  return 'ok';
}

module.exports = [
  {
    name: 'file',
    description: `文件操作工具。根据参数组合自动判断模式：

读取文件：
- path 参数必须是绝对路径。
- 只能读文本文件，不能读目录。列目录请用 cmd 的 "dir" 或 "ls"。
- 可选 from_line/to_line 指定行范围（1-based，含两端）。
- 超过500行或30000字符自动裁剪，请用行范围参数分段读取。
- 可选 ago 参数读取历史版本（ago=1为上一版本，ago=2为上上版本）。

写入文件：传 content 参数。自动创建目录。
- 用于创建新文件或完整重写已有文件。
- 修改已有文件优先用 old/new 参数——只传改动部分，更快、更省、更不容易出错。
- 非任务明确要求时不要写文件。
- content 完整发送，受单次输出 token 限制，最高 3000 字。如超出建议分步写入或用 cmd 生成。

替换文本：传 old + new 参数。
- old 必须是文件中的精确子串（逐字匹配，含空白和换行）。
- 若 old 匹配到多处，编辑会失败——请提供更多上下文使其唯一。
- 适合局部修改。old + new 总计超过 200 行时，考虑用 content 重写整个文件。

删除文件：传 delete=true。`,
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute file path' },
        content: { type: 'string', description: 'Complete new content (write mode)' },
        old: { type: 'string', description: 'Exact substring to find (edit mode)' },
        new: { type: 'string', description: 'Replacement text (edit mode)' },
        delete: { type: 'boolean', description: 'Delete the file' },
        ago: { type: 'number', description: 'Read Nth previous version (1=last, 2=before last)' },
        from_line: { type: 'number', description: 'Start line (1-based, inclusive)' },
        to_line: { type: 'number', description: 'End line (1-based, inclusive)' },
      },
      required: ['path'],
    },
    execute: async (input, ctrl) => {
      if (input.delete) return deleteFile(input);
      if (input.content != null) return writeFile(input);
      if (input.old != null && input.new != null) return editFile(input);
      if (input.ago) return readAgo(input, ctrl);
      return readFile(input, ctrl);
    },
  },
];
