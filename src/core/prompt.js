function buildMessages(events) {
  const messages = [];
  let i = 0;

  while (i < events.length) {
    const e = events[i];

    if (e.type === 'user') {
      const last = messages[messages.length - 1];
      if (last && last.role === 'user') {
        last.content.push({ type: 'text', text: e.content });
      } else {
        messages.push({ role: 'user', content: [{ type: 'text', text: e.content }] });
      }
      i++;
    } else if (e.type === 'action') {
      const turn = e.turn;
      const actions = [];
      while (i < events.length && events[i].type === 'action' && events[i].turn === turn) {
        actions.push(events[i]);
        i++;
      }

      const assistantContent = [];
      const toolActions = [];
      for (const a of actions) {
        if (a.tool === 'speak') {
          assistantContent.push({ type: 'text', text: a.output });
        } else {
          assistantContent.push({ type: 'tool_use', id: a.toolUseId, name: a.tool, input: a.input });
          toolActions.push(a);
        }
      }

      messages.push({ role: 'assistant', content: assistantContent });

      if (toolActions.length > 0) {
        const toolResults = toolActions.map(a => ({
          type: 'tool_result',
          tool_use_id: a.toolUseId,
          content: String(a.output != null ? a.output : ''),
        }));

        if (i < events.length && events[i].type === 'user') {
          toolResults.push({ type: 'text', text: events[i].content });
          i++;
        }

        messages.push({ role: 'user', content: toolResults });
      }
    } else {
      i++;
    }
  }

  if (messages.length === 0 || messages[0].role !== 'user') {
    messages.unshift({ role: 'user', content: [{ type: 'text', text: '(session started)' }] });
  }

  // Cache control on last two user messages
  let cacheCount = 0;
  for (let j = messages.length - 1; j >= 0 && cacheCount < 2; j--) {
    if (messages[j].role === 'user' && messages[j].content.length > 0) {
      messages[j].content[messages[j].content.length - 1].cache_control = { type: 'ephemeral' };
      cacheCount++;
    }
  }

  return messages;
}

module.exports = { buildMessages };
