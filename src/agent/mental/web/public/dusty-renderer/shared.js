// === Dusty Shared ===
// 职责：全模块共享的工具函数与常量表

export const SVG_NS = 'http://www.w3.org/2000/svg';

// 泳道配色（按函数顺序轮转）
export const LANE_COLORS = ['#5bd4c5','#5b9fd4','#d4a05b','#b85bd4','#5bd47a','#d45b8e','#8ed45b','#d4c55b'];

// 流程块配色
export const WF_COLORS = {
  stmt:'#888', if:'#5b9fd4', loop:'#d4a05b', return:'#5bd47a',
  switch:'#b85bd4', try:'#5bd4c5', throw:'#d45b5b', jump:'#777',
};

// 柱子（actor）按类型配色
export const ACTOR_COLORS = { param:'#5b9fd4', local:'#5bd47a', external:'#d4a05b', effect:'#d45b5b' };

// 数据流箭头按方向配色
export const MSG_COLORS = { read:'#5b9fd4', write:'#5bd47a', effect:'#d45b5b' };

export const TYPE_ICON = { function: 'ƒ', method: 'M' };

// 容器配色（svg.js + interact.js 共用）
export const CONTAINER_COLORS = {
  branch: '#5b9fd4', loop: '#f07178', function: '#c792ea',
  try: '#f78c6c', catch: '#f78c6c', finally: '#f78c6c',
  callback: '#ffb347',
  ifelse: '#6a7d8e', trycatch: '#8a7d9e'
};

export const CONTAINER_FILLS = {
  branch: 'rgba(91,159,212,0.04)', loop: 'rgba(240,113,120,0.04)',
  function: 'rgba(199,146,234,0.04)', try: 'rgba(247,140,108,0.04)',
  catch: 'rgba(247,140,108,0.04)', finally: 'rgba(247,140,108,0.04)',
  callback: 'rgba(255,179,71,0.04)',
  ifelse: 'rgba(106,125,142,0.03)', trycatch: 'rgba(138,125,158,0.03)'
};

export const CONTAINER_ICONS = {
  branch: '\u25C7', loop: '\u21BB', function: '\u0192',
  try: '\u26A0', catch: '\u2191', finally: '\u2193',
  callback: '\u21B3',
  ifelse: '\u25C6', trycatch: '\u25C7'
};

function defaultEsc(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// 取转义函数：优先用宿主页面注入的 window.esc
export function getEsc(escFn) {
  if (escFn) return escFn;
  return (typeof window !== 'undefined' && window.esc) ? window.esc : defaultEsc;
}

// 创建带属性的 SVG 元素
export function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}
