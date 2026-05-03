const { readEvents } = require('../core/event');

const TOOL_DESC = `task: 语义化上下文折叠——所有工作的第一道工序。

【触发规则 — 必须遵守】
收到用户消息时，判断它是否构成一个"明确任务"（可完成的请求）。若是，你的第一个动作必须是 task(start=...)。这不是可选习惯，是强制规则。
"明确任务"包括但不限于：看文件、改代码、查资料、回答问题、分析设计、修改配置、写心智——几乎涵盖所有用户请求。唯一例外：用户发的是纯聊天/闲聊/问候。

【为什么必须用】
中间过程会被折叠为 conclusion+系统摘要，防止上下文腐化，让你能处理远超窗口限制的复杂工作。不用 task 包裹的工作会在未来上下文截断时丢失所有中间线索。

用法：
  task(start="任务名", requirement="任务目标与要求")
    → 干活...
  task(done="任务名", conclusion="结案陈词")

参数：
  start       — 任务名。声明任务开始。
  requirement — 任务目标与要求（start时必传）。写清要达成什么、边界在哪、验收标准是什么。
  done        — 任务名。闭合任务。
  conclusion  — 结案陈词（done时必传）。写给失忆的下一轮自己——它只能看到 requirement + conclusion，读完必须确信"不用再碰"。
              对照requirement：关键决策、产出物、验证方式。
              ❌ "重写了chat.js"（动作描述，读者会想：真的对吗？）
              ✅ "chat.js已重写，node --check通过，浏览器验证正常。需求4/4满足。"（断言+证据）

约束（违反会阻止操作）：
  - LIFO：done 的 title 必须等于栈顶（最近未闭合的 start 的 title），内层先闭合才能闭合外层
  - 同名不允许嵌套（A里面不能再start A）
  - commit 前所有任务必须闭合

done 时系统自动在事件中附加 summary（读了/写了/改了哪些文件、执行了哪些命令、含哪些子任务）。
你只需在 conclusion 中写关键决策、产出和验证证据，不需要罗列文件操作。

嵌套示例：
  task(start="重构用户模块", requirement="拆分user.ts为3个文件，接口不变")
    task(start="提取校验逻辑", requirement="把validate相关函数抽到user.validation.ts")
      ...干活...
    task(done="提取校验逻辑", conclusion="user.validation.ts已创建，含4个校验函数，原文件改为import调用，tsc编译通过。")
    ...继续干活...
  task(done="重构用户模块", conclusion="拆分完成：user.service.ts + user.validation.ts + user.types.ts。接口不变，全量测试通过(npm test 0 failures)。")
  → 折叠后LLM只看到外层start+done，内层子任务在summary中标注`;

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
    const events = readEvents(eventsDir);
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
    const events = readEvents(eventsDir);
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
