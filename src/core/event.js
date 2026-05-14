const fs = require('fs');
const path = require('path');

// ═══ 内部 ═══

function readConfig(instanceDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(instanceDir, '.dusty.json'), 'utf-8'));
  } catch {
    return null;
  }
}

function collectChain(instanceDir) {
  const dirs = [];
  const visited = new Set();
  let dir = instanceDir;

  while (dir) {
    const real = fs.realpathSync(dir);
    if (visited.has(real)) break;
    visited.add(real);
    dirs.unshift(dir);
    const config = readConfig(dir);
    dir = config?.fork ? path.resolve(dir, config.fork.instance) : null;
  }

  return dirs;
}

function readOneDir(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith('event.') && f.endsWith('.json'))
    .sort();
  return files.map(f => {
    const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
    data._file = f;
    return data;
  });
}

// ═══ 公开 ═══

function readEvents(instanceDir) {
  if (!fs.existsSync(instanceDir)) return [];
  const dirs = collectChain(instanceDir);

  return dirs.flatMap((dir, i) => {
    const events = readOneDir(path.join(dir, 'events'));
    if (i === dirs.length - 1) return events;

    const cutoff = readConfig(dirs[i + 1]).fork.at;
    return events.filter(e => e._file < cutoff);
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

/** 开始一个 action 事件，返回 handle */
function beginAction(eventsDir, { turn, tool, toolUseId, toInput }) {
  const { file } = writeEvent(eventsDir, {
    type: 'action', turn, tool, toolUseId,
    input:  toInput ? '' : {},
    output: toInput ? {} : '',
  });
  return { file, raw: '', toInput };
}

/** 增量追加 chunk */
function appendAction(handle, chunk) {
  handle.raw += chunk || '';
  const event = JSON.parse(fs.readFileSync(handle.file, 'utf-8'));
  handle.toInput ? event.input  = handle.raw
                 : event.output = handle.raw;
  fs.writeFileSync(handle.file, JSON.stringify(event, null, 2));
}

/** 闭合：写入最终 input/output */
function finishAction(handle, { input, output, error }) {
  const event = JSON.parse(fs.readFileSync(handle.file, 'utf-8'));
  if (input  != null) event.input  = input;
  if (output != null) event.output = output;
  if (error) event.error = true;
  fs.writeFileSync(handle.file, JSON.stringify(event, null, 2));
}

module.exports = { readEvents, writeEvent, beginAction, appendAction, finishAction };
