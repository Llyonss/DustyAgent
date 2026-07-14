// === Dusty Render / SVG ===
  // JS dataflow -> SVG string
  // string concatenation, no template literals
import { SVG_NS, CONTAINER_COLORS, CONTAINER_FILLS, CONTAINER_ICONS } from '../shared.js';

var PALETTE = [
  '#ff6b81','#4ecdc4','#ffe66d','#a855f7','#f97316',
  '#06b6d4','#84cc16','#ec4899','#f43f5e','#0ea5e9',
  '#fbbf24','#8b5cf6','#10b981','#ef4444','#3b82f6'
];

function esc(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function renderSVG(nodes, edges, containers, positions, containerPositions, escFn, nodeLines) {
  try {
    return buildSVG(nodes, edges, containers, positions, containerPositions, escFn, nodeLines);
  } catch(e) {
    return '<div class="dusty-raw" style="color:#d45b5b">SVG render failed: ' + esc(e.message) + '</div>';
  }
}

function buildSVG(nodes, edges, containers, positions, containerPositions, escFn, nodeLines) {
  var userEsc = escFn || esc;

    // ---- variable name -> color ----
  var variableColors = {};
  var allVariableNames = collectVariableNames(nodes);
  for (var vi = 0; vi < allVariableNames.length; vi++) {
    variableColors[allVariableNames[vi]] = PALETTE[vi % PALETTE.length];
  }

    // ---- canvas size ----
  var maxX = 800, maxY = 400;
  for (var key in positions) {
    if (!positions.hasOwnProperty(key)) continue;
    var pos = positions[key];
    if (pos.x + pos.w + 80 > maxX) maxX = pos.x + pos.w + 80;
    if (pos.y + pos.h + 80 > maxY) maxY = pos.y + pos.h + 80;
  }
  for (var ck in containerPositions) {
    if (!containerPositions.hasOwnProperty(ck)) continue;
    var cpos = containerPositions[ck];
    if (cpos.x + cpos.w + 40 > maxX) maxX = cpos.x + cpos.w + 40;
    if (cpos.y + cpos.h + 40 > maxY) maxY = cpos.y + cpos.h + 40;
  }

  // node lookup
  var nodeLookup = {};
  for (var ni = 0; ni < nodes.length; ni++) {
    nodeLookup[nodes[ni].id] = nodes[ni];
  }

    // ---- build SVG ----
  var parts = [];

    // average node width (viewBox units), for interact.js small-node check
  var avgNodeW = 0;
  if (nodes.length) {
    var sumW = 0, countW = 0;
    for (var key in positions) {
      if (positions.hasOwnProperty(key)) { sumW += positions[key].w; countW++; }
    }
    avgNodeW = countW > 0 ? sumW / countW : 160;
  }

  parts.push('<div class="df-container"><svg class="df-svg" data-avg-node-w="' + Math.round(avgNodeW) + '" width="' + maxX + '" height="' + maxY + '" viewBox="0 0 ' + maxX + ' ' + maxY + '" xmlns="' + SVG_NS + '">');

  // defs
  parts.push('<defs>');
  parts.push('<pattern id="df-dots" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">');
  parts.push('<circle cx="12" cy="12" r="1" fill="rgba(255,255,255,0.04)"/>');
  parts.push('</pattern>');
  parts.push('<filter id="df-shadow" x="-20%" y="-20%" width="140%" height="140%">');
  parts.push('<feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.4"/>');
  parts.push('</filter>');
  parts.push('<filter id="df-glow" x="-60%" y="-60%" width="220%" height="220%">');
  parts.push('<feGaussianBlur stdDeviation="2.5" result="blur"/>');
  parts.push('<feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>');
  parts.push('</filter>');

  // 绠ご鏍囪
  for (var varName in variableColors) {
    if (!variableColors.hasOwnProperty(varName)) continue;
    var color = variableColors[varName];
    var safeName = varName.replace(/[^a-zA-Z0-9]/g, '_');
    parts.push('<marker id="df-arr-' + safeName + '" markerWidth="7" markerHeight="5" refX="6" refY="2.5" orient="auto">');
    parts.push('<path d="M0,0 L7,2.5 L0,5 Z" fill="' + color + '"/>');
    parts.push('</marker>');
  }
  parts.push('</defs>');

    // background
  parts.push('<rect x="0" y="0" width="' + maxX + '" height="' + maxY + '" fill="#0c0c16"/>');
  parts.push('<rect x="0" y="0" width="' + maxX + '" height="' + maxY + '" fill="url(#df-dots)"/>');

    // ---- containers ----
  var sortedByDepth = sortContainersByDepth(containers);
  for (var sci = 0; sci < sortedByDepth.length; sci++) {
    var container = sortedByDepth[sci];
    var containerBounds = containerPositions[container.id];
    if (!containerBounds) continue;

    var containerColor = CONTAINER_COLORS[container.type] || '#666';
    var containerFill = CONTAINER_FILLS[container.type] || 'rgba(255,255,255,0.02)';
    var containerIcon = CONTAINER_ICONS[container.type] || '';
    var containerLabel = containerIcon + ' ' + userEsc(container.label || '');
    var isShell = container.type === 'ifelse' || container.type === 'trycatch';

    parts.push('<rect x="' + containerBounds.x + '" y="' + containerBounds.y
      + '" width="' + containerBounds.w + '" height="' + containerBounds.h
      + '" fill="' + containerFill + '" stroke="' + containerColor
      + '" stroke-opacity="' + (isShell ? '0.18' : '0.35')
      + '" stroke-width="' + (isShell ? '0.8' : '1.2')
      + '" stroke-dasharray="' + (isShell ? 'none' : '5 4')
      + '" rx="' + (isShell ? '6' : '10') + '" class="df-container-rect"/>');

    var labelWidth = (container.label || '').length * 7.5 + 24;
    var labelFontSize = isShell ? '9.5' : '10.5';
    var labelFontWeight = isShell ? '600' : '700';
    var labelOpacity = isShell ? '0.1' : '0.15';
    parts.push('<rect x="' + (containerBounds.x + 8) + '" y="' + (containerBounds.y - 1)
      + '" width="' + labelWidth + '" height="22" rx="5" fill="' + containerColor + '" fill-opacity="' + labelOpacity + '"/>');
    parts.push('<text x="' + (containerBounds.x + 16) + '" y="' + (containerBounds.y + 14)
      + '" fill="' + containerColor + '" font-size="' + labelFontSize + '" font-weight="' + labelFontWeight + '" font-family="system-ui,monospace" class="df-container-label">' + containerLabel + '</text>');

      // input ports
    if (container.inputs && container.inputs.length) {
      var portX = containerBounds.x + labelWidth + 8;
      for (var cii = 0; cii < container.inputs.length; cii++) {
        var inputName = container.inputs[cii];
        var inputColor = variableColors[inputName] || '#888';
        parts.push('<circle cx="' + portX + '" cy="' + (containerBounds.y + 11) + '" r="4.5" fill="#151d2e" stroke="' + inputColor + '" stroke-width="1.8" class="df-port" data-df-nid="' + container.id + '" data-df-var="' + userEsc(inputName) + '" data-df-side="in"/>');
        parts.push('<circle cx="' + portX + '" cy="' + (containerBounds.y + 11) + '" r="2" fill="' + inputColor + '" pointer-events="none"/>');
        portX += 14;
      }
    }

      // output ports
    if (container.outputs && container.outputs.length) {
      var outputX = containerBounds.x + 12;
      for (var coi = 0; coi < container.outputs.length; coi++) {
        var outputName = container.outputs[coi];
        var outputColor = variableColors[outputName] || '#888';
        parts.push('<circle cx="' + outputX + '" cy="' + (containerBounds.y + containerBounds.h - 6) + '" r="4.5" fill="#151d2e" stroke="' + outputColor + '" stroke-width="1.8" class="df-port" data-df-nid="' + container.id + '" data-df-var="' + userEsc(outputName) + '" data-df-side="out"/>');
        parts.push('<circle cx="' + outputX + '" cy="' + (containerBounds.y + containerBounds.h - 6) + '" r="2" fill="' + outputColor + '" pointer-events="none"/>');
        outputX += 14;
      }
      parts.push('<text x="' + (containerBounds.x + 12) + '" y="' + (containerBounds.y + containerBounds.h + 12) + '" fill="' + (variableColors[container.outputs[0]] || '#888') + '" font-size="9" font-family="monospace" font-weight="600">' + userEsc(container.outputs.join(', ')) + '</text>');
    }
  }

    // ---- edges ----
  for (var ei = 0; edges && ei < edges.length; ei++) {
    var edge = edges[ei];
    if (!edge) continue;

    var fromEndpoint = getEndpoint(edge.fromNode, 'from', positions, containerPositions);
    var toEndpoint = getEndpoint(edge.toNode, 'to', positions, containerPositions);
    if (!fromEndpoint || !toEndpoint) continue;

    var fromPortY = getPortY(edge.fromNode, edge.fromVar, 'out', nodeLookup, positions, containerPositions);
    var toPortY = getPortY(edge.toNode, edge.toVar, 'in', nodeLookup, positions, containerPositions);

    var x1 = fromEndpoint.x;
    var y1 = fromPortY;
    var x2 = toEndpoint.x;
    var y2 = toPortY;
    var midX = (x1 + x2) / 2;
    var dx = x2 - x1;
    var dy = y2 - y1;
    var backX = dx < -10;
    var backY = dy < -10;
    var cx1, cy1, cx2, cy2;
    if (backX || backY) {
      // 鍥炲ご锛氭帶鍒剁偣鍚戝彸渚х粫琛岋紝閬垮厤鎶樿繑
      var sweepX = Math.max(x1, x2) + Math.abs(dy) * 0.6 + 50;
      cx1 = sweepX; cy1 = y1;
      cx2 = sweepX; cy2 = y2;
    } else {
      cx1 = midX; cy1 = y1;
      cx2 = midX; cy2 = y2;
    }
    var edgeColor = variableColors[edge.fromVar] || '#666';
    var edgeSafeName = (edge.fromVar || 'x').replace(/[^a-zA-Z0-9]/g, '_');

    parts.push('<path d="M' + x1 + ',' + y1 + ' C' + cx1 + ',' + cy1 + ' ' + cx2 + ',' + cy2 + ' ' + x2 + ',' + y2
      + '" stroke="' + edgeColor + '" stroke-opacity="0.55" fill="none" stroke-width="2" stroke-linecap="round"'
      + ' marker-end="url(#df-arr-' + edgeSafeName + ')"'
      + ' data-df-from="' + edge.fromNode + '" data-df-to="' + edge.toNode + '" data-df-var="' + userEsc(edge.fromVar) + '" class="df-edge"/>');
    parts.push('<path d="M' + x1 + ',' + y1 + ' C' + cx1 + ',' + cy1 + ' ' + cx2 + ',' + cy2 + ' ' + x2 + ',' + y2
      + '" stroke="' + edgeColor + '" stroke-opacity="0.1" fill="none" stroke-width="6" stroke-linecap="round" pointer-events="none" class="df-edge-glow"/>');
  }

    // ---- nodes ----
  for (var nodeIdx = 0; nodeIdx < nodes.length; nodeIdx++) {
    var node = nodes[nodeIdx];
    var nodePos = positions[node.id];
    if (!nodePos) continue;

    var group = '';
    group += '<g class="df-node" data-df-nid="' + node.id + '" transform="translate(' + nodePos.x + ',' + nodePos.y + ')">';
    group += '<rect x="0" y="0" width="' + nodePos.w + '" height="' + nodePos.h + '" rx="8" fill="#151d2e" stroke="rgba(255,255,255,0.1)" stroke-width="1" filter="url(#df-shadow)" class="df-node-rect"/>';
    group += '<rect x="1" y="1" width="' + (nodePos.w - 2) + '" height="2" rx="1" fill="rgba(255,255,255,0.06)" pointer-events="none"/>';

    if (node.inputs && node.inputs.length > 0) {
      group += '<rect x="0" y="4" width="3" height="' + (nodePos.h - 8) + '" rx="1.5" fill="rgba(255,255,255,0.06)" pointer-events="none"/>';
    }

    var textX = 30, textY = 6, textW = nodePos.w - 36, textH = nodePos.h - 12;
    var isMultiLine = (node.text || '').indexOf('\n') >= 0;
    var vAlign = isMultiLine ? 'flex-start' : 'center';
    var vPad = isMultiLine ? 'padding-top:4px;' : '';
    group += '<foreignObject x="' + textX + '" y="' + textY + '" width="' + textW + '" height="' + textH + '">';
    group += '<div xmlns="http://www.w3.org/1999/xhtml" style="font-family:\'Cascadia Code\',Consolas,monospace;font-size:12px;font-weight:500;color:#cdd6e0;line-height:17px;word-break:break-all;white-space:pre-wrap;overflow:hidden;height:100%;display:flex;align-items:' + vAlign + ';' + vPad + '">' + userEsc(node.text) + '</div>';
    group += '</foreignObject>';
    group += '<title>' + userEsc(node.text) + '&#10;\u5165\u53C2: ' + userEsc((node.inputs || []).join(', ') || '\u65E0') + '&#10;\u5E38\u91CF: ' + userEsc((node.literalInputs || []).map(function(v) { return typeof v === 'string' ? "'" + v + "'" : String(v); }).join(', ') || '\u65E0') + '&#10;\u51FA\u53C2: ' + userEsc((node.outputs || []).join(', ') || '\u65E0') + '</title>';

      // input ports
    var nodeInputs = node.inputs || [];
    var nodeLiterals = node.literalInputs || [];
    var allInputCount = nodeInputs.length + nodeLiterals.length;
    for (var inpIdx = 0; inpIdx < nodeInputs.length; inpIdx++) {
      var inputVar = nodeInputs[inpIdx];
      var portY = 6 + (inpIdx + 1) * (nodePos.h - 12) / (allInputCount + 1) + 6;
      var portColor = variableColors[inputVar] || '#888';
      group += '<circle cx="0" cy="' + portY + '" r="8" fill="' + portColor + '" opacity="0.15" filter="url(#df-glow)" pointer-events="none"/>';
      group += '<circle cx="0" cy="' + portY + '" r="5.5" fill="#151d2e" stroke="' + portColor + '" stroke-width="2" class="df-port" data-df-nid="' + node.id + '" data-df-var="' + userEsc(inputVar) + '" data-df-side="in"/>';
      group += '<circle cx="0" cy="' + portY + '" r="2.5" fill="' + portColor + '" pointer-events="none"/>';
      group += '<text x="-9" y="' + (portY + 4) + '" text-anchor="end" fill="' + portColor + '" font-size="10" font-family="\'Cascadia Code\',monospace" font-weight="600" opacity="0.9">' + userEsc(inputVar) + '</text>';
    }
      // literal inputs (constant values)
    for (var litIdx = 0; litIdx < nodeLiterals.length; litIdx++) {
      var litVal = nodeLiterals[litIdx];
      var litY = 6 + (nodeInputs.length + litIdx + 1) * (nodePos.h - 12) / (allInputCount + 1) + 6;
      var rawVal = typeof litVal === 'string' ? "'" + litVal + "'" : String(litVal);
      var displayVal = rawVal.length > 18 ? rawVal.substring(0, 16) + '\u2026' : rawVal;
      group += '<text x="-9" y="' + (litY + 4) + '" text-anchor="end" fill="#6a7d8e" font-size="9.5" font-family="\'Cascadia Code\',monospace" font-style="italic" opacity="0.75">' + userEsc(displayVal) + '</text>';
    }

      // output ports
    var nodeOutputs = node.outputs || [];
    for (var outIdx = 0; outIdx < nodeOutputs.length; outIdx++) {
      var outputVar = nodeOutputs[outIdx];
      var outPortY = 6 + (outIdx + 1) * (nodePos.h - 12) / (nodeOutputs.length + 1) + 6;
      var outColor = variableColors[outputVar] || '#888';
      group += '<circle cx="' + nodePos.w + '" cy="' + outPortY + '" r="8" fill="' + outColor + '" opacity="0.15" filter="url(#df-glow)" pointer-events="none"/>';
      group += '<circle cx="' + nodePos.w + '" cy="' + outPortY + '" r="5.5" fill="#151d2e" stroke="' + outColor + '" stroke-width="2" class="df-port" data-df-nid="' + node.id + '" data-df-var="' + userEsc(outputVar) + '" data-df-side="out"/>';
      group += '<circle cx="' + nodePos.w + '" cy="' + outPortY + '" r="2.5" fill="' + outColor + '" pointer-events="none"/>';
      group += '<text x="' + (nodePos.w + 9) + '" y="' + (outPortY + 4) + '" text-anchor="start" fill="' + outColor + '" font-size="10" font-family="\'Cascadia Code\',monospace" font-weight="600" opacity="0.9">' + userEsc(outputVar) + '</text>';
    }

    group += '</g>';
    parts.push(group);
  }

  parts.push('</svg></div>');
  return parts.join('');
}

// ---- helpers ----

function collectVariableNames(nodes) {
  var names = [];
  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    var inputs = node.inputs || [];
    var outputs = node.outputs || [];
    for (var j = 0; j < inputs.length; j++) names.push(inputs[j]);
    for (var k = 0; k < outputs.length; k++) names.push(outputs[k]);
  }
  return names;
}

function sortContainersByDepth(containers) {
  if (!containers || !containers.length) return [];
  var depthMap = {};
  function calcDepth(containerId, depth) {
    depthMap[containerId] = depth;
    for (var i = 0; i < containers.length; i++) {
      if (containers[i].parentId === containerId) {
        calcDepth(containers[i].id, depth + 1);
      }
    }
  }
    // find root containers
  for (var i = 0; i < containers.length; i++) {
    if (!containers[i].parentId) calcDepth(containers[i].id, 0);
  }
  var sorted = containers.slice();
  sorted.sort(function(a, b) { return (depthMap[a.id] || 0) - (depthMap[b.id] || 0); });
  return sorted;
}

function getEndpoint(entityId, side, positions, containerPositions) {
  if (!entityId) return null;
  var pos = positions[entityId];
  if (pos) {
    if (side === 'from') return { x: pos.x + pos.w, y: pos.y + pos.h / 2 };
    return { x: pos.x, y: pos.y + pos.h / 2 };
  }
  var cpos = containerPositions[entityId];
  if (cpos) {
    if (side === 'from') return { x: cpos.x + cpos.w, y: cpos.y + cpos.h / 2 };
    return { x: cpos.x, y: cpos.y + cpos.h / 2 };
  }
  return null;
}

function getPortY(entityId, variableName, side, nodeLookup, positions, containerPositions) {
  var node = nodeLookup[entityId];
  if (node) {
    var list = side === 'out' ? (node.outputs || []) : (node.inputs || []);
    var idx = list.indexOf(variableName);
    var pos = positions[entityId];
    if (!pos) return 0;
    if (idx >= 0 && list.length > 0) {
      return pos.y + 7 + (idx + 1) * (pos.h - 14) / (list.length + 1) + 7;
    }
    return pos.y + pos.h / 2;
  }
  var cpos = containerPositions[entityId];
  if (cpos) {
    if (side === 'in') return cpos.y + 11;
    return cpos.y + cpos.h - 6;
  }
  return 0;
}
