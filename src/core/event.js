const fs = require('fs');
const path = require('path');

// ═══ 缓存 ═══
// 事件文件不可变（写完不再改），天然适合按文件名缓存。
// 流式写入中的文件由 finishAction 主动失效。
const _cache = new Map();

function _cachedRead(file) {
  const stat = fs.statSync(file);
  const entry = _cache.get(file);
  if (entry && entry.mtime === stat.mtimeMs) return entry.data;
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  _cache.set(file, { mtime: stat.mtimeMs, data });
  return data;
}

function _cacheInvalidate(file) {
  _cache.delete(file);
}

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
    const data = _cachedRead(path.join(dir, f));
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
  return { file, raw: '', toInput, _flushed: false };
}

/** 增量追加 chunk — 纯内存累积，不读盘不写盘 */
function appendAction(handle, chunk) {
  handle.raw += chunk || '';
}

/** 闭合：写入最终 input/output，失效缓存 */
function finishAction(handle, { input, output, error } = {}) {
  const event = JSON.parse(fs.readFileSync(handle.file, 'utf-8'));
  if (input  != null) event.input  = input;
  if (output != null) event.output = output;
  if (error) event.error = true;
  fs.writeFileSync(handle.file, JSON.stringify(event, null, 2));
  _cacheInvalidate(handle.file);
}

/** 检测并修复孤儿事件：有 tool_use input 但 output 为空的 action */
function fixOrphans(eventsDir) {
  if (!fs.existsSync(eventsDir)) return 0;
  const files = fs.readdirSync(eventsDir)
    .filter(f => f.startsWith('event.') && f.endsWith('.json'))
    .sort();

  let fixed = 0;
  for (const f of files) {
    const filePath = path.join(eventsDir, f);
    let event;
    try { event = JSON.parse(fs.readFileSync(filePath, 'utf-8')); }
    catch { continue; }
    if (event.type !== 'action') continue;
    if (event.tool === 'speak' || event.tool === 'thinking') continue;

    const hasInput = event.input && (typeof event.input === 'object'
      ? Object.keys(event.input).length > 0
      : String(event.input).length > 0);
    const hasOutput = event.output && (typeof event.output === 'object'
      ? Object.keys(event.output).length > 0
      : String(event.output).length > 0);

    if (hasInput && !hasOutput) {
      event.output = '[interrupted: process crashed during execution]';
      event.error = true;
      fs.writeFileSync(filePath, JSON.stringify(event, null, 2));
      _cacheInvalidate(filePath);
      fixed++;
    }
  }
  return fixed;
}

module.exports = { readEvents, writeEvent, beginAction, appendAction, finishAction, fixOrphans };
