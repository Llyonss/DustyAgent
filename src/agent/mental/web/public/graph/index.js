// === 力导向图 ===
// 职责：渲染和维护D3力导向图 — 蒲公英聚类模型
// 所有心智从统一虚拟根节点出发，子节点围绕父节点聚类。
// 默认只显示层级结构（父链接），hover节点时高亮邻域。

import { Content } from '../content/index.js';

// ── 常量 ──
const ROOT_NAME = '◆';

// ── 工具函数 ──

/** 计算层级深度（BFS从虚拟根），统计子节点数，构建邻域索引 */
function computeGraphMeta(nodes, parentEdges) {
  const childrenMap = {};
  const parentsMap = {};
  for (const n of nodes) {
    childrenMap[n.name] = [];
    parentsMap[n.name] = [];
  }

  for (const e of parentEdges) {
    const src = typeof e.source === 'string' ? e.source : (e.source?.name || e.source);
    const tgt = typeof e.target === 'string' ? e.target : (e.target?.name || e.target);
    if (!childrenMap[src]) childrenMap[src] = [];
    childrenMap[src].push(tgt);
    if (!parentsMap[tgt]) parentsMap[tgt] = [];
    parentsMap[tgt].push(src);
  }

  // BFS 从 ROOT_NAME 开始
  const depth = {};
  const queue = [ROOT_NAME];
  depth[ROOT_NAME] = 0;
  while (queue.length) {
    const cur = queue.shift();
    for (const child of (childrenMap[cur] || [])) {
      if (depth[child] === undefined) {
        depth[child] = depth[cur] + 1;
        queue.push(child);
      }
    }
  }
  for (const n of nodes) {
    if (depth[n.name] === undefined) depth[n.name] = 1; // 孤立节点挂在root下
  }

  // 子节点计数
  const childCount = {};
  for (const n of nodes) childCount[n.name] = 0;
  for (const e of parentEdges) {
    const src = typeof e.source === 'string' ? e.source : (e.source?.name || e.source);
    childCount[src] = (childCount[src] || 0) + 1;
  }

  // 邻域索引
  const neighbors = {};
  for (const n of nodes) neighbors[n.name] = new Set();
  for (const e of parentEdges) {
    const src = typeof e.source === 'string' ? e.source : (e.source?.name || e.source);
    const tgt = typeof e.target === 'string' ? e.target : (e.target?.name || e.target);
    if (neighbors[src]) neighbors[src].add(tgt);
    if (neighbors[tgt]) neighbors[tgt].add(src);
  }

  return { depth, childCount, childrenMap, parentsMap, neighbors };
}

function colorByDepth(d) {
  const palette = ['#555', '#e0a050', '#7c6fe0', '#5a9fd4', '#4ec9b0', '#6a9955'];
  return palette[Math.min(d, palette.length - 1)];
}

function radiusByChildren(count) {
  if (count >= 8) return 11;
  if (count >= 4) return 9;
  if (count >= 1) return 7;
  return 5;
}

// ── 主模块 ──

export const Graph = {
  sim: null,
  _nodeMeta: null,
  _neighbors: null,
  _weakEdges: null,

  render(data) {
    this._doRender(data);
  },

  _doRender(data) {
    const container = document.getElementById('graphView');
    const width = container.clientWidth || 600;
    const height = container.clientHeight || 400;
    const cx = width / 2;
    const cy = height / 2;

    if (this.sim) this.sim.stop();
    const svgEl = document.getElementById('graphSvg');
    svgEl.innerHTML = '';

    const svg = d3.select(svgEl).attr('width', width).attr('height', height);
    const g = svg.append('g');
    const zoom = d3.zoom().scaleExtent([0.1, 4]).on('zoom', (e) => g.attr('transform', e.transform));
    svg.call(zoom);

    const rawNodes = data.nodes;
    const rawEdges = data.edges;
    if (!rawNodes.length) return;

    // ── 构建增强数据：插入虚拟根节点 ──
    const rootNode = { name: ROOT_NAME, _virtual: true };
    // 找出所有无父节点的顶层心智
    const existingParents = new Set();
    for (const e of rawEdges) {
      if (e.parent) {
        const tgt = typeof e.target === 'string' ? e.target : (e.target?.name || e.target);
        existingParents.add(tgt);
      }
    }
    const rootEdges = [];
    for (const n of rawNodes) {
      if (!existingParents.has(n.name)) {
        rootEdges.push({ source: ROOT_NAME, target: n.name, parent: true });
      }
    }

    // 合并节点和边
    const nodes = [rootNode, ...rawNodes];
    const parentEdges = [
      ...rootEdges,
      ...rawEdges.filter(e => e.parent)
    ];
    const weakEdgesAll = rawEdges.filter(e => !e.parent);
    this._weakEdges = weakEdgesAll;

    // 类型转换：字符串 → 节点对象
    for (const e of parentEdges) {
      if (typeof e.source === 'string') e.source = nodes.find(n => n.name === e.source) || e.source;
      if (typeof e.target === 'string') e.target = nodes.find(n => n.name === e.target) || e.target;
    }
    for (const e of weakEdgesAll) {
      if (typeof e.source === 'string') e.source = nodes.find(n => n.name === e.source) || e.source;
      if (typeof e.target === 'string') e.target = nodes.find(n => n.name === e.target) || e.target;
    }

    // 计算元数据
    const { depth, childCount, neighbors: neighborSets } = computeGraphMeta(nodes, parentEdges);
    for (const e of weakEdgesAll) {
      const src = (typeof e.source === 'object' ? e.source?.name : e.source) || '';
      const tgt = (typeof e.target === 'object' ? e.target?.name : e.target) || '';
      if (neighborSets[src]) neighborSets[src].add(tgt);
      if (neighborSets[tgt]) neighborSets[tgt].add(src);
    }
    this._neighbors = neighborSets;

    const meta = {};
    for (const n of nodes) {
      if (n._virtual) {
        meta[n.name] = { r: 3, color: '#444', depth: 0 };
      } else {
        const d = depth[n.name] || 1;
        const r = radiusByChildren(childCount[n.name] || 0);
        const col = colorByDepth(d);
        meta[n.name] = { r, color: col, depth: d };
      }
    }
    this._nodeMeta = meta;

    // ── 力模拟：蒲公英聚类 ──
    const depthForce = (alpha) => {
      for (const n of nodes) {
        if (n._virtual) continue;
        const d = meta[n.name]?.depth || 1;
        let strength;
        if (d <= 1) strength = 0.18;
        else if (d === 2) strength = -0.02;
        else if (d === 3) strength = -0.04;
        else strength = -0.06;

        if (strength > 0) {
          n.vx += (cx - n.x) * strength * alpha;
          n.vy += (cy - n.y) * strength * alpha;
        } else if (strength < 0) {
          const dx = n.x - cx;
          const dy = n.y - cy;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          n.vx += (dx / dist) * (-strength) * alpha * 80;
          n.vy += (dy / dist) * (-strength) * alpha * 80;
        }
      }
    };

    // 边距
    for (const e of parentEdges) {
      e.distance = (e.source?._virtual || e.target?._virtual) ? 34 : 45;
    }

    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(parentEdges).id(d => d.name).distance(d => d.distance).strength(0.4))
      .force('charge', d3.forceManyBody().strength(d => d._virtual ? 0 : -120))
      .force('collision', d3.forceCollide(d => d._virtual ? 10 : (meta[d.name]?.r || 5) + 12))
      .force('depth', depthForce)
      .alphaDecay(0.015);

    // 虚拟根固定在中心
    rootNode.fx = cx;
    rootNode.fy = cy;

    // ── 渲染边 ──
    const parentLine = g.selectAll('.parent-edge').data(parentEdges).enter().append('line')
      .attr('class', 'parent-edge')
      .attr('stroke', d => (d.source?._virtual || d.target?._virtual) ? '#333' : '#444')
      .attr('stroke-width', d => (d.source?._virtual || d.target?._virtual) ? 1 : 1.5)
      .attr('stroke-dasharray', d => (d.source?._virtual || d.target?._virtual) ? '3,5' : 'none');

    const weakLine = g.selectAll('.weak-edge').data(weakEdgesAll).enter().append('line')
      .attr('class', 'weak-edge')
      .attr('stroke', '#2a2a3a').attr('stroke-width', 1).attr('stroke-dasharray', '2,6')
      .attr('opacity', 0);

    // ── 渲染节点 ──
    const node = g.selectAll('.node').data(nodes).enter().append('g')
      .attr('class', 'node').style('cursor', d => d._virtual ? 'default' : 'pointer')
      .on('click', (e, d) => {
        if (!d._virtual) Content.select(d.name);
      })
      .on('mouseenter', (e, d) => {
        if (!d._virtual) this._hoverIn(d.name);
      })
      .on('mouseleave', () => {
        this._hoverOut();
      })
      .call(d3.drag()
        .filter(d => !d._virtual)
        .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on('end', (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
      );

    // 圆形
    node.append('circle')
      .attr('r', d => meta[d.name]?.r || 5)
      .attr('fill', d => meta[d.name]?.color || '#7c6fe0')
      .attr('stroke', d => d._virtual ? 'transparent' : '#1a1a24')
      .attr('stroke-width', d => d._virtual ? 0 : 1)
      .attr('opacity', d => d._virtual ? 0.4 : 1);

    // 标签（虚拟根不显示标签）
    node.append('text')
      .text(d => d._virtual ? '' : d.name)
      .attr('dx', d => (meta[d.name]?.r || 5) + 5)
      .attr('dy', 4)
      .attr('fill', '#999')
      .attr('font-size', 11)
      .attr('font-family', 'inherit');

    // ── tick ──
    sim.on('tick', () => {
      parentLine
        .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
      weakLine
        .attr('x1', d => d.source?.x || 0).attr('y1', d => d.source?.y || 0)
        .attr('x2', d => d.target?.x || 0).attr('y2', d => d.target?.y || 0);
      node.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    this.sim = sim;
  },

  // ── Hover 交互 ──
  _hoverIn(name) {
    const neighborSet = this._neighbors?.[name] || new Set();
    const svgEl = d3.select('#graphSvg');

    svgEl.selectAll('.node')
      .attr('opacity', d => {
        if (d._virtual) return 0.15;
        if (d.name === name) return 1;
        if (neighborSet.has(d.name)) return 0.9;
        return 0.18;
      });

    svgEl.selectAll('.parent-edge')
      .attr('opacity', d => {
        const s = d.source?.name || d.source;
        const t = d.target?.name || d.target;
        if (s === ROOT_NAME || t === ROOT_NAME) return 0.12;
        if (s === name || t === name || (neighborSet.has(s) && neighborSet.has(t))) return 0.7;
        return 0.08;
      });

    svgEl.selectAll('.weak-edge')
      .attr('opacity', d => {
        const s = d.source?.name || d.source;
        const t = d.target?.name || d.target;
        return (s === name || t === name) ? 0.5 : 0;
      });
  },

  _hoverOut() {
    d3.select('#graphSvg').selectAll('.node').attr('opacity', d => d._virtual ? 0.4 : 1);
    d3.select('#graphSvg').selectAll('.parent-edge').attr('opacity', 1);
    d3.select('#graphSvg').selectAll('.weak-edge').attr('opacity', 0);
  },

  highlight(name) {
    if (!this._nodeMeta) return;
    d3.select('#graphSvg').selectAll('.node circle')
      .attr('fill', d => d.name === name ? '#ffcc00' : (this._nodeMeta[d.name]?.color || '#7c6fe0'))
      .attr('r', d => d.name === name
        ? (this._nodeMeta[d.name]?.r || 5) + 3
        : (this._nodeMeta[d.name]?.r || 5));
    d3.select('#graphSvg').selectAll('.node text')
      .attr('fill', d => d.name === name ? '#fff' : '#999')
      .attr('font-weight', d => d.name === name ? 'bold' : 'normal');
  }
};
