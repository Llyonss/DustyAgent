const fs = require('fs');
const path = require('path');

function normalizeEndings(s) {
  return s.replace(/\r\n/g, '\n');
}

module.exports = function(docPath, draftPath) {
  return [
    {
      name: 'mental',
      description: '展示当前草稿的心智内容。',
      input_schema: {
        type: 'object',
        properties: {
            reason: { type: 'string', description: '原因' },
        },
        required: [],
      },
      execute: async () => {
        try { return fs.readFileSync(draftPath, 'utf-8') || '(empty)'; }
        catch { try { return fs.readFileSync(docPath, 'utf-8') || '(empty)'; } catch { return '(empty)'; } }
      },
    },
    {
      name: 'init',
      description: `全量重写心智。用 content 参数传入完整的新内容。
仅用于首次创建或大幅重写时。写完后调用 commit 记录版本。`,
      input_schema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Complete new document content' },
        },
        required: ['content'],
      },
      execute: async (input) => {
        fs.mkdirSync(path.dirname(draftPath), { recursive: true });
        fs.writeFileSync(draftPath, input.content);
        return 'Document written (full rewrite). Call commit when done.';
      },
    },
    {
      name: 'study',
      description: `增量修改心智。用 old（精确子串）和 new（替换文本）指定改动。
old 必须精确匹配草稿中的文本。匹配到多处会失败，需提供更多上下文。
改完后调用 commit 记录版本。

注意：init/study 操作的是工作草稿（draft），而非对话中 <document> 标签展示的正式版本。
如果本轮已执行过 init/study，后续 study 要基于修改后的草稿内容。
study 失败时，先用 read 工具读取草稿文件获取最新内容，再重新构造 study。`,
      input_schema: {
        type: 'object',
        properties: {
          old: { type: 'string', description: 'Exact substring to find in current document' },
          new: { type: 'string', description: 'Replacement text' },
        },
        required: ['old', 'new'],
      },
      execute: async (input) => {
        let raw;
        try {
          raw = fs.readFileSync(draftPath, 'utf-8');
        } catch (e) {
          throw new Error('cannot read document for patching: ' + e.message);
        }
        const useCRLF = raw.includes('\r\n');
        let doc = normalizeEndings(raw);
        const old = normalizeEndings(input.old);
        const replacement = normalizeEndings(input.new);

        if (!doc.includes(old)) {
          const snippet = old.length > 200 ? old.substring(0, 200) + '...' : old;
          throw new Error('text not found in document: "' + snippet + '"');
        }
        const matches = doc.split(old).length - 1;
        if (matches > 1) {
          const snippet = old.length > 200 ? old.substring(0, 200) + '...' : old;
          throw new Error('found ' + matches + ' matches in document. Provide more context to uniquely identify the target: "' + snippet + '"');
        }
        doc = doc.replace(old, replacement);
        if (useCRLF) doc = doc.replace(/\n/g, '\r\n');
        fs.writeFileSync(draftPath, doc);
        return 'Document patched. Call commit when done.';
      },
    },
    {
      name: 'commit',
      description: `提交当前心智版本。用 summary 参数描述本版改动。
提交后草稿会被提升为正式版本，对话历史被截断（之前的对话将不可见）。
因此心智 + summary 必须完整承载本版讨论的所有信息。
完成所有 init/study 操作后再调用此工具。`,
      input_schema: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Brief summary of changes in this version' },
        },
        required: ['summary'],
      },
      execute: async (input, ctrl) => {
        // Promote draft to committed doc
        if (fs.existsSync(draftPath)) {
          fs.copyFileSync(draftPath, docPath);
          fs.unlinkSync(draftPath);
        }
        ctrl.stop();
        return 'Version committed: ' + input.summary;
      },
    },
  ];
};
