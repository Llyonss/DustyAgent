/**
 * Task folding — LIFO stack matching, summary generation, intermediate event removal.
 * Pure function: foldTasks(events) → events
 */

function isTaskStart(e) {
  return e.type === 'action' && e.tool === 'task' && e.input?.start != null && !e.error;
}

function isTaskDone(e) {
  return e.type === 'action' && e.tool === 'task' && e.input?.done != null && !e.error;
}

function extractCmdName(command) {
  if (!command || typeof command !== 'string') return null;
  const trimmed = command.trim();
  const parts = trimmed.split(/\s+/);
  const first = parts[0];
  const basename = first.replace(/^.*[/\\]/, '');
  return basename || first;
}

/**
 * Generate summary from intermediate events.
 * Also detects sub-tasks (adjacent task_start + task_done with matching title).
 */
function generateSummary(events) {
  const readFiles = [];
  const wroteFiles = [];
  const modifiedFiles = [];
  const deletedFiles = [];
  const commands = [];
  const subtasks = [];

  let i = 0;
  while (i < events.length) {
    const e = events[i];

    // Detect sub-task: adjacent task_start and task_done with matching title
    if (isTaskStart(e) && i + 1 < events.length && isTaskDone(events[i + 1])
        && e.input.start === events[i + 1].input.done) {
      const title = e.input.start;
      const conclusion = events[i + 1].input.conclusion || events[i + 1].input.result || '';
      const shortResult = conclusion.length > 40 ? conclusion.substring(0, 40) + '...' : conclusion;
      subtasks.push(`${title}(${shortResult})`);
      i += 2;
      continue;
    }

    if (e.type === 'action') {
      // File operations
      if (e.tool === 'file' && e.input) {
        const p = e.input.path;
        if (p) {
          const fname = p.replace(/^.*[/\\]/, '');
          if (e.input.delete) {
            deletedFiles.push(fname);
          } else if (e.input.select != null && e.input.set != null) {
            modifiedFiles.push(fname);
          } else if (e.input.set != null) {
            wroteFiles.push(fname);
          } else {
            readFiles.push(fname);
          }
        }
      }

      // Command executions
      if (e.tool === 'cmd' && e.input?.command) {
        const name = extractCmdName(e.input.command);
        if (name && !commands.includes(name)) {
          commands.push(name);
        }
      }
    }

    i++;
  }

  const parts = [];
  if (readFiles.length) parts.push(`读了 ${readFiles.join(', ')}`);
  if (wroteFiles.length) parts.push(`写了 ${wroteFiles.join(', ')}`);
  if (modifiedFiles.length) parts.push(`改了 ${modifiedFiles.join(', ')}`);
  if (deletedFiles.length) parts.push(`删了 ${deletedFiles.join(', ')}`);
  if (commands.length) parts.push(`执行了 ${commands.join(', ')}`);
  if (subtasks.length) parts.push(`子任务: ${subtasks.join('; ')}`);

  return parts.length ? parts.join(' | ') : '(无文件/命令操作)';
}

function spliceTurns(result, fromIdx, toIdx, keep) {
  const toRemove = [];
  for (let j = fromIdx; j < toIdx; j++) {
    const turn = result[j].turn;
    if (turn == null) continue; // 保留 user/error 等无 turn 事件
    if (!keep.has(turn)) toRemove.push(j);
  }
  for (let j = toRemove.length - 1; j >= 0; j--) {
    result.splice(toRemove[j], 1);
  }
}

/**
 * Fold matched task_start/task_done pairs in events.
 * Folds at turn granularity — a turn is the smallest indivisible unit of an LLM call.
 */
function foldTasks(events) {
  if (!events || events.length === 0) return events;

  const result = [];
  const order = [];       // [{ title, startIdx, turn }]
  const pairedTurns = new Set();

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    result.push(e);

    if (isTaskStart(e)) {
      order.push({ title: e.input.start, startIdx: result.length - 1, turn: e.turn });
    }

    if (isTaskDone(e)) {
      const matchIdx = order.length - 1 >= 0
        ? order.map((o, idx) => ({ ...o, idx })).reverse().find(o => o.title === e.input.done)
        : null;

      if (matchIdx && matchIdx.idx === order.length - 1) {
        const { startIdx, turn: startTurn } = matchIdx;
        const endIdx = result.length - 1;
        const endTurn = e.turn;

        const intermediate = result.slice(startIdx + 1, endIdx);
        const summary = generateSummary(intermediate);

        result[endIdx].output = (result[endIdx].output || '') + '\n[折叠摘要: ' + summary + ']';

        // 保留 start/done turn + 已配对子task turn + user消息后紧跟的agent回复turn
        const keep = new Set([startTurn, endTurn, ...pairedTurns]);
        // 扫描 intermediate：user 消息之后紧跟的第一个有 turn 的事件 → 保留该 turn
        for (let j = startIdx + 1; j < endIdx; j++) {
          if (result[j].type === 'user' || result[j].type === 'error') {
            for (let k = j + 1; k < endIdx; k++) {
              if (result[k].turn != null) { keep.add(result[k].turn); break; }
            }
          }
        }
        spliceTurns(result, startIdx + 1, endIdx, keep);

        pairedTurns.add(startTurn);
        pairedTurns.add(endTurn);
        order.pop();
      }
    }
  }

  return result;
}

module.exports = { foldTasks, generateSummary, isTaskStart, isTaskDone };
