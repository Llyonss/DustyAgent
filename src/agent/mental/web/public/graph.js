// === Force-Directed Graph ===
const Graph = {
  sim: null,
  svg: null,
  g: null,
  zoom: null,
  data: { nodes: [], edges: [] },

  async load() {
    this.data = await (await fetch('/api/graph')).json();
    this.render();
  },

  render() {
    const container = document.getElementById('graphView');
    const width = container.clientWidth || 600;
    const height = container.clientHeight || 400;

    // Clear previous
    if (this.sim) this.sim.stop();
    const svgEl = document.getElementById('graphSvg');
    svgEl.innerHTML = '';

    this.svg = d3.select(svgEl).attr('width', width).attr('height', height);
    this.g = this.svg.append('g');

    // Zoom
    this.zoom = d3.zoom().scaleExtent([0.1, 4]).on('zoom', (e) => this.g.attr('transform', e.transform));
    this.svg.call(this.zoom);

    const { nodes, edges } = this.data;
    if (!nodes.length) return;

    // Only parent edges have force
    const parentEdges = edges.filter(e => e.parent);
    const weakEdges = edges.filter(e => !e.parent);

    // Simulation — parent links have strong force, all nodes pulled toward center
    this.sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(parentEdges).id(d => d.name).distance(100).strength(0.8))
      .force('charge', d3.forceManyBody().strength(-200))
      .force('x', d3.forceX(width / 2).strength(0.1))
      .force('y', d3.forceY(height / 2).strength(0.1))
      .force('collision', d3.forceCollide(40));

    // Draw weak edges (dashed, no force)
    const weakLine = this.g.selectAll('.weak-edge')
      .data(weakEdges).enter().append('line')
      .attr('class', 'weak-edge')
      .attr('stroke', '#333').attr('stroke-width', 1).attr('stroke-dasharray', '4,4');

    // Draw parent edges (solid)
    const parentLine = this.g.selectAll('.parent-edge')
      .data(parentEdges).enter().append('line')
      .attr('class', 'parent-edge')
      .attr('stroke', '#555').attr('stroke-width', 2);

    // Draw nodes
    const node = this.g.selectAll('.node')
      .data(nodes).enter().append('g')
      .attr('class', 'node')
      .style('cursor', 'pointer')
      .on('click', (e, d) => Mental.select(d.name))
      .call(d3.drag()
        .on('start', (e, d) => { if (!e.active) this.sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on('end', (e, d) => { if (!e.active) this.sim.alphaTarget(0); d.fx = null; d.fy = null; })
      );

    node.append('circle').attr('r', 6).attr('fill', '#7c6fe0');
    node.append('text').text(d => d.name).attr('dx', 10).attr('dy', 4)
      .attr('fill', '#999').attr('font-size', 12).attr('font-family', 'inherit');

    // Resolve weak edges source/target to node objects
    for (const e of weakEdges) {
      if (typeof e.source === 'string') e.source = nodes.find(n => n.name === e.source) || e.source;
      if (typeof e.target === 'string') e.target = nodes.find(n => n.name === e.target) || e.target;
    }

    this.sim.on('tick', () => {
      parentLine.attr('x1', d => d.source.x).attr('y1', d => d.source.y).attr('x2', d => d.target.x).attr('y2', d => d.target.y);
      weakLine.attr('x1', d => d.source?.x).attr('y1', d => d.source?.y).attr('x2', d => d.target?.x).attr('y2', d => d.target?.y);
      node.attr('transform', d => `translate(${d.x},${d.y})`);
    });
  },

  // Highlight a node
  highlight(name) {
    this.g?.selectAll('.node circle').attr('fill', d => d.name === name ? '#e0a050' : '#7c6fe0');
  },
};
