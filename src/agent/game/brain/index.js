const path = require('path');
const fs = require('fs');
const gameTools = require('./tools');
const toolLoop = require('../../../hooks/tool-loop');
const toolCmd = require('../../../hooks/tool-cmd');
const toolFile = require('../../../hooks/tool-file');
const toolMedia = require('../../../hooks/tool-media');
const { tools: eyeTools, injectEyeEvents } = require('../../../hooks/tool-eye');
const createLog = require('../../../hooks/output-log');

function loadSkills(instanceDir) {
  const dir = path.join(instanceDir, 'skills');
  if (!fs.existsSync(dir)) return '';
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort();
  if (!files.length) return '';
  return files.map(f => {
    const name = f.replace(/\.md$/, '');
    const content = fs.readFileSync(path.join(dir, f), 'utf-8').trim();
    return `## ${name}\n${content}`;
  }).join('\n\n---\n\n');
}

module.exports = function(instanceDir) {
  const log = createLog(instanceDir);
  const tools = [...gameTools, ...toolMedia, ...eyeTools, ...toolFile, ...toolCmd, ...toolLoop];

  return {
    system: () => {
      const skills = loadSkills(instanceDir);
      let s = `你是游戏素材助手。用户描述需要的素材，你按技能方法生成和处理。

# 行为准则

## 用工具，不写脚本
- 去背景用 removeBg 工具（默认AI模式，语义分割，无需关心背景颜色）
- 切割用 split 工具
- 抽帧用 extract 工具
- 看图用 eye 工具（不要用 cmd 调 python 看图片属性）
- 禁止用 cmd/file 写 Python 脚本做这些工具已有的功能

## 先确认，再执行
- 生图/生视频很贵，先和用户对齐需求再生成
- 每一步完成后展示结果，让用户决定下一步
- 效果不好时展示问题让用户选方案，不要自作主张重做

## 精简高效
- think 控制在关键决策点，不要反复自我对话
- speak 简洁，说重点，不要罗列自己的思考过程`;
      if (skills) s += '\n\n# 技能\n\n' + skills;
      return [{ type: 'text', text: s, cache_control: { type: 'ephemeral', ttl: '1h' } }];
    },

    tools: () => tools,

    events: async (events) => injectEyeEvents(events),

    output: (turn) => log.output(turn),
  };
};
