const os = require('os');
const path = require('path');
const { getToolDefinitions } = require('./tool');

const SYSTEM_PROMPT = `You are a ReAct agent. You accomplish tasks by using tools.

Rules:
- Output text to communicate with the user. You can output text and call tools in the same response.
- Call 'stop' when you have completed the task or need to wait for user input.
- Be direct and efficient. Call multiple independent tools in parallel when possible.`;

const ENV_INFO = `\nEnvironment: ${os.platform()}/${os.arch()}, shell: ${os.platform() === 'win32' ? 'cmd.exe' : process.env.SHELL || '/bin/sh'}, cwd: ${process.cwd()}`;

function build(events) {
  const system = [{ type: 'text', text: SYSTEM_PROMPT + ENV_INFO, cache_control: { type: 'ephemeral' } }];
  const messages = buildMessages(events);
  const tools = getToolDefinitions();
  tools[tools.length - 1].cache_control = { type: 'ephemeral' };
  return { system, messages, tools };
}

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

      // Build assistant content: text blocks for speak, tool_use for tools
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

      // Only add tool_results for actual tool calls (not speak)
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

  const lastMsg = messages[messages.length - 1];
  if (lastMsg && lastMsg.role === 'user' && lastMsg.content.length > 0) {
    lastMsg.content[lastMsg.content.length - 1].cache_control = { type: 'ephemeral' };
  }

  return messages;
}

module.exports = { build };
