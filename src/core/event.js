const fs = require('fs');
const path = require('path');

function readEvents(eventsDir) {
  if (!fs.existsSync(eventsDir)) return [];
  const files = fs.readdirSync(eventsDir)
    .filter(f => f.startsWith('event.') && f.endsWith('.json'))
    .sort();
  return files.map(f => {
    const data = JSON.parse(fs.readFileSync(path.join(eventsDir, f), 'utf-8'));
    data._file = f;
    return data;
  });
}

function writeEvent(eventsDir, event) {
  fs.mkdirSync(eventsDir, { recursive: true });
  const ts = Date.now();
  event.ts = ts;
  let sub = 0;
  let file;
  do {
    file = path.join(eventsDir, `event.${ts}.${sub}.json`);
    sub++;
  } while (fs.existsSync(file));
  fs.writeFileSync(file, JSON.stringify(event, null, 2));
  return { ts, file };
}

module.exports = { readEvents, writeEvent };