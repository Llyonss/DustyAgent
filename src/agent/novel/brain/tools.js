const path = require('path');
const fs = require('fs');
const { buildSnapshot, writeSnapshot, tryRead, scanMdFiles } = require('./context');
const { infer } = require('../../../core/infer');

module.exports = function(instanceDir) {
  return [
    {
      name: 'recall',
      description: `回忆工具。查找你对某文件最后一次 read/write 的记录，并顺序应用之后的 edit 操作，重建出你上次已知的文件完整状态。
也可用于查看从未直接读写过的文件（如 history/ 下的经历档案）。支持绝对路径或相对于小说目录的路径。`,
      input_schema: {
        type: 'object',
        properties: {
          file: { type: 'string', description: '文件路径（绝对路径或相对于小说目录）' },
        },
        required: ['file'],
      },
      execute: async (input) => {
        const filePath = path.isAbsolute(input.file)
          ? path.normalize(input.file)
          : path.normalize(path.join(instanceDir, input.file));
        const eventsDir = path.join(instanceDir, 'events');
        let files;
        try {
          files = fs.readdirSync(eventsDir)
            .filter(f => f.startsWith('event.') && f.endsWith('.json')).sort();
        } catch { return '未找到事件目录。'; }

        // Reverse scan: find last read/write for this file
        let baseContent = null;
        let baseIndex = -1;
        for (let i = files.length - 1; i >= 0; i--) {
          const evt = JSON.parse(fs.readFileSync(path.join(eventsDir, files[i]), 'utf-8'));
          if (evt.type !== 'action') continue;
          const ep = evt.input?.path ? path.normalize(evt.input.path) : null;
          if (ep !== filePath) continue;
          if (evt.tool === 'read' && typeof evt.output === 'string' && evt.output !== 'unchanged') {
            baseContent = evt.output;
            baseIndex = i;
            break;
          }
          if (evt.tool === 'write' && typeof evt.input?.content === 'string') {
            baseContent = evt.input.content;
            baseIndex = i;
            break;
          }
        }
        if (baseContent === null) {
          // Fallback: file exists but never read/written via tools (e.g. history files from commit)
          try { return fs.readFileSync(filePath, 'utf-8'); } catch {}
          return '未找到该文件的历史记录。';
        }

        // Forward scan: apply subsequent edits
        for (let i = baseIndex + 1; i < files.length; i++) {
          const evt = JSON.parse(fs.readFileSync(path.join(eventsDir, files[i]), 'utf-8'));
          if (evt.type !== 'action' || evt.tool !== 'edit' || evt.error) continue;
          const ep = evt.input?.path ? path.normalize(evt.input.path) : null;
          if (ep !== filePath) continue;
          const old = evt.input?.old, rep = evt.input?.new;
          if (typeof old === 'string' && typeof rep === 'string' && baseContent.includes(old)) {
            baseContent = baseContent.replace(old, rep);
          }
        }

        // Truncate like read tool
        const lines = baseContent.split('\n');
        let chars = 0, n = 0;
        for (; n < lines.length; n++) {
          chars += lines[n].length + 1;
          if (n + 1 >= 500 || chars >= 30000) { n++; break; }
        }
        if (n < lines.length) {
          return lines.slice(0, n).join('\n')
            + `\n[truncated: 1-${n} of ${lines.length} lines]`;
        }
        return baseContent;
      },
    },
    {
      name: 'commit',
      description: `提交当前会话。效果：
1. 自动将 title/story/changes 写入经历档案（history/vXX.md）
2. 从文件系统重新构建上下文快照
3. 之前的对话被截断（下一轮推理只看到 commit 之后的事件）

调用前请确保：
- 该更新的文件都已更新（大纲、实体、关联等）
- 已和用户确认可以 commit`,
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '一句话概述本次改动' },
          story: { type: 'string', description: '详细描述本次工作内容、讨论要点、关键决策' },
          changes: {
            type: 'array',
            items: { type: 'string' },
            description: '本轮改动的文件列表，如 ["outline.md", "world/entities/守一.md"]',
          },
        },
        required: ['title', 'changes'],
      },
      execute: async (input, ctrl) => {
        // 1. Auto-write history
        const historyDir = path.join(instanceDir, 'history');
        fs.mkdirSync(historyDir, { recursive: true });
        const existing = fs.readdirSync(historyDir).filter(f => f.endsWith('.md')).sort();
        const num = existing.length + 1;
        const pad = String(num).padStart(2, '0');
        const changesYaml = `[${input.changes.join(', ')}]`;
        const frontMatter = `---\ntitle: ${input.title}\nchanges: ${changesYaml}\n---\n`;
        const body = input.story || '';
        fs.writeFileSync(path.join(historyDir, `v${pad}.md`), frontMatter + body);

        // 2. Rebuild snapshot
        const snap = buildSnapshot(instanceDir);
        writeSnapshot(instanceDir, snap);

        // 3. Stop
        ctrl.stop();

        const stats = [];
        if (snap.entities.length) stats.push(`${snap.entities.length} entities`);
        if (snap.relations.length) stats.push(`${snap.relations.length} relations`);
        if (snap.chapters.length) stats.push(`${snap.chapters.length} chapters`);
        stats.push(`history v${pad}`);
        return `Committed. ${stats.join(', ')}. 查看右侧「经历档案」了解过往记录。`;
      },
    },
    {
      name: 'test_style',
      description: `文风测试。传入描写要求，工具内部自动加载大纲+活跃实体+当前 style.md，独立调 LLM 生成 demo 文本返回。
用于验证文风效果——修改 style.md 后调用此工具，展示给用户看效果。`,
      input_schema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '描写要求，如"写一段守一修钟的场景"' },
        },
        required: ['prompt'],
      },
      execute: async (input, ctrl) => {
        const outline = tryRead(path.join(instanceDir, 'outline.md')) || '';
        const style = tryRead(path.join(instanceDir, 'style.md')) || '';
        const entities = scanMdFiles(path.join(instanceDir, 'world', 'entities'))
          .filter(e => e.meta.status === 'active')
          .map(e => `### ${e.name}\n${e.body}`).join('\n\n');

        const ctx = [];
        if (outline) ctx.push(`## 大纲\n${outline}`);
        if (entities) ctx.push(`## 人物\n${entities}`);
        if (style) ctx.push(`## 写作要求\n${style}`);
        ctx.push(`## 描写要求\n${input.prompt}`);

        const prompt = {
          messages: [{ role: 'user', content: ctx.join('\n\n---\n\n') }],
          system: [{ type: 'text', text: '你是一位小说作家。根据提供的大纲、人物、写作要求，按描写要求写一段小说片段。只输出小说文本，不要解释。' }],
        };

        let text = '';
        const signal = ctrl.signal;
        for await (const evt of infer(prompt, { signal })) {
          if (evt.type === 'text_delta') text += evt.text;
          if (signal && signal.aborted) break;
        }

        return text || '(未生成内容)';
      },
    },
  ];
};
