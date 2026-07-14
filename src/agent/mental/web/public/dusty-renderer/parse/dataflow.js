// === Dusty Parse / DataFlow ===
// AST → { nodes, edges, containers }
// 每个节点 = 一句代码，有 inputs(入参) 和 outputs(出参)
// 连线 = 出参端口 → 同名入参端口
// 容器 = 控制流结构(if/for/while/function/try)
// 链式调用 a.b().c() → 拆为多个节点，用 _%N 合成变量串联
// 回调参数 → 视为调用的出参

export function analyzeDataFlow(source, ext) {
  if (ext !== 'js' && ext !== 'mjs' && ext !== 'ts') return null;
  const acorn = (typeof window !== 'undefined' && window.acorn) || (typeof globalThis !== 'undefined' && globalThis.acorn);
  if (!acorn) return null;

  let ast;
  try {
    ast = acorn.parse(source, { ecmaVersion: 2022, locations: true, sourceType: 'module' });
  } catch { return null; }

  const nodes = [];
  const containers = [];
  const edges = [];

  let nodeId = 0;
  let containerId = 0;
  const containerStack = [null];

  // ---- helpers ----

  function extractReads(node) {
    const reads = new Set();
    function walk(n, isLHS) {
      if (!n || typeof n !== 'object') return;
      if (n.type === 'Identifier') { if (!isLHS) reads.add(n.name); return; }
      if (n.type === 'Literal') return;
      // 回调函数体不穿透——其内部变量属于独立作用域
      if (n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression') return;
      if (n.type === 'MemberExpression') {
        if (!isLHS) {
          let obj = n.object;
          while (obj.type === 'MemberExpression') obj = obj.object;
          if (obj.type === 'Identifier') reads.add(obj.name);
        }
        if (n.computed && n.property) walk(n.property, false);
        return;
      }
      if (n.type === 'ThisExpression') { if (!isLHS) reads.add('this'); return; }
      if (n.type === 'Super') { if (!isLHS) reads.add('super'); return; }
      for (const key of Object.keys(n)) {
        if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') continue;
        const child = n[key];
        if (Array.isArray(child)) child.forEach(function(c) { walk(c, isLHS); });
        else if (child && typeof child === 'object' && child.type) walk(child, isLHS);
      }
    }
    walk(node, false);
    return [...reads];
  }

  function extractWrites(node) {
    const writes = new Set();
    function walk(n) {
      if (!n || typeof n !== 'object') return;
      if (n.type === 'Identifier') { writes.add(n.name); return; }
      if (n.type === 'ObjectPattern') { n.properties.forEach(p => walk(p.value || p.key)); return; }
      if (n.type === 'ArrayPattern') { n.elements.forEach(e => { if (e) walk(e); }); return; }
      if (n.type === 'AssignmentPattern') { walk(n.left); return; }
      if (n.type === 'RestElement') { walk(n.argument); return; }
      if (n.type === 'MemberExpression') return;
    }
    walk(node);
    return [...writes];
  }

  function srcText(node) {
    return source.slice(node.start, node.end);
  }

  function addNode(text, inputs, outputs, line, literalInputs) {
    const id = 'n' + nodeId++;
    nodes.push({ id, text, inputs, outputs, line, containerId: containerStack[containerStack.length - 1], literalInputs: literalInputs || [] });
    return id;
  }

  function pushContainer(type, label, inputs, outputs) {
    const id = 'c' + containerId++;
    containers.push({ id, type, label, inputs: inputs || [], outputs: outputs || [], children: [], parentId: containerStack[containerStack.length - 1] });
    containerStack.push(id);
    return id;
  }

  function popContainer() { containerStack.pop(); }

  function cleanText(node) {
    var text = srcText(node);
    var lines = text.split('\n');
    // 找最小公共缩进（跳过纯空白行）
    var minIndent = Infinity;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '') continue;
      var m = lines[i].match(/^[ \t]*/);
      if (m && m[0].length < minIndent) minIndent = m[0].length;
    }
    if (minIndent === Infinity || minIndent === 0) return text.trim();
    // 去掉公共缩进，保留相对缩进
    for (var i = 0; i < lines.length; i++) {
      lines[i] = lines[i].slice(minIndent);
    }
    return lines.join('\n').trim();
  }

  // 提取回调参数名 → 视为调用的"出参"
  function callbackParams(fn) {
    if (!fn) return [];
    if (fn.type === 'ArrowFunctionExpression' || fn.type === 'FunctionExpression') {
      const names = [];
      for (const p of fn.params) {
        if (p.type === 'Identifier') names.push(p.name);
        else if (p.type === 'AssignmentPattern' && p.left && p.left.type === 'Identifier') names.push(p.left.name);
        else if (p.type === 'ObjectPattern') {
          for (const prop of p.properties) {
            if (prop.value && prop.value.type === 'Identifier') names.push(prop.value.name);
            else if (prop.key && prop.key.type === 'Identifier') names.push(prop.key.name);
          }
        }
      }
      return names;
    }
    return [];
  }

  // ---- walkers ----

  function walkStmts(stmts) { for (const s of stmts) walkStmt(s); }

  function walkStmt(stmt) {
    switch (stmt.type) {
      case 'VariableDeclaration':
        for (const decl of stmt.declarations) {
          addNode(cleanText(stmt),
            extractReads(decl.init), extractWrites(decl.id), stmt.loc.start.line);
        }
        break;
      case 'ExpressionStatement':
        walkExpr(stmt.expression, stmt);
        break;
      case 'IfStatement': {
        var ifReads = extractReads(stmt.test);
        pushContainer('ifelse', 'if/else', [], []);
          pushContainer('branch', 'if (' + srcText(stmt.test) + ')', ifReads, []);
          if (stmt.consequent.type === 'BlockStatement') walkStmts(stmt.consequent.body);
          else walkStmt(stmt.consequent);
          popContainer();
          if (stmt.alternate) {
            pushContainer('branch', 'else', [], []);
            if (stmt.alternate.type === 'BlockStatement') walkStmts(stmt.alternate.body);
            else if (stmt.alternate.type === 'IfStatement') walkStmt(stmt.alternate);
            else walkStmt(stmt.alternate);
            popContainer();
          }
        popContainer();
        break;
      }
      case 'ForStatement': {
        var t = stmt.test ? srcText(stmt.test) : '';
        var forReads = stmt.test ? extractReads(stmt.test) : [];
        var forWrites = [];
        if (stmt.init && stmt.init.type === 'VariableDeclaration') {
          for (var di = 0; di < stmt.init.declarations.length; di++) {
            var dw = extractWrites(stmt.init.declarations[di].id);
            for (var dj = 0; dj < dw.length; dj++) forWrites.push(dw[dj]);
          }
        } else if (stmt.init) {
          var iw = extractWrites(stmt.init);
          for (var ik = 0; ik < iw.length; ik++) forWrites.push(iw[ik]);
        }
        pushContainer('loop', 'for (;;' + (t ? ' ' + t : '') + ')', forReads, forWrites);
        if (stmt.init) {
          if (stmt.init.type === 'VariableDeclaration') {
            for (const d of stmt.init.declarations)
              addNode(cleanText(stmt.init), extractReads(d.init), extractWrites(d.id), stmt.init.loc.start.line);
          } else {
            addNode(srcText(stmt.init), extractReads(stmt.init), extractWrites(stmt.init), stmt.init.loc.start.line);
          }
        }
        if (stmt.update) {
          const u = stmt.update;
          if (u.type === 'UpdateExpression')
            addNode(srcText(u), extractReads(u.argument), extractWrites(u.argument), stmt.loc.start.line);
          else if (u.type === 'AssignmentExpression')
            addNode(srcText(u), extractReads(u.right), extractWrites(u.left), stmt.loc.start.line);
        }
        if (stmt.body.type === 'BlockStatement') walkStmts(stmt.body.body);
        else walkStmt(stmt.body);
        popContainer();
        break;
      }
      case 'WhileStatement':
        pushContainer('loop', 'while (' + srcText(stmt.test) + ')', extractReads(stmt.test), []);
        if (stmt.body.type === 'BlockStatement') walkStmts(stmt.body.body);
        else walkStmt(stmt.body);
        popContainer();
        break;
      case 'DoWhileStatement':
        pushContainer('loop', 'do ... while (' + srcText(stmt.test) + ')', extractReads(stmt.test), []);
        if (stmt.body.type === 'BlockStatement') walkStmts(stmt.body.body);
        else walkStmt(stmt.body);
        popContainer();
        break;
      case 'ForOfStatement':
      case 'ForInStatement': {
        var ofReads = extractReads(stmt.right);
        // 循环变量：left 可能是 VariableDeclaration(const it) 或裸表达式
        var ofWrites;
        if (stmt.left.type === 'VariableDeclaration') {
          ofWrites = [];
          for (var ldi = 0; ldi < stmt.left.declarations.length; ldi++) {
            var lw = extractWrites(stmt.left.declarations[ldi].id);
            for (var lwj = 0; lwj < lw.length; lwj++) ofWrites.push(lw[lwj]);
          }
        } else {
          ofWrites = extractWrites(stmt.left);
        }
        pushContainer('loop', (stmt.type === 'ForOfStatement' ? 'for (' : 'for (') + srcText(stmt.left) + ' of/in ...)', ofReads, ofWrites);
        if (stmt.body.type === 'BlockStatement') walkStmts(stmt.body.body);
        else walkStmt(stmt.body);
        popContainer();
        break;
      }
      case 'ReturnStatement':
        if (stmt.argument)
          addNode(cleanText(stmt), extractReads(stmt.argument), [], stmt.loc.start.line);
        break;
      case 'ThrowStatement':
        addNode(cleanText(stmt), extractReads(stmt.argument), [], stmt.loc.start.line);
        break;
      case 'BlockStatement':
        walkStmts(stmt.body);
        break;
      case 'FunctionDeclaration': {
        var fnName = stmt.id ? stmt.id.name : 'anonymous';
        var fnParams = [];
        for (var pi = 0; pi < stmt.params.length; pi++) {
          var p = stmt.params[pi];
          if (p.type === 'Identifier') fnParams.push(p.name);
        }
        var fnLabel = 'function ' + fnName + '(' + fnParams.join(', ') + ')';
        // 参数是函数体的"入口产出"：既是容器入参，也是容器出参（供内部消费连线）
        pushContainer('function', fnLabel, fnParams, fnParams.slice());
        if (stmt.body && stmt.body.body) walkStmts(stmt.body.body);
        popContainer();
        break;
      }
      case 'TryStatement':
        pushContainer('trycatch', 'try/catch', [], []);
          pushContainer('try', 'try', [], []);
          walkStmts(stmt.block.body);
          popContainer();
          if (stmt.handler) {
            var pn = stmt.handler.param ? (stmt.handler.param.type === 'Identifier' ? stmt.handler.param.name : 'err') : 'err';
            pushContainer('catch', 'catch (' + pn + ')', [], [pn]);
            walkStmts(stmt.handler.body.body);
            popContainer();
          }
          if (stmt.finalizer) {
            pushContainer('finally', 'finally', [], []);
            walkStmts(stmt.finalizer.body);
            popContainer();
          }
        popContainer();
        break;
      case 'SwitchStatement': {
        var swReads = extractReads(stmt.discriminant);
        pushContainer('branch', 'switch (' + srcText(stmt.discriminant) + ')', swReads, []);
        for (var ci = 0; ci < stmt.cases.length; ci++) {
          var c = stmt.cases[ci];
          var caseReads = c.test ? extractReads(c.test) : [];
          pushContainer('branch', c.test ? 'case ' + srcText(c.test) : 'default', caseReads, []);
          walkStmts(c.consequent);
          popContainer();
        }
        popContainer();
        break;
      }
    }
  }

  // 拆链式调用 a.b().c().d() → 多个节点
  function breakChain(topExpr, line) {
    const chain = [];
    let cur = topExpr;
    while (cur.type === 'CallExpression' && cur.callee.type === 'MemberExpression' && !cur.callee.computed) {
      chain.unshift({ method: cur.callee.property.name, args: cur.arguments, node: cur });
      const obj = cur.callee.object;
      if (obj.type === 'CallExpression') { cur = obj; continue; }
      else { cur = obj; break; }
    }
    if (chain.length < 2) return false;

    const rootReads = extractReads(cur);
    const rootText = srcText(cur);
    let prevOutputs = [...rootReads];
    let objText = rootText;

    for (let i = 0; i < chain.length; i++) {
      const call = chain[i];
      const isLast = (i === chain.length - 1);

      const argReads = call.args.flatMap(function(a) { return extractReads(a); });
      const allReads = [...new Set([...prevOutputs, ...argReads])];

      const cbWrites = call.args.flatMap(function(a) { return callbackParams(a); });
      const allWrites = [...cbWrites];

      // 非最后一步：加合成变量串联
      if (!isLast) {
        allWrites.push('chain' + nodeId);
      }

      let text;
      if (i === 0) {
        var firstArgs = call.args.map(function(a) {
          var t = cleanText(a);
          if (t.length > 40) return t.substring(0,37) + '...)';
          return t;
        }).join(', ');
        text = rootText + '.' + call.method + '(' + firstArgs + ')';
      } else {
        var sa = call.args.map(function(a) {
          var t = cleanText(a);
          return t.length > 20 ? t.substring(0,18) + '...' : t;
        }).join(', ');
        text = '. ' + call.method + '(' + sa + ')';
      }

      addNode(text, allReads, allWrites, line);

      if (!isLast) {
        prevOutputs = ['chain' + (nodeId - 1)];
        objText = prevOutputs[0];
      }
    }
    return true;
  }

  // 收集调用中所有回调参数名（这些不应算入参）
  function allCallbackParams(expr) {
    if (expr.type !== 'CallExpression' || !expr.arguments) return [];
    var names = [];
    for (var i = 0; i < expr.arguments.length; i++) {
      var cbn = callbackParams(expr.arguments[i]);
      for (var j = 0; j < cbn.length; j++) names.push(cbn[j]);
    }
    return names;
  }

  function walkExpr(expr, stmt) {
    if (expr.type === 'AssignmentExpression') {
      var r = [...extractReads(expr.right), ...(expr.operator !== '=' ? extractReads(expr.left) : [])];
      var w = extractWrites(expr.left);
      addNode(cleanText(stmt), r, w, stmt.loc.start.line);
      return;
    }
    if (expr.type === 'UpdateExpression') {
      addNode(cleanText(stmt), extractReads(expr.argument), extractWrites(expr.argument), stmt.loc.start.line);
      return;
    }
    // 链式调用拆分
    if (expr.type === 'CallExpression' && breakChain(expr, stmt.loc.start.line)) return;

    // 普通调用
    if (expr.type === 'CallExpression') {
      var reads = extractReads(expr);
      var cbParams = allCallbackParams(expr);
      // 回调参数从入参中剔除（它们由调用注入）
      var filtered = reads.filter(function(v) { return cbParams.indexOf(v) < 0; });

      // 收集字面量入参
      var literalInputs = [];
      for (var ai = 0; ai < expr.arguments.length; ai++) {
        var arg = expr.arguments[ai];
        if (arg.type === 'Literal') {
          literalInputs.push(String(arg.value));
        } else if (arg.type === 'TemplateLiteral' && arg.expressions.length === 0) {
          literalInputs.push(arg.quasis[0].value.raw);
        }
      }

      addNode(cleanText(stmt), filtered, cbParams, stmt.loc.start.line, literalInputs);

      // 展开回调函数体为容器
      for (var ai2 = 0; ai2 < expr.arguments.length; ai2++) {
        var cbArg = expr.arguments[ai2];
        if (cbArg.type !== 'ArrowFunctionExpression' && cbArg.type !== 'FunctionExpression') continue;
        var cbParamNames = callbackParams(cbArg);
        // 构造容器标签
        var methodLabel = '';
        if (expr.callee.type === 'MemberExpression' && !expr.callee.computed) {
          methodLabel = expr.callee.property.name;
        } else if (expr.callee.type === 'Identifier') {
          methodLabel = expr.callee.name;
        }
        pushContainer('callback', methodLabel + ' callback', cbParamNames, []);
        if (cbArg.body.type === 'BlockStatement') {
          walkStmts(cbArg.body.body);
        } else {
          // 表达式体: x => x * 2
          walkStmt({ type: 'ReturnStatement', argument: cbArg.body, loc: cbArg.body.loc });
        }
        popContainer();
      }
      return;
    }
    addNode(cleanText(stmt), extractReads(expr), [], stmt.loc.start.line);
  }

  // ---- run ----
  if (ast.type === 'Program' || ast.type === 'Module') walkStmts(ast.body);

  // ---- build edges (nodes + containers) ----
  function isChainVar(name) { return /^chain\d/.test(name); }

  // 所有可连线实体：节点 + 容器
  var allEntities = [];
  for (var ei = 0; ei < nodes.length; ei++) allEntities.push({ kind: 'node', obj: nodes[ei], idx: ei });
  for (var ej = 0; ej < containers.length; ej++) {
    var c = containers[ej];
    if (c.inputs.length || c.outputs.length) allEntities.push({ kind: 'container', obj: c, idx: ej + nodes.length });
  }

  for (var ai = 0; ai < allEntities.length; ai++) {
    var ent = allEntities[ai];
    var entInputs = ent.obj.inputs;
    var entLine = ent.kind === 'node' ? ent.obj.line : 99999;
    var entId = ent.kind === 'node' ? ent.obj.id : ent.obj.id;

    for (var ji = 0; ji < entInputs.length; ji++) {
      var inVar = entInputs[ji];
      var best = null, bestLine = -1, bestIdx = -1;
      for (var ak = 0; ak < allEntities.length; ak++) {
        var other = allEntities[ak];
        if (other.obj.id === ent.obj.id) continue;
        if (other.obj.outputs.indexOf(inVar) < 0) continue;
        var otherLine = other.kind === 'node' ? other.obj.line : 99998;
        if (!isChainVar(inVar) && otherLine >= entLine) continue;
        if (otherLine > bestLine || (isChainVar(inVar) && ak > bestIdx)) {
          bestLine = otherLine; bestIdx = ak; best = other;
        }
      }
      if (best) {
        var dup = edges.find(function(e) { return e.fromNode === best.obj.id && e.toNode === entId && e.fromVar === inVar; });
        if (!dup) edges.push({ fromNode: best.obj.id, fromVar: inVar, toNode: entId, toVar: inVar });
      }
    }
  }

  return { nodes: nodes, edges: edges, containers: containers };
}
