/**
 * Group raw events into structured groups for provider consumption.
 *
 * Returns array of:
 *   { type: 'user', parts: ['text1', 'text2'] }     — consecutive user inputs merged
 *   { type: 'turn', turn, actions: [...], followUp? } — assistant turn
 *
 * actions are raw action events: { tool, toolUseId, input, output }
 * followUp: if a user event immediately follows a tool-calling turn, it's absorbed here
 */
function groupEvents(events) {
  const groups = [];
  let i = 0;

  while (i < events.length) {
    const e = events[i];

    if (e.type === 'user') {
      const last = groups[groups.length - 1];
      if (last && last.type === 'user') {
        last.parts.push(e.content);
      } else {
        groups.push({ type: 'user', parts: [e.content] });
      }
      i++;
    } else if (e.type === 'action') {
      const turn = e.turn;
      const actions = [];
      while (i < events.length && events[i].type === 'action' && events[i].turn === turn) {
        actions.push(events[i]);
        i++;
      }
      const group = { type: 'turn', turn, actions };
      groups.push(group);

      // Absorb following user into turn (tool results + user input in same message)
      const hasTools = actions.some(a => a.tool !== 'speak' && a.tool !== 'thinking');
      if (hasTools && i < events.length && events[i].type === 'user') {
        group.followUp = events[i].content;
        i++;
      }
    } else {
      i++;
    }
  }

  // Ensure starts with user
  if (groups.length === 0 || groups[0].type !== 'user') {
    groups.unshift({ type: 'user', parts: ['(session started)'] });
  }

  return groups;
}

module.exports = { groupEvents };
