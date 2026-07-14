const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

let client, key;

function createStream(prompt, signal, extra, config) {
  const apiKey = config?.apiKey || process.env.LLM_API_KEY;
  const baseURL = config?.baseUrl || process.env.LLM_BASE_URL;
  const model = config?.model || process.env.LLM_MODEL;

  const k = `${apiKey}|${baseURL}`;
  if (!client || key !== k) {
    client = new Anthropic({ apiKey, baseURL });
    key = k;
  }
  return client.messages.create({
    model, max_tokens: 64000, eager_input_streaming: true,
    ...prompt, ...(extra || {}), stream: true,
  }, { signal });
}

function initCtx() { return { block: null, id: null, content: '', json: '', response: null, _rawUsage: {} }; }

function mapAnthropicUsage(raw) {
  const i = raw.input_tokens || 0, o = raw.output_tokens || 0;
  return {
    input_tokens: i,
    output_tokens: o,
    total_tokens: i + o,
    cache_read_input_tokens: raw.cache_read_input_tokens || 0,
    cache_creation_input_tokens: raw.cache_creation_input_tokens || 0,
  };
}

function buildMessages(groups, system, tools) {
  const messages = [];

  for (const g of groups) {
    if (g.type === 'user') {
      const last = messages.at(-1);
      if (last?.role === 'user') {
        for (const t of g.parts) last.content.push({ type: 'text', text: t });
      } else {
        messages.push({ role: 'user', content: g.parts.map(t => ({ type: 'text', text: t })) });
      }
      continue;
    }

    const blocks = [], toolActions = [];
    for (const a of g.actions) {
      if (a.tool === 'thinking' && a.output) { blocks.push({ type: 'thinking', thinking: String(a.output) }); continue; }
      if (a.tool === 'speak')    { blocks.push({ type: 'text', text: String(a.output || '') }); continue; }
      blocks.push({ type: 'tool_use', id: a.toolUseId, name: a.tool, input: a.input || {} });
      toolActions.push(a);
    }
    if (blocks.length) messages.push({ role: 'assistant', content: blocks });
    if (toolActions.length === 0) continue;

    const results = [];
    for (const a of toolActions) {
      const parts = Array.isArray(a.output) ? a.output : [{ type: 'text', text: String(a.output ?? '') }];
      results.push({
        type: 'tool_result', tool_use_id: a.toolUseId,
        content: parts.map(p =>
          p.type === 'image'
            ? { type: 'image', source: { type: 'base64', media_type: p.mimeType, data: p.data } }
            : { type: 'text', text: String(p.text || '') }
        ),
      });
    }
    if (g.followUp) results.push({ type: 'text', text: g.followUp });
    messages.push({ role: 'user', content: results });
  }

  let n = 0;
  for (let j = messages.length - 1; j >= 0 && n < 2; j--) {
    if (messages[j].role !== 'user' || messages[j].content.length === 0) continue;
    messages[j].content.at(-1).cache_control = { type: 'ephemeral', ttl: n ? '1h' : '5m' };
    n++;
  }

  const prompt = { messages };
  if (system) prompt.system = system;
  if (tools?.length) {
    prompt.tools = tools.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
    prompt.tools.at(-1).cache_control = { type: 'ephemeral', ttl: '1h' };
  }
  return prompt;
}

function* match(e, ctx) {

  if (e.type === 'message_start') {
    ctx.response = { id: e.message?.id, model: e.message?.model, usage: null };
    if (e.message?.usage) ctx._rawUsage = { ...e.message.usage };
    return;
  }

  // content_block_start → delta(start:true)
  // thinking 延迟 start 到首次 thinking_delta，避免 redacted thinking 产生空事件
  if (e.type === 'content_block_start') {
    ctx.block = e.content_block;
    ctx.id = ctx.block.id || `${ctx.block.type}_${e.index}`;
    ctx.content = '';
    ctx.json = '';
    if (ctx.block.type === 'thinking') return; // 延迟到 thinking_delta
    const tool = ctx.block.type === 'text' ? 'speak' : ctx.block.name;
    yield { type: 'delta', start: true, id: ctx.id, tool };
    return;
  }

  // thinking 增量（首次 emit start）
  if (e.type === 'content_block_delta' && e.delta.type === 'thinking_delta') {
    if (!ctx.content) yield { type: 'delta', start: true, id: ctx.id, tool: 'thinking' };
    ctx.content += e.delta.thinking;
    yield { type: 'delta', id: ctx.id, tool: 'thinking', content: e.delta.thinking };
    return;
  }

  // text 增量
  if (e.type === 'content_block_delta' && e.delta.type === 'text_delta') {
    ctx.content += e.delta.text;
    yield { type: 'delta', id: ctx.id, tool: 'speak', content: e.delta.text };
    return;
  }

  // json 增量
  if (e.type === 'content_block_delta' && e.delta.type === 'input_json_delta') {
    ctx.json += e.delta.partial_json;
    yield { type: 'delta', id: ctx.id, tool: ctx.block.name, content: e.delta.partial_json };
    return;
  }

  // tool_use 完成 → delta(done:true, input)
  if (e.type === 'content_block_stop' && ctx.block?.type === 'tool_use') {
    const name = ctx.block.name;
    let input = {};
    if (ctx.json) {
      try { input = JSON.parse(ctx.json); }
      catch (err) { ctx.block = null; yield { type: 'error', message: 'JSON parse error: ' + err.message }; return; }
    }
    ctx.block = null;
    yield { type: 'delta', done: true, id: ctx.id, tool: name, input };
    return;
  }

  // thinking 完成 → delta(done:true, output)（跳过空内容：redacted thinking 无 thinking_delta）
  if (e.type === 'content_block_stop' && ctx.block?.type === 'thinking') {
    if (ctx.content) yield { type: 'delta', done: true, id: ctx.id, tool: 'thinking', output: ctx.content };
    ctx.block = null;
    return;
  }

  // text 完成 → delta(done:true, output)
  if (e.type === 'content_block_stop' && ctx.block?.type === 'text') {
    if (ctx.content) yield { type: 'delta', done: true, id: ctx.id, tool: 'speak', output: ctx.content };
    ctx.block = null;
    return;
  }

  if (e.type === 'message_delta') {
    if (e.usage) Object.assign(ctx._rawUsage, e.usage);
    ctx.response.usage = mapAnthropicUsage(ctx._rawUsage);
    return;
  }
}

module.exports = { createStream, buildMessages, match, initCtx };
