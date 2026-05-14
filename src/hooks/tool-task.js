const { readEvents } = require('../core/event');

const TOOL_DESC = `收到用户消息（闲聊除外），第一步 task(start=...)，干活，最后 task(done=...)。

参数：
  start       — 任务名。声明任务开始。
  requirement — 任务目标与要求（start时必传）。写清要达成什么、为什么、验收标准。
  done        — 任务名。闭合任务。
  conclusion  — 结案陈词（done时必传）。写给失忆的下一轮——它只能看到 requirement+conclusion。写断言+证据：
              ❌ "重写了chat.js"
              ✅ "chat.js已重写，node --check通过，需求4/4满足。"
  result      — （旧名，同conclusion）

嵌套：
  task(start="A", requirement="...")
    task(start="B", requirement="...")
    task(done="B", conclusion="...")
  task(done="A", conclusion="...")
内层必须先闭合（LIFO）。异步任务内部可继续嵌套，支线间互相隔离。

约束（违反会阻止操作）：
  - start：全局不能有同名未闭合 task
  - done：必须是当前最内层未闭合 task（LIFO），且存在同名未闭合 task
  - commit 前所有 task 必须闭合

done 时系统自动附加 summary——这是系统从实际 tool 调用日志自动生成的、不可篡改的事实。信任它如同信任你亲眼看到的 tool 返回值。已折叠的 task 内部操作已被系统验证，不要重新读取文件或执行命令去确认。你只需在 conclusion 中写关键决策、产出和验证证据。`;

// 扫描事件流，返回未闭合 task 的名字集合，以及最近一个未闭合 task 的名字
function scanUnclosed(events) {
  const unclosed = new Set();
  const order = []; // 按 start 顺序记录名字，done 时移除
  for (const e of events) {
    if (e.type === 'action' && e.tool === 'task' && !e.error) {
      if (e.input?.start != null) {
        unclosed.add(e.input.start);
        order.push(e.input.start);
      }
      if (e.input?.done != null) {
        unclosed.delete(e.input.done);
        const idx = order.lastIndexOf(e.input.done);
        if (idx >= 0) order.splice(idx, 1);
      }
    }
  }
  const lastStart = order.length > 0 ? order[order.length - 1] : null;
  return { unclosed, lastStart };
}

// 获取未闭合 task 名字列表（供 commit 检查用）
function getUnclosedTasks(events) {
  const { unclosed } = scanUnclosed(events);
  return [...unclosed];
}

function execute(input, ctrl, eventsDir) {
  // --- start ---
  if (input.start != null) {
    if (!input.requirement) {
      throw new Error('start 时必须传 requirement（任务目标与要求）。');
    }
    const events = readEvents(path.dirname(eventsDir));
    // 排除最后一条事件——那是当前正在执行的 task 事件本身（action.js 在调用 execute 前已写入）
    const priorEvents = events.slice(0, -1);
    const { unclosed } = scanUnclosed(priorEvents);
    if (unclosed.has(input.start)) {
      const names = [...unclosed].join(' → ');
      throw new Error(`同名不允许嵌套。"${input.start}" 已在任务栈中（当前栈: ${names}）。`);
    }
    return 'started';
  }

  // --- done ---
  if (input.done != null) {
    if (!input.conclusion && !input.result) {
      throw new Error('done 时必须传 conclusion（结案陈词）。');
    }
    const events = readEvents(path.dirname(eventsDir));
    // 排除最后一条事件——那是当前正在执行的 task 事件本身（action.js 在调用 execute 前已写入）
    const priorEvents = events.slice(0, -1);
    const { unclosed, lastStart } = scanUnclosed(priorEvents);
    if (unclosed.size === 0) {
      throw new Error(`没有未闭合的任务，不能闭合"${input.done}"。`);
    }
    if (lastStart !== input.done) {
      throw new Error(`LIFO 约束。当前栈顶是"${lastStart}"，不能闭合"${input.done}"。请先闭合"${lastStart}"。`);
    }
    return 'done';
  }

  throw new Error('必须传 start 或 done。用法: task(start="任务名", requirement="...") 或 task(done="任务名", conclusion="...")');
}

module.exports = {
  name: 'task',
  description: TOOL_DESC,
  input_schema: {
    type: 'object',
    properties: {
      start: { type: 'string', description: '任务名。声明任务开始，需同时传 requirement。' },
      requirement: { type: 'string', description: '任务目标与要求（start时必传）。写清要达成什么、边界在哪。' },
      done: { type: 'string', description: '任务名。闭合任务，必须等于栈顶（LIFO）。需同时传 conclusion。' },
      conclusion: { type: 'string', description: '结案陈词（done时必传）。写给失忆的下一轮自己：对照requirement，断言当前状态+验证证据。读完必须确信不用再碰。' },
      result: { type: 'string', description: '（旧名，同conclusion）' },
    },
  },
  execute,
  getUnclosedTasks,
};
