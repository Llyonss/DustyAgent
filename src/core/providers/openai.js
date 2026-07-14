const OpenAI = require('openai');
require('dotenv').config();

let client, key;

function createStream(prompt, signal, extra, config) {
  const apiKey = config?.apiKey || process.env.LLM_API_KEY;
  const baseURL = config?.baseUrl || process.env.LLM_BASE_URL || undefined;
  const model = config?.model || process.env.LLM_MODEL;

  const k = `${apiKey}|${baseURL}`;
  if (!client || key !== k) {
    client = new OpenAI({ apiKey, baseURL });
    key = k;
  }
  const params = {
    model, stream: true, stream_options: { include_usage: true },
    messages: prompt.messages, ...(extra || {}),
  };
  if (prompt.tools) params.tools = prompt.tools;
  return client.chat.completions.create(params, { signal });
}

function initCtx() {
  return {
    tools: new Map(),
    text: '', thinking: '',
    textId: 'speak_' + Date.now(), thinkId: 'thinking_' + Date.now(),
    response: null,
  };
}

function buildMessages(groups, system, tools) {
  const messages = [];

  if (system?.length) {
    const text = system.filter(b => b.type === 'text').map(b => b.text).join('\n');
    if (text) messages.push({ role: 'system', content: text });
  }

  for (const g of groups) {
    if (g.type === 'user') { messages.push({ role: 'user', content: g.parts.join('\n') }); continue; }

    const textParts = [], thinkingParts = [], toolCalls = [], toolActions = [];
    for (const a of g.actions) {
      if (a.tool === 'thinking' && a.output) { thinkingParts.push(String(a.output)); continue; }
      if (a.tool === 'speak')    { textParts.push(String(a.output || '')); continue; }
      toolCalls.push({ id: a.toolUseId, type: 'function', function: { name: a.tool, arguments: JSON.stringify(a.input || {}) } });
      toolActions.push(a);
    }

    const msg = { role: 'assistant', content: textParts.join('\n') || '' };
    if (thinkingParts.length) msg.reasoning_content = thinkingParts.join('\n');
    if (toolCalls.length) msg.tool_calls = toolCalls;
    messages.push(msg);

    const pending = [];
    for (const a of toolActions) {
      let text = '';
      if (!Array.isArray(a.output)) {
        text = String(a.output ?? '');
        messages.push({ role: 'tool', tool_call_id: a.toolUseId, content: text });
        continue;
      }
      for (const p of a.output) {
        if (p.type === 'image') { pending.push({ type: 'image_url', image_url: { url: `data:${p.mimeType};base64,${p.data}` } }); continue; }
        text += p.text + '\n';
      }
      messages.push({ role: 'tool', tool_call_id: a.toolUseId, content: text.trimEnd() });
    }
    if (pending.length || g.followUp) {
      const userContent = [...pending];
      if (g.followUp) userContent.push({ type: 'text', text: g.followUp });
      messages.push({ role: 'user', content: userContent.length === 1 && userContent[0].type === 'text' ? userContent[0].text : userContent });
    }
  }

  let oaiTools;
  if (tools?.length) oaiTools = tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  return { messages, tools: oaiTools };
}

function mapUsage(u) {
  return {
    input_tokens: u.prompt_tokens || 0,
    output_tokens: u.completion_tokens || 0,
    total_tokens: u.total_tokens || 0,
    cache_read_input_tokens: u.prompt_cache_hit_tokens || u.prompt_tokens_details?.cached_tokens || 0,
    cache_creation_input_tokens: u.prompt_cache_miss_tokens || 0,
  };
}

function* match(e, ctx) {
  if (!e.choices?.[0]) {
    if (e.usage) ctx.response = { id: e.id, model: e.model, usage: mapUsage(e.usage) };
    return;
  }

  const d = e.choices[0].delta || {};

  // thinking 增量
  const r = d.reasoning_content || d.reasoning;
  if (r) {
    if (!ctx.thinking) yield { type: 'delta', start: true, id: ctx.thinkId, tool: 'thinking' };
    ctx.thinking += r;
    yield { type: 'delta', id: ctx.thinkId, tool: 'thinking', content: r };
  }

  // speak 增量
  if (d.content) {
    if (!ctx.text) yield { type: 'delta', start: true, id: ctx.textId, tool: 'speak' };
    ctx.text += d.content;
    yield { type: 'delta', id: ctx.textId, tool: 'speak', content: d.content };
  }

  // tool_call 增量
  for (const tc of d.tool_calls || []) {
    let t = ctx.tools.get(tc.index);
    if (!t) {
      t = { id: tc.id || `tool_${tc.index}_${Date.now()}`, name: tc.function?.name || '', args: '' };
      ctx.tools.set(tc.index, t);
      yield { type: 'delta', start: true, id: t.id, tool: t.name };
    }
    if (tc.function?.arguments) {
      t.args += tc.function.arguments;
      yield { type: 'delta', id: t.id, tool: t.name, content: tc.function.arguments };
    }
  }

  if (!e.choices[0].finish_reason) return;

  // 块完成
  if (ctx.thinking) yield { type: 'delta', done: true, id: ctx.thinkId, tool: 'thinking', output: ctx.thinking };
  if (ctx.text) yield { type: 'delta', done: true, id: ctx.textId, tool: 'speak', output: ctx.text };

  for (const t of ctx.tools.values()) {
    let input = {};
    if (t.args) { try { input = JSON.parse(t.args); } catch (err) { yield { type: 'error', message: 'JSON parse error: ' + err.message }; continue; } }
    yield { type: 'delta', done: true, id: t.id, tool: t.name, input };
  }
}

module.exports = { createStream, buildMessages, match, initCtx };
