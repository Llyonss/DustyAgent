// === Dusty Parse / Markers ===
// 职责：按 // dusty-begin / dusty-end 注释把源码切成 card / raw 段
// 纯函数，零依赖
// 输出：[{ type: 'card'|'raw', content: string }, ...]

const BEGIN_RE = /^\s*\/\/\s*dusty-begin\s*$/;
const END_RE   = /^\s*\/\/\s*dusty-end\s*$/;

export function parseMarkers(text) {
  if (!text) return [];

  const lines = text.split('\n');
  const segments = [];
  let rawBuf = [];
  let cardBuf = [];
  let inCard = false;

  const flushRaw = () => {
    if (rawBuf.length) { segments.push({ type: 'raw', content: rawBuf.join('\n') }); rawBuf = []; }
  };
  const flushCard = () => {
    if (cardBuf.length) { segments.push({ type: 'card', content: cardBuf.join('\n') }); cardBuf = []; }
  };

  for (const line of lines) {
    if (BEGIN_RE.test(line)) { flushRaw(); inCard = true; cardBuf = []; continue; }
    if (END_RE.test(line))   { flushCard(); inCard = false; continue; }
    if (inCard) cardBuf.push(line);
    else        rawBuf.push(line);
  }

  if (inCard) flushCard();   // 未闭合 begin → 剩余作为 card
  flushRaw();
  return segments;
}

export function hasMarkers(text) {
  return !!text && /\/\/\s*dusty-begin/.test(text);
}
