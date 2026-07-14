const path = require('path');
const fs = require('fs');
const { readEvents, writeEvent, fixOrphans } = require('./event');
const { infer } = require('./infer');
const { run } = require('./action');

const RETRYABLE = new Set([429, 500, 502, 503, 504, 529]);
const MAX_RETRIES = 5;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** 从错误消息中提取 HTTP status，判断是否可重试 */
function isRetryable(errors) {
  return errors.some(msg => {
    const m = String(msg).match(/\[(\d+)/);
    return m && RETRYABLE.has(Number(m[1]));
  });
}

async function* loop({ instanceDir, signal, hooks = {} }) {
  const eventsDir = path.join(instanceDir, 'events');

  // 启动时修复孤儿事件
  const orphans = fixOrphans(eventsDir);
  if (orphans) console.log(`[loop] Fixed ${orphans} orphan event(s) in ${instanceDir}`);

  let running = true;
  let waitMs = 0;
  let consecutiveErrors = 0;

  const ctrl = {
    stop: () => { running = false; },
    wait: (seconds) => { waitMs = seconds * 1000; },
    signal,
  };

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
    if (hooks.model) model = await hooks.model();
    else try { model = JSON.parse(fs.readFileSync(path.join(instanceDir, 'model.json'), 'utf-8')); } catch {}

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

    // ═══ 瞬时错误重试 ═══
    if (outcome === 'error' && isRetryable(errors) && consecutiveErrors < MAX_RETRIES) {
      consecutiveErrors++;
      const delay = Math.min(1000 * Math.pow(2, consecutiveErrors), 60000);
      console.error(`[loop] Retryable error, retrying in ${delay}ms (${consecutiveErrors}/${MAX_RETRIES})`);
      await sleep(delay);
      running = true;
      continue;
    }
    if (outcome !== 'error') consecutiveErrors = 0;

    if (waitMs > 0) {
      await sleep(waitMs);
      waitMs = 0;
    }

    if (!running && hooks.stop) await hooks.stop(restart);
  }
}

module.exports = { loop };
