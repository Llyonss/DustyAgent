const fs = require('fs');
const path = require('path');

function tryRead(p) {
  try { return fs.readFileSync(p, 'utf-8'); } catch { return null; }
}

function parseFrontMatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: content };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (!kv) continue;
    let val = kv[2].trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      val = val.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
    }
    meta[kv[1]] = val;
  }
  return { meta, body: m[2] };
}

function loadHistories(instanceDir) {
  const historyDir = path.join(instanceDir, 'history');
  try {
    return fs.readdirSync(historyDir)
      .filter(f => f.endsWith('.md'))
      .sort()
      .map(f => {
        const raw = fs.readFileSync(path.join(historyDir, f), 'utf-8');
        const { meta, body } = parseFrontMatter(raw);
        return { file: f, title: meta.title || f, entities: meta.entities || [], story: body };
      });
  } catch { return []; }
}

/**
 * Build experience text with folding:
 * - Last 5: title + story (truncated to ~200 chars)
 * - 5-20: title only
 * - 20+: merged in groups of 5
 */
function buildExperienceText(histories) {
  if (histories.length === 0) return null;
  const lines = [];
  const total = histories.length;

  for (let i = 0; i < total; i++) {
    const h = histories[i];
    const vNum = i + 1;
    const distFromEnd = total - i;

    if (distFromEnd <= 5) {
      // Recent: title + story preview
      const preview = h.story ? h.story.substring(0, 200).replace(/\n/g, ' ') : '';
      lines.push(`v${vNum}: ${h.title}${preview ? '\n  ' + preview + (h.story.length > 200 ? '...' : '') : ''}`);
    } else if (distFromEnd <= 20) {
      // Middle: title only
      lines.push(`v${vNum}: ${h.title}`);
    } else {
      // Old: merge groups of 5
      if ((i % 5) === 0) {
        const group = histories.slice(i, Math.min(i + 5, total - 20));
        if (group.length > 0) {
          const titles = group.map(g => g.title).join('; ');
          lines.push(`v${i + 1}-v${i + group.length}: ${titles}`);
        }
      }
    }
  }

  return lines.join('\n');
}

function buildContextMessages(instanceDir) {
  const selfMd = tryRead(path.join(instanceDir, 'self.md'));
  const selfLinks = tryRead(path.join(instanceDir, 'self.links'));
  const histories = loadHistories(instanceDir);
  const prefix = [];

  // Experience injection
  if (histories.length > 0) {
    const expText = buildExperienceText(histories);
    if (expText) {
      prefix.push(
        { role: 'user', content: [{ type: 'text', text: '过往经历\n' + expText }] },
        { role: 'assistant', content: [{ type: 'text', text: '收到。' }] },
      );
    }
  }

  // Private room + links injection
  const parts = [];
  if (selfMd) parts.push(selfMd);
  if (selfLinks) parts.push('---\n' + selfLinks);
  const roomText = parts.join('\n\n') || '(空)';

  prefix.push(
    { role: 'user', content: [{ type: 'text', text: '请根据以下心智模型行动:\n<心智>\n' + roomText + '\n</心智>' }] },
    { role: 'assistant', content: [{ type: 'text', text: '好的, 我会以我的心智模型独立思考并行动, 以心智模型为主去审视吸收信息, 并多和用户讨论, 持续学习成长。' }] },
  );

  return prefix;
}

module.exports = { buildContextMessages, loadHistories, tryRead, parseFrontMatter };
