const path = require('path');
const { readEvents } = require('./event');
const { buildMessages } = require('./prompt');
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
  };

  while (running) {
    if (signal && signal.aborted) break;

    const events = readEvents(eventsDir);
    const filtered = hooks.events ? hooks.events(events) : events;
    ctrl.events = filtered;
    const raw = buildMessages(filtered);
    const messages = hooks.messages ? hooks.messages(raw) : raw;
    const system = hooks.system ? hooks.system() : undefined;
    const tools = hooks.tools ? hooks.tools() : [];

    const prompt = { messages };
    if (system) prompt.system = system;
    if (tools.length > 0) {
      prompt.tools = tools.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
      prompt.tools.at(-1).cache_control = { type: 'ephemeral' };
    }

    const start = Date.now();
    const { output, usage, errors } = await run(infer(prompt, { signal }), eventsDir, ctrl, tools, signal);
    if (signal && signal.aborted) break;
    const duration = Date.now() - start;

    const turn = { prompt, output, usage, duration };
    if (errors && errors.length > 0) turn.errors = errors;
    if (hooks.output) hooks.output(turn);
    yield turn;

    if (waitMs > 0) {
      await sleep(waitMs);
      waitMs = 0;
    }
  }
}

module.exports = { loop };
