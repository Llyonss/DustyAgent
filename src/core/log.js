const fs = require('fs');
const path = require('path');

function writeLog(logDir, data) {
  fs.mkdirSync(logDir, { recursive: true });
  const ts = Date.now();
  const file = path.join(logDir, 'infer.' + ts + '.json');
  fs.writeFileSync(file, JSON.stringify({ ts, ...data }, null, 2));

  // Append usage to usage.json
  if (data.usage) {
    const usageFile = path.join(logDir, '..', 'usage.json');
    let entries = [];
    try {
      entries = JSON.parse(fs.readFileSync(usageFile, 'utf-8'));
    } catch (e) { /* file doesn't exist yet */ }
    entries.push({
      ts,
      duration: data.duration || 0,
      ...data.usage,
    });
    fs.writeFileSync(usageFile, JSON.stringify(entries, null, 2));
  }
}

module.exports = { writeLog };
