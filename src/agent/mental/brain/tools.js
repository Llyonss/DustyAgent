const path = require('path');
const fs = require('fs');

module.exports = function(instanceDir, mentalRoot) {
  const roomsDir = path.join(mentalRoot, 'rooms');
  const historyDir = path.join(instanceDir, 'history');

  function resolveMd(name) {
    if (!name) return path.join(instanceDir, 'self.md');
    return path.join(roomsDir, name + '.md');
  }

  function resolveLinks(name) {
    if (!name) return path.join(instanceDir, 'self.links');
    return path.join(roomsDir, name + '.links');
  }

  function tryRead(p) {
    try { return fs.readFileSync(p, 'utf-8'); } catch { return null; }
  }

  function normalizeEndings(s) { return s.replace(/\r\n/g, '\n'); }
  function normalizeQuotes(s) { return s.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'"); }

  function doEdit(filePath, old, replacement) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    let content = normalizeEndings(raw);
    old = normalizeEndings(old);
    replacement = normalizeEndings(replacement);

    let matchOld = old;
    if (!content.includes(old)) {
      const nc = normalizeQuotes(content), no = normalizeQuotes(old);
      if (nc.includes(no)) {
        const idx = nc.indexOf(no);
        matchOld = content.substring(idx, idx + old.length);
      } else {
        const snippet = old.length > 200 ? old.substring(0, 200) + '...' : old;
        throw new Error(`text not found. String: "${snippet}"`);
      }
    }
    const matches = content.split(matchOld).length - 1;
    if (matches > 1) throw new Error(`found ${matches} matches. Provide more context.`);
    content = content.replace(matchOld, replacement);
    fs.writeFileSync(filePath, content);
  }

  return [
    {
      name: 'mental',
      description: `房间操作。读取时自动附带走廊(links)。不传name=操作自己的私有房间，传name=操作全局房间。

读取房间：只传 name（或不传）。返回房间内容 + 走廊列表。
创建/重写房间：传 content。
局部修改：传 old + new。
删除房间：传 delete=true（同时删除走廊文件）。`,
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '房间名。不传=自己的私有房间' },
          content: { type: 'string', description: '完整内容（全量写入）' },
          old: { type: 'string', description: '要查找的精确文本' },
          new: { type: 'string', description: '替换文本' },
          delete: { type: 'boolean', description: '删除房间' },
        },
      },
      execute: async (input) => {
        const mdPath = resolveMd(input.name);
        const linksPath = resolveLinks(input.name);

        if (input.delete) {
          try { fs.unlinkSync(mdPath); } catch {}
          try { fs.unlinkSync(linksPath); } catch {}
          return 'ok';
        }

        if (input.content != null) {
          fs.mkdirSync(path.dirname(mdPath), { recursive: true });
          fs.writeFileSync(mdPath, input.content);
          return 'ok';
        }

        if (input.old != null && input.new != null) {
          doEdit(mdPath, input.old, input.new);
          return 'ok';
        }

        // Read mode: content + links
        const md = tryRead(mdPath);
        if (md == null) return input.name ? `房间 "${input.name}" 不存在。` : '私有房间为空。';
        const links = tryRead(linksPath);
        if (links) return md + '\n\n---\n' + links;
        return md;
      },
    },
    {
      name: 'links',
      description: `走廊操作。不传name=操作自己的走廊，传name=操作全局房间的走廊。
走廊格式：每行一条 "目标房间名: 简介标签"。

读取走廊：只传 name（或不传）。
创建/重写走廊：传 content。
局部修改：传 old + new。
删除走廊：传 delete=true。`,
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '房间名。不传=自己的走廊' },
          content: { type: 'string', description: '完整走廊列表' },
          old: { type: 'string', description: '要查找的精确文本' },
          new: { type: 'string', description: '替换文本' },
          delete: { type: 'boolean', description: '删除走廊文件' },
        },
      },
      execute: async (input) => {
        const linksPath = resolveLinks(input.name);

        if (input.delete) {
          try { fs.unlinkSync(linksPath); } catch {}
          return 'ok';
        }

        if (input.content != null) {
          fs.mkdirSync(path.dirname(linksPath), { recursive: true });
          fs.writeFileSync(linksPath, input.content);
          return 'ok';
        }

        if (input.old != null && input.new != null) {
          doEdit(linksPath, input.old, input.new);
          return 'ok';
        }

        const links = tryRead(linksPath);
        return links || '(无走廊)';
      },
    },
    {
      name: 'commit',
      description: `提交经历。效果：
1. 将 title + story + entities 写入经历档案
2. 之前的对话被截断（下轮推理只看 commit 之后的事件）
3. 隐式停止当前循环

commit 前确保相关房间已更新。`,
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '一句话标题' },
          story: { type: 'string', description: '详细叙事' },
          entities: {
            type: 'array',
            items: { type: 'string' },
            description: '涉及的房间名列表',
          },
        },
        required: ['title', 'story'],
      },
      execute: async (input, ctrl) => {
        fs.mkdirSync(historyDir, { recursive: true });
        const existing = fs.readdirSync(historyDir).filter(f => f.endsWith('.md')).sort();
        const num = existing.length + 1;
        const pad = String(num).padStart(3, '0');

        const entitiesLine = input.entities && input.entities.length
          ? `\nentities: [${input.entities.join(', ')}]` : '';
        const frontMatter = `---\ntitle: ${input.title}${entitiesLine}\n---\n`;
        fs.writeFileSync(path.join(historyDir, `${pad}.md`), frontMatter + (input.story || ''));

        ctrl.stop();
        return `Committed v${num}: ${input.title}`;
      },
    },
    {
      name: 'history',
      description: `浏览经历。倒序列出 commit 记录。
可按实体过滤（只看涉及某房间的经历）。
offset/limit 控制分页（默认 offset=0, limit=10）。`,
      input_schema: {
        type: 'object',
        properties: {
          entity: { type: 'string', description: '按房间名过滤' },
          offset: { type: 'number', description: '跳过前N条（默认0）' },
          limit: { type: 'number', description: '返回条数（默认10）' },
        },
      },
      execute: async (input) => {
        let files;
        try {
          files = fs.readdirSync(historyDir).filter(f => f.endsWith('.md')).sort();
        } catch { return '暂无经历。'; }

        // Parse all commits
        const commits = files.map(f => {
          const raw = fs.readFileSync(path.join(historyDir, f), 'utf-8');
          const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
          const meta = {};
          if (m) {
            for (const line of m[1].split('\n')) {
              const kv = line.match(/^(\w+):\s*(.+)$/);
              if (!kv) continue;
              let val = kv[2].trim();
              if (val.startsWith('[') && val.endsWith(']')) {
                val = val.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
              }
              meta[kv[1]] = val;
            }
          }
          return { file: f, title: meta.title || f, entities: meta.entities || [], story: m ? m[2] : raw };
        });

        // Filter by entity
        let filtered = commits;
        if (input.entity) {
          filtered = commits.filter(c =>
            Array.isArray(c.entities) && c.entities.includes(input.entity)
          );
        }

        // Reverse (newest first), paginate
        filtered.reverse();
        const offset = input.offset || 0;
        const limit = input.limit || 10;
        const page = filtered.slice(offset, offset + limit);

        if (page.length === 0) return input.entity ? `未找到涉及 "${input.entity}" 的经历。` : '暂无经历。';

        const lines = page.map((c, i) => {
          const idx = filtered.length - offset - i;
          const ents = Array.isArray(c.entities) && c.entities.length ? ` [${c.entities.join(', ')}]` : '';
          return `v${idx}: ${c.title}${ents}\n  ${c.story.substring(0, 200)}${c.story.length > 200 ? '...' : ''}`;
        });

        const total = filtered.length;
        const header = `经历 ${offset + 1}-${offset + page.length} / ${total}` + (input.entity ? ` (过滤: ${input.entity})` : '');
        return header + '\n\n' + lines.join('\n\n');
      },
    },
  ];
};
