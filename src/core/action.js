const { writeEvent, beginAction, appendAction, finishAction } = require('./event');

async function executeTool(name, input, ctrl, tools, eventsDir) {
  const tool = tools.find(t => t.name === name);
  if (!tool) return { output: 'Unknown tool: ' + name, error: true };
  try {
    const output = await tool.execute(input, ctrl, eventsDir);
    return { output, error: false };
  } catch (e) {
    return { output: 'Error: ' + e.message, error: true };
  }
}

async function run(stream, eventsDir, ctrl, tools, signal, turnId) {
  const turn = turnId || Date.now();
  const startedAt = Date.now();
  const errors = [];
  const blocks = [];          // 本轮模型产出，按块顺序收集
  let response = null;
  let request = null;
  let hasToolCalls = false;
  let blockCount = 0;
  const active = new Map();
  const blockOf = new Map();  // id → blocks 数组里的引用
  const pendingTools = [];    // { handle, block, name, input } — 流消费完后并行执行

  function executable(name) { return tools.some(t => t.name === name); }

  for await (const evt of stream) {
    if (signal?.aborted) break;

    // ═══ δ(start) ═══
    if (evt.type === 'delta' && evt.start) {
      const isExec = executable(evt.tool);
      const handle = beginAction(eventsDir, { turn, tool: evt.tool, toolUseId: evt.id, toInput: isExec });
      active.set(evt.id, handle);
      const type = isExec ? 'tool_use' : (evt.tool === 'thinking' ? 'thinking' : 'speak');
      const block = { type };
      if (isExec || evt.tool === 'thinking') block.tool = evt.tool;
      blocks.push(block);
      blockOf.set(evt.id, block);
      continue;
    }

    // ═══ δ(done) ═══
    if (evt.type === 'delta' && evt.done) {
      const handle = active.get(evt.id);
      const block = blockOf.get(evt.id);

      blockCount++;
      if (executable(evt.tool)) {
        hasToolCalls = true;
        finishAction(handle, { input: evt.input });
        // 不阻塞流：推入队列，流消费完后并行执行
        pendingTools.push({ handle, block, name: evt.tool, input: evt.input });
      } else {
        const content = evt.output != null ? evt.output : handle.raw;
        finishAction(handle, { output: content });
        if (block) block.content = content;
      }
      active.delete(evt.id);
      blockOf.delete(evt.id);
      continue;
    }

    // ═══ δ(增量) ═══
    if (evt.type === 'delta') {
      const handle = active.get(evt.id);
      if (!handle) continue;
      appendAction(handle, evt.content);
      continue;
    }

    // ═══ request ═══
    if (evt.type === 'request') {
      request = evt;
      continue;
    }

    // ═══ response ═══
    if (evt.type === 'response') {
      response = evt;
      continue;
    }

    // ═══ error ═══
    if (evt.type === 'error') {
      errors.push(evt.message);
      console.error('Error:', evt.message);
      writeEvent(eventsDir, { type: 'error', message: evt.message });
      ctrl.stop();
      continue;
    }
  }

  // ═══ 流消费完毕 → 并行执行所有工具 ═══
  if (pendingTools.length > 0) {
    const results = await Promise.all(
      pendingTools.map(async ({ handle, block, name, input }) => {
        const result = await executeTool(name, input, ctrl, tools, eventsDir);
        finishAction(handle, { output: result.output, error: result.error || undefined });
        if (block) { block.input = input; block.output = result.output; if (result.error) block.error = true; }
        return result;
      })
    );
    for (const r of results) {
      if (r.error) errors.push(r.output);
    }
  }

  let outcome;
  if (!hasToolCalls) {
    if (blockCount === 0 && response?.usage) {
      const msg = 'Empty response from API';
      errors.push(msg);
      console.error('Error:', msg);
      writeEvent(eventsDir, { type: 'error', message: msg });
      outcome = 'empty';
    } else {
      outcome = 'stop';
    }
    ctrl.stop();
  } else {
    outcome = 'continue';
  }
  if (errors.length) outcome = 'error';

  return { response, errors, request, blocks, outcome, startedAt, endedAt: Date.now() };
}

module.exports = { run };
