const fs = require('fs');
const path = require('path');

let pricing = null;
function getPricing() {
  if (pricing) return pricing;
  try {
    pricing = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'pricing.json'), 'utf-8'));
  } catch { pricing = {}; }
  return pricing;
}

function computeCost(usage, model) {
  if (!usage) return 0;
  const p = getPricing();
  // model may be "provider/model-name" — strip prefix
  const name = (model || '').split('/').pop();
  const price = p[name];
  if (!price) return 0;
  const input = usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  return +(input / 1e6 * price.input + output / 1e6 * price.output + cacheRead / 1e6 * (price.cache_read || 0) + cacheWrite / 1e6 * (price.cache_write || 0)).toFixed(6);
}

// 剥离图片 base64，换成占位，避免日志爆炸。
// 作用于整个 turn——request.messages 与 response.blocks 里的富 output 都可能含图片。
function stripImages(turn) {
  const replacer = (key, value) => {
    // Anthropic: { type:'image', source:{ type:'base64', media_type, data } }
    if (value && value.type === 'image' && value.source?.data) {
      return { ...value, source: { ...value.source, data: `<base64 ${value.source.media_type || 'image'} omitted>` } };
    }
    // OpenAI: { type:'image_url', image_url:{ url:'data:...;base64,...' } }
    if (value && value.type === 'image_url' && typeof value.image_url?.url === 'string' && value.image_url.url.startsWith('data:')) {
      const mime = value.image_url.url.slice(5).split(';')[0];
      return { ...value, image_url: { ...value.image_url, url: `<base64 ${mime} omitted>` } };
    }
    // 富 output 数组里的 { type:'image', data, mimeType }
    if (value && value.type === 'image' && typeof value.data === 'string' && !value.source) {
      return { ...value, data: `<base64 ${value.mimeType || 'image'} omitted>` };
    }
    return value;
  };
  // 深拷贝 + 替换整个 turn
  return JSON.parse(JSON.stringify(turn, replacer));
}

module.exports = function(instanceDir) {
  const logDir = path.join(instanceDir, 'logs');

  return {
    output: (turn) => {
      fs.mkdirSync(logDir, { recursive: true });
      const response = turn.response;
      // cost 算好挂回 response，让日志的 response 自带 cost（与 usage.json 一致）
      if (response?.usage) response.cost = computeCost(response.usage, response.model);

      // 用 turnId 命名，让一条 infer 日志能关联到同 turn 的 events 文件
      const id = turn.turn || Date.now();
      const file = path.join(logDir, 'infer.' + id + '.json');
      fs.writeFileSync(file, JSON.stringify(stripImages(turn), null, 2));

      if (response?.usage) {
        const usageFile = path.join(instanceDir, 'usage.json');
        let entries = [];
        try {
          entries = JSON.parse(fs.readFileSync(usageFile, 'utf-8'));
        } catch (e) { /* file doesn't exist yet */ }
        entries.push({
          turn: response.start,
          duration: response.duration || 0,
          model: response.model,
          ...(response.usage || {}),
          cost: response.cost,
        });
        fs.writeFileSync(usageFile, JSON.stringify(entries, null, 2));
      }
    },
  };
};
