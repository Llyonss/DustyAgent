const path = require('path');
const { readEvents } = require('./event');
const { build } = require('./prompt');
const { infer } = require('./infer');
const { run } = require('./action');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function needsInfer(events) {
  if (events.length === 0) return false;
  const last = events[events.length - 1];
  return last.type === 'user' ||
    (last.type === 'action' && last.tool !== 'stop' && last.tool !== 'wait');
}

async function* loop({ instanceDir, signal }) {
  const eventsDir = path.join(instanceDir, 'events');
  let running = true;
  let waitMs = 0;

  const ctrl = {
    stop: () => { running = false; },
    wait: (seconds) => { waitMs = seconds * 1000; },
  };

  while (running) {
    const events = readEvents(eventsDir);
    if (!needsInfer(events)) break;

    const prompt = build(events);
    const start = Date.now();
    if (signal && signal.aborted) break;
    const { output, usage } = await run(infer(prompt, { signal }), eventsDir, ctrl);
    const duration = Date.now() - start;

    yield { prompt, output, usage, duration };

    if (waitMs > 0) {
      await sleep(waitMs);
      waitMs = 0;
    }
  }
}

module.exports = { loop };
