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

module.exports = function(instanceDir) {
  const logDir = path.join(instanceDir, 'logs');

  return {
    output: (turn) => {
      fs.mkdirSync(logDir, { recursive: true });
      const ts = Date.now();
      const file = path.join(logDir, 'infer.' + ts + '.json');
      fs.writeFileSync(file, JSON.stringify({ ts, ...turn }, null, 2));

      const response = turn.response;
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
          cost: computeCost(response.usage, response.model),
        });
        fs.writeFileSync(usageFile, JSON.stringify(entries, null, 2));
      }
    },
  };
};
