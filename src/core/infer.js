require('dotenv').config();
const { groupEvents } = require('./prompt');

function formatError(e) {
  const tag = [e.status, e.error?.type].filter(Boolean).join(' ');
  return (tag ? `[${tag}] ` : '') + (e.message || String(e));
}

async function* infer(events, { system, tools, signal, extra, model } = {}) {
  const providerName = model?.provider || process.env.LLM_PROVIDER || 'anthropic';
  const provider = require(`./providers/${providerName}`);
  const prompt = provider.buildMessages(groupEvents(events), system, tools);
  yield { type: 'request', system, tools, messages: prompt };

  let stream;
  try { stream = await provider.createStream(prompt, signal, extra, model); }
  catch (e) { yield { type: 'error', message: formatError(e) }; return; }

  const ctx = provider.initCtx();

  try {
    for await (const e of stream) yield* provider.match(e, ctx);
  } catch (e) {
    if (signal?.aborted) return;
    yield { type: 'error', message: formatError(e) };
    return;
  }

  yield { type: 'response', ...(ctx.response || {}) };
}

module.exports = { infer, formatError };
