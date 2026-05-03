const fs = require('fs');
const path = require('path');

function normalizeEndings(s) { return s.replace(/\r\n/g, '\n'); }
function normalizeQuotes(s) { return s.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'"); }

const MAX_LINES = 500;
const MAX_CHARS = 30000;

// Parse lines param: "10-20" | "50-" | "50" → { from, to } (1-based, to=Infinity for open-ended)
function parseLines(lines) {
  if (!lines) return null;
  const s = String(lines).trim();
  if (s.includes('-')) {
    const [left, right] = s.split('-', 2);
    return { from: left ? parseInt(left, 10) : 1, to: right ? parseInt(right, 10) : Infinity };
  }
  const n = parseInt(s, 10);
  return { from: n, to: n };
}

function readFile(input, ctrl) {
  const filePath = path.normalize(input.path);
  const raw = fs.readFileSync(filePath, 'utf-8');
  const content = normalizeEndings(raw);
  const allLines = content.split('\n');
  const totalLines = allLines.length;

  const range = parseLines(input.lines);
  const hasRange = !!range;
  const from = (range ? range.from : 1) - 1;
  const to = Math.min((range ? (range.to === Infinity ? totalLines : range.to) : totalLines), totalLines);
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
    return result + `\n[truncated: ${shownFrom}-${shownTo} of ${totalLines} lines, ${(charCount / 1000).toFixed(1)}k/${(content.length / 1000).toFixed(1)}k chars] Use lines param to read specific ranges.`;
  }

  if (!hasRange && ctrl && ctrl.events) {
    for (let i = ctrl.events.length - 1; i >= 0; i--) {
      const e = ctrl.events[i];
      if (e.type === 'action' && e.tool === 'file' && e.input && path.normalize(e.input.path || '') === filePath && !e.input.set && !e.input.select && !e.input.delete) {
        if (e.output === result) return 'unchanged';
        break;
      }
    }
  }
  return result;
}

function writeFile(input) {
  const filePath = path.normalize(input.path);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, input.set);
  return 'ok';
}

function editFile(input) {
  const filePath = path.normalize(input.path);
  const raw = fs.readFileSync(filePath, 'utf-8');
  const useCRLF = raw.includes('\r\n');
  let content = normalizeEndings(raw);
  const old = normalizeEndings(input.select);
  const replacement = normalizeEndings(input.set);

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

// --- List directory tree ---
const IGNORE_DIRS = new Set(['node_modules', '.git', '.svn', '__pycache__', '.DS_Store']);
const LIST_MAX_CHARS = 4000;

function scanDir(dirPath) {
  // returns { name, children: [...] | null (file) }
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    .filter(e => !IGNORE_DIRS.has(e.name))
    .sort((a, b) => {
      // dirs first, then files
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });
  return entries.map(e => {
    if (e.isDirectory()) {
      return { name: e.name + '/', children: scanDir(path.join(dirPath, e.name)) };
    }
    return { name: e.name, children: null };
  });
}

function countNodes(nodes) {
  let c = nodes.length;
  for (const n of nodes) {
    if (n.children) c += countNodes(n.children);
  }
  return c;
}

function renderDirTree(nodes, maxDepth) {
  const lines = [];
  function walk(items, depth) {
    for (const item of items) {
      const indent = '  '.repeat(depth);
      if (item.children && depth >= maxDepth) {
        const desc = countNodes(item.children);
        lines.push(`${indent}${item.name} (+${desc})`);
      } else {
        lines.push(`${indent}${item.name}`);
        if (item.children) walk(item.children, depth + 1);
      }
    }
  }
  walk(nodes, 0);
  return lines.join('\n');
}

function maxDirDepth(nodes, depth) {
  let max = depth;
  for (const n of nodes) {
    if (n.children && n.children.length) {
      max = Math.max(max, maxDirDepth(n.children, depth + 1));
    }
  }
  return max;
}

function listDir(input) {
  const dirPath = path.normalize(input.path || process.cwd());
  const tree = scanDir(dirPath);
  if (!tree.length) return '(空目录)';

  let depth = maxDirDepth(tree, 0);
  let result = renderDirTree(tree, depth + 1);
  while (result.length > LIST_MAX_CHARS && depth >= 0) {
    result = renderDirTree(tree, depth);
    depth--;
  }
  return result;
}

module.exports = [
  {
    name: 'file',
    description: `文件操作。对文件系统进行读取、写入、编辑、删除、列目录。

参数分两层——定位+操作：
定位（逐步圈定范围）：path指定文件/目录（绝对路径），lines圈定行范围，select圈定到文本中的某段。
操作：不传=读取，set=写入，delete=删除，list=列目录树。

示例：
  file(path="/a/b.js")                              → 读取整个文件
  file(path="/a/b.js", lines="10-20")               → 读取第10到20行
  file(path="/a/b.js", lines="50-")                  → 读取第50行到末尾
  file(path="/a/b.js", lines="50")                   → 只读第50行
  file(path="/a/b.js", set="全部内容")                → 整体重写（不存在则新建，自动创建目录）
  file(path="/a/b.js", select="旧代码", set="新代码")  → 局部替换（select必须精确匹配文件中的唯一子串，含空白和换行）
  file(path="/a/b.js", delete=true)                   → 删除文件
  file(path="/a/src", list=true)                      → 列出目录树（自动忽略node_modules/.git等，字数超限时从最深层逐层收起标注+N）

约束：
- 只能读文本文件。超过500行或30000字符自动裁剪，用lines参数分段读取。
- select匹配到多处会失败，需提供更多上下文使其唯一。
- set受单次输出token限制（约3000字），超出建议分步写入或用cmd生成。`,
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件或目录的绝对路径。如path="/project/src/index.js"' },
        lines: { type: 'string', description: '圈定行范围（1-based，含两端）。"10-20"=第10到20行，"50-"=第50行到末尾，"50"=只第50行' },
        select: { type: 'string', description: '圈定文件中的某段文本（精确匹配，含空白换行），配合set做局部替换。如select="old code", set="new code"' },
        set: { type: 'string', description: '写入。不传select=整体重写（文件不存在则新建），传select=替换匹配段' },
        delete: { type: 'boolean', description: '删除文件' },
        list: { type: 'boolean', description: '列出目录树。path指向目录，展示树形结构，自动忽略node_modules/.git等，字数超限时逐层收起' },
      },
      required: ['path'],
    },
    execute: async (input, ctrl) => {
      if (input.list) return listDir(input);
      if (input.delete) return deleteFile(input);
      if (input.set != null && input.select) return editFile(input);
      if (input.set != null) return writeFile(input);
      return readFile(input, ctrl);
    },
  },
];
