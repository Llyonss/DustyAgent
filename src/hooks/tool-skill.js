const path = require('path');
const fs = require('fs');

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { meta: {}, body: content };
  const raw = match[1];
  const meta = {};
  let currentKey = null;
  for (const line of raw.split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (kv) {
      currentKey = kv[1];
      meta[currentKey] = kv[2].trim();
    } else if (currentKey && (line.startsWith('  ') || line.startsWith('\t'))) {
      meta[currentKey] += ' ' + line.trim();
    }
  }
  const body = content.slice(match[0].length).replace(/^\r?\n/, '');
  return { meta, body };
}

module.exports = function createSkillTool(workspaceDir) {
  const skillsDir = path.join(workspaceDir, 'skills');

  return {
    name: 'skill',
    description: `技能库。承载经过打磨的"怎么做事"最佳实践——别人踩过坑、验证过的专业流程。
技能安装目录：${skillsDir}
每个技能是一个子文件夹，内含 SKILL.md（入口）及可选的 scripts/、references/、assets/ 等资源。

【工作原则】
收到任务后、动手和思考方案之前，先 skill(list=true) 扫一眼有无相关技能。
有匹配的就 skill(load="name") 加载学习，然后按技能指导行事。
不查就动手=放着验证过的专业流程不用，自己从零摸索重新发明轮子。

用法：
- skill(list=true) — 列出所有已安装技能的名称和简介
- skill(load="name") — 加载技能的完整操作指令，加载后按指令行事

加载后需要读取技能内部文件（scripts/、references/等）时，用 file 工具直接访问技能目录。`,
    input_schema: {
      type: 'object',
      properties: {
        list: { type: 'boolean', description: '列出所有已安装技能' },
        load: { type: 'string', description: '加载指定技能（目录名）' },
      },
    },
    execute: async (input) => {
      // list mode
      if (input.list) {
        let dirs;
        try {
          dirs = fs.readdirSync(skillsDir, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name);
        } catch {
          return '技能库为空或目录不存在。';
        }

        const skills = [];
        for (const dir of dirs) {
          const skillMd = path.join(skillsDir, dir, 'SKILL.md');
          try {
            const content = fs.readFileSync(skillMd, 'utf-8');
            const { meta } = parseFrontmatter(content);
            const name = meta.name || dir;
            const desc = meta.description || '(无描述)';
            skills.push(`${name}\n  ${desc.length > 200 ? desc.slice(0, 200) + '...' : desc}`);
          } catch {
            // no SKILL.md, skip
          }
        }

        if (!skills.length) return '技能库为空。';
        return skills.join('\n\n');
      }

      // load mode
      if (input.load) {
        const skillDir = path.join(skillsDir, input.load);
        const skillMd = path.join(skillDir, 'SKILL.md');
        let content;
        try {
          content = fs.readFileSync(skillMd, 'utf-8');
        } catch {
          return `技能 "${input.load}" 不存在。使用 skill(list=true) 查看可用技能。`;
        }
        const { body } = parseFrontmatter(content);
        return `[技能目录: ${skillDir}]\n\n${body}`;
      }

      return '请使用 skill(list=true) 或 skill(load="name")。';
    },
  };
};
