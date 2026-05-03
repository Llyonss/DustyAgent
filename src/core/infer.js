require('dotenv').config();
const { groupEvents } = require('./prompt');

function formatError(e) {
  const tag = [e.status, e.error?.type].filter(Boolean).join(' ');
  return (tag ? `[${tag}] ` : '') + (e.message || String(e));
}

async function* infer(events, { system, tools, signal, extra } = {}) {
  const provider = require(`./providers/${process.env.LLM_PROVIDER || 'anthropic'}`);
  const prompt = provider.buildMessages(groupEvents(events), system, tools);

  let stream;
  try { stream = await provider.createStream(prompt, signal, extra); }
  catch (e) { yield { type: 'error', message: formatError(e) }; return; }

  const ctx = provider.initCtx();

  try {
    for await (const e of stream) yield* provider.match(e, ctx);
  } catch (e) {
    if (signal?.aborted) return;
    yield { type: 'error', message: formatError(e) };
    return;
  }

  yield { type: 'usage', usage: ctx.usage };
}

module.exports = { infer, formatError };
