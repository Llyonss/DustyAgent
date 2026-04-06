const fs = require('fs');
const path = require('path');

module.exports = function(instanceDir) {
  const logDir = path.join(instanceDir, 'logs');

  return {
    output: (turn) => {
      fs.mkdirSync(logDir, { recursive: true });
      const ts = Date.now();
      const file = path.join(logDir, 'infer.' + ts + '.json');
      fs.writeFileSync(file, JSON.stringify({ ts, ...turn }, null, 2));

      if (turn.usage) {
        const usageFile = path.join(instanceDir, 'usage.json');
        let entries = [];
        try {
          entries = JSON.parse(fs.readFileSync(usageFile, 'utf-8'));
        } catch (e) { /* file doesn't exist yet */ }
        entries.push({
          ts,
          duration: turn.duration || 0,
          ...turn.usage,
        });
        fs.writeFileSync(usageFile, JSON.stringify(entries, null, 2));
      }
    },
  };
};
