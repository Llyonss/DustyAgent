require('dotenv').config();
const { groupEvents } = require('./prompt');

function formatError(e) {
  const tag = [e.status, e.error?.type].filter(Boolean).join(' ');
  return (tag ? `[${tag}] ` : '') + (e.message || String(e));
}

async function* infer(events, { system, tools, signal, extra, model } = {}) {
  const providerName = model?.provider || process.env.LLM_PROVIDER || 'anthropic';
  let provider;
  try { provider = require(`./providers/${providerName}`); }
  catch { provider = require('./providers/anthropic'); }
  const prompt = provider.buildMessages(groupEvents(events), system, tools);
  // request 快照：先放 infer 参数版 system/tools，再用 prompt 真正构建的字段覆盖。
  // prompt.messages 是纯消息数组；prompt.system/tools（若 provider 构建了）带 cache_control，更准确。
  yield { type: 'request', system, tools, ...prompt };

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
