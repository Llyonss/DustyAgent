const path = require('path');
const fs = require('fs');
const { readEvents, writeEvent } = require('./event');
const { infer } = require('./infer');
const { run } = require('./action');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function* loop({ instanceDir, signal, hooks = {} }) {
  const eventsDir = path.join(instanceDir, 'events');
  let running = true;
  let waitMs = 0;

  const ctrl = {
    stop: () => { running = false; },
    wait: (seconds) => { waitMs = seconds * 1000; },
    signal,
  };

  // restart：写一条"模拟 stop 工具调用、返回不能停的原因"的事件，重新点燃循环
  const restart = (reason) => {
    writeEvent(eventsDir, { type: 'action', turn: Date.now(), tool: 'stop', toolUseId: 'stop_' + Date.now(), input: {}, output: String(reason ?? '') });
    running = true;
  };

  while (running) {
    if (signal && signal.aborted) break;

    const events = readEvents(instanceDir);
    const filtered = hooks.events ? await hooks.events(events) : events;
    ctrl.events = filtered;
    const system = hooks.system ? hooks.system() : undefined;
    const instanceName = path.basename(instanceDir);
    const instanceInfo = { type: 'text', text: `\nInstance: ${instanceName}, instanceDir: ${instanceDir}` };
    const rawSystem = system || [];
    const fullSystem = [...rawSystem, instanceInfo];
    const tools = hooks.tools ? hooks.tools() : [];

    let model = {};
    try { model = JSON.parse(fs.readFileSync(path.join(instanceDir, 'model.json'), 'utf-8')); } catch {}

    const start = Date.now();
    const { response, errors, request, blocks, outcome, startedAt, endedAt } = await run(
      infer(filtered, { system: fullSystem, tools, signal, model }),
      eventsDir, ctrl, tools, signal, start
    );
    if (signal && signal.aborted) break;
    const duration = Date.now() - start;

    const resp = response || {};
    resp.start = start;
    resp.duration = duration;
    if (errors?.length) resp.errors = errors;
    resp.blocks = blocks || [];
    resp.outcome = outcome;

    const turn = { turn: start, request, response: resp, errors: errors || [], startedAt, endedAt, duration };
    if (hooks.output) hooks.output(turn);
    yield turn;

    if (waitMs > 0) {
      await sleep(waitMs);
      waitMs = 0;
    }

    // 本轮跑完已决定停 → 通知 hooks.stop，它可调 restart(reason) 续命
    if (!running && hooks.stop) await hooks.stop(restart);
  }
}

module.exports = { loop };
