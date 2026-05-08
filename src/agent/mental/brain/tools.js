const path = require('path');
const fs = require('fs');
const { readEvents } = require('../../../core/event');
const { getUnclosedTasks } = require('../../../hooks/tool-task');

module.exports = function(instanceDir, mentalRoot, hooks = {}) {
  const roomsDir = path.join(mentalRoot, 'space');
  const historyDir = path.join(instanceDir, 'history');
  const instancesDir = path.join(mentalRoot, 'instances');

  function resolveMd(name) {
    return path.join(roomsDir, name + '.md');
  }

  function resolveLinks(name) {
    return path.join(roomsDir, name + '.links');
  }

  function resolveSummary(name) {
    return path.join(roomsDir, name + '.summary');
  }

  function tryRead(p) {
    try { return fs.readFileSync(p, 'utf-8'); } catch { return null; }
  }

  // Parse JSONL links content into array of {name, summary, parent?}
  function parseLinksContent(content) {
    if (!content) return [];
    return content.split('\n').filter(l => l.trim()).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  }

  // Detect parent link cycles in global mentals (DFS)
  // New format: each node declares its own parent via {"name":"X","parent":true}
  // overrideName/overrideContent: simulate writing before actual write
  function detectParentCycle(overrideName, overrideContent) {
    const parentOf = {}; // child -> parent name
    try {
      const files = fs.readdirSync(roomsDir).filter(f => f.endsWith('.links'));
      for (const f of files) {
        const name = f.slice(0, -6);
        const content = (name === overrideName && overrideContent != null)
          ? overrideContent
          : tryRead(path.join(roomsDir, f));
        const links = parseLinksContent(content);
        for (const link of links) {
          if (link.parent) { parentOf[name] = link.name; break; }
        }
      }
      // Handle new file not yet on disk
      if (overrideName && overrideContent != null && !(overrideName in parentOf)) {
        const links = parseLinksContent(overrideContent);
        for (const link of links) {
          if (link.parent) { parentOf[overrideName] = link.name; break; }
        }
      }
    } catch { return null; }
    // Walk parent chain to detect cycles
    for (const start of Object.keys(parentOf)) {
      const visited = new Set();
      let cur = start;
      while (cur && parentOf[cur]) {
        if (visited.has(cur)) return cur;
        visited.add(cur);
        cur = parentOf[cur];
      }
    }
    return null;
  }

  function normalizeEndings(s) { return s.replace(/\r\n/g, '\n'); }
  function normalizeQuotes(s) { return s.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'"); }

  function doEdit(filePath, old, replacement) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    let content = normalizeEndings(raw);
    old = normalizeEndings(old);
    replacement = normalizeEndings(replacement);

    let matchOld = old;
    if (!content.includes(old)) {
      const nc = normalizeQuotes(content), no = normalizeQuotes(old);
      if (nc.includes(no)) {
        const idx = nc.indexOf(no);
        matchOld = content.substring(idx, idx + old.length);
      } else {
        const snippet = old.length > 200 ? old.substring(0, 200) + '...' : old;
        throw new Error(`text not found. String: "${snippet}"`);
      }
    }
    const matches = content.split(matchOld).length - 1;
    if (matches > 1) throw new Error(`found ${matches} matches. Provide more context.`);
    content = content.replace(matchOld, replacement);
    fs.writeFileSync(filePath, content);
  }

  // --- Auto-extract entities from events since last commit ---
  function extractEntities(events) {
    const entities = new Set();
    let lastCommitIdx = -1;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === 'action' && events[i].tool === 'commit' && !events[i].error) {
        lastCommitIdx = i; break;
      }
    }
    const recent = lastCommitIdx >= 0 ? events.slice(lastCommitIdx + 1) : events;
    for (const e of recent) {
      if (e.type !== 'action') continue;
      if ((e.tool === 'mental' || e.tool === 'links') && e.input) {
        if (e.input.set != null || e.input.delete) {
          if (e.input.name) entities.add(e.input.name);
        }
      }
    }
    return [...entities];
  }

  // --- Scan events to find commits related to a mental name ---
  function findStoriesByMental(eventsDir, targetName) {
    let events;
    try { events = readEvents(eventsDir); } catch { return []; }
    const stories = [];
    let segStart = 0;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.type === 'action' && e.tool === 'commit' && !e.error) {
        const segment = events.slice(segStart, i);
        const hasMental = segment.some(ev =>
          ev.type === 'action' && (ev.tool === 'mental' || ev.tool === 'links') && ev.input &&
          (ev.input.set != null || ev.input.delete) &&
          ev.input.name === targetName
        );
        if (hasMental) {
          stories.push({ title: e.input?.title || 'untitled', story: e.input?.story || '' });
        }
        segStart = i + 1;
      }
    }
    return stories;
  }

  // --- Read previous version of file from events ---
  function readFilePrev(events, filePath) {
    const norm = path.normalize(filePath);
    const versions = [];
    for (const evt of events) {
      if (evt.type !== 'action') continue;
      const ep = evt.input?.path ? path.normalize(evt.input.path) : null;
      if (!ep || ep !== norm) continue;
      if ((evt.tool === 'file') && !evt.input.set && !evt.input.select && !evt.input.delete && typeof evt.output === 'string' && evt.output !== 'unchanged') {
        versions.push(evt.output);
      }
      if ((evt.tool === 'file') && typeof evt.input?.set === 'string' && !evt.input.select) {
        versions.push(evt.input.set);
      }
    }
    if (versions.length < 2) return null;
    return versions[versions.length - 2];
  }

  return [
    {
      name: 'mental',
      description: `你的持久认知载体——承载事情"应该"怎样运转，让你从空白上下文醒来后能理解事物、正确推进。
事情"应该"怎样运转，不是"当前实际"怎样实现。两者完全分开。

【心智是什么】
从目标和效果出发，用第一性原理推演出事物应有的运转模型。
先和用户把应然模型聊清楚，再去管实现。完全可以不看代码，只看心智来讨论。
一个功能无论涉及多少文件，都用一篇心智把完整运转模型串清楚。

【心智不是什么】
不是笔记、不是代码注释、不是原始数据、不是变更记录。
不是"用户说要X"，不是"从A改成了B"，而是"X的目标是……，应该这样运转，因为……，做对的标准是……"

【心智怎么产生】
面对任何事情，都先聊心智模型——聊的过程本身就是思考，写清楚就是想清楚。
你引导提问、推演结构，用户提供判断和信息，双方从事物本质出发共同推演。
聊清楚后写好模型给用户看，用户决定要不要保留为心智，未来长期迭代。

【心智给谁看】
给未来完全不知情的大模型看。它没有上下文，读完心智就要能：
理解事物的目标、运转逻辑和效果判断标准，接手推进工作。
所以心智必须自包含、完整闭环。

【怎么工作】
你每次从空白上下文醒来，没有任何记忆。心智就是你的记忆。
第一步永远是：读心智列表（list）→顺链接读取相关心智→继承已有认知。不读心智就动手=失忆蛮干。
然后理解用户在说什么。以小见大——任何小事都可能是观察全局的窗口，一个bug可能暴露运转模型的缺陷。
无论什么问题，先从心智模型角度讨论，把应然聊清楚。讨论产生的认知直接写入心智，拿着心智和用户对齐确认，然后再动手实现。
心智是唯一的认知载体。不要在对话里说完想法再另外写心智——讨论本身就是在构建心智。

例——名为"点赞"的叶子心智：
  【目标】让用户对文章表达偏好，为推荐系统提供信号。
  【运转】用户点击→前端立即切换状态（乐观更新，不等网络）→后端likes表upsert(user_id,article_id)→返回真实计数修正前端。
  失败则回滚UI并toast，保证客户端与服务端状态一致。
  【为什么这样】乐观更新：点赞的感知延迟直接伤害体验，宁可偶尔回滚也不能让用户等。
  upsert而非insert：天然幂等，防重复点赞不需额外逻辑。
  【涉及】前端组件、API层、后端路由、数据模型四个模块。

例——名为"用户系统"的枢纽心智（有子心智：注册、登录、权限）：
  【目标】管理用户身份全生命周期，让任何请求都能识别"谁在操作"并判定"能不能做"。
  【运转】注册→产生身份→登录→签发会话→每次请求→权限校验→放行/拒绝。
  三个子心智各切一段：「注册」负责身份从无到有，「登录」负责身份到会话的转换，「权限」负责会话到访问控制的映射。
  关键接口：注册产出user_id，登录消费user_id产出session_token，权限消费session_token产出allow/deny。
  【边界原则】按"身份状态转换"切分，每个子心智拥有一种状态转换，互不侵入。
  枢纽心智不是子心智的索引目录，而是在更高层次描述它们共同服务的目标、协作运转和拆分依据。

心智由三部分组成：
- 内容(.md)：心智主体文本
- 链接(.links)：JSONL格式，每行一个JSON，声明与其他心智的关系
  {"name":"目标心智","summary":"20字摘要"}                  — 普通关联
  {"name":"父心智","summary":"20字摘要","parent":true}       — 声明父子关系（子声明父）
- 摘要(.summary)：20字以内的一句话概括，list时展示

参数分两层——定位+操作：
定位（逐步圈定范围）：name指定心智（必传，list模式可省略表示完整目录），target指定操作对象（不传=内容），select圈定到文本中的某段。
操作：不传=读取，set=写入（name不存在则新建），delete=删除，list=列出子心智。

示例：
  mental(name="点赞")                                       → 读取内容+链接
  mental(name="点赞", set="全部新内容")                       → 整体重写（不存在则新建）
  mental(name="点赞", select="旧段落", set="新段落")           → 局部替换
  mental(name="点赞", select="要删的段", delete=true)          → 删除某段文本
  mental(name="点赞", delete=true)                            → 删除整个心智
  mental(name="点赞", target="link")                          → 读取链接
  mental(name="点赞", target="link", set='{"name":"父","summary":"概述","parent":true}')  → 重写链接
  mental(name="点赞", target="summary")                       → 读取摘要
  mental(name="点赞", target="summary", set="乐观更新点赞")    → 写入摘要
  mental(list=true)                                           → 展示完整心智树形目录（字数超限时从最深层逐层收起，标注+N）
  mental(name="点赞", list=true)                              → 从该节点展示子树`,
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '心智名。如name="登录验证"。list模式可不传' },
          target: { type: 'string', enum: ['link', 'summary'], description: '操作对象。不传=内容(.md)，"link"=链接(.links)，"summary"=摘要(.summary)' },
          select: { type: 'string', description: '圈定到文本中的某段（精确匹配），配合set做局部替换，配合delete删除该段。如select="旧文本", set="新文本"' },
          set: { type: 'string', description: '写入。不传select=整体重写（name不存在则新建），传select=替换匹配段。如set="全部新内容"或select="旧", set="新"' },
          delete: { type: 'boolean', description: '删除。不传select=删除整个心智/链接/摘要，传select=只删匹配的文本段' },
          list: { type: 'boolean', description: '展示心智树形目录。不传name=完整目录树，传name=该节点的子树。字数超限时从最深层逐层收起' },
        },
      },
      execute: async (input) => {
        const isLink = input.target === 'link';
        const isSummary = input.target === 'summary';

        // name is required except for list mode
        if (!input.name && !input.list) {
          return '错误：name 参数必传。使用 mental(list=true) 查看心智目录。';
        }

        // --- Summary mode ---
        if (isSummary) {
          const summaryPath = resolveSummary(input.name);
          if (input.delete) {
            try { fs.unlinkSync(summaryPath); } catch {}
            return 'ok';
          }
          if (input.set != null) {
            fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
            fs.writeFileSync(summaryPath, input.set);
            return 'ok';
          }
          return tryRead(summaryPath) || '(无摘要)';
        }

        // --- List mode ---
        if (input.list) {
          // Build tree: scan all mentals, resolve parent relationships
          const allMentals = new Set();
          const parentOf = {}; // child -> parent name
          const summaries = {}; // name -> summary text
          try {
            const files = fs.readdirSync(roomsDir);
            for (const f of files) {
              if (f.endsWith('.md')) allMentals.add(f.slice(0, -3));
              if (f.endsWith('.links')) {
                const name = f.slice(0, -6);
                const links = parseLinksContent(tryRead(path.join(roomsDir, f)));
                for (const l of links) {
                  if (l.parent) { parentOf[name] = l.name; break; }
                }
              }
              if (f.endsWith('.summary')) {
                const name = f.slice(0, -8);
                summaries[name] = tryRead(path.join(roomsDir, f));
              }
            }
          } catch { return '无心智。'; }
          if (!allMentals.size) return '无心智。';

          // Build children map
          const childrenOf = {}; // parent -> [child, ...]
          for (const [child, parent] of Object.entries(parentOf)) {
            if (!childrenOf[parent]) childrenOf[parent] = [];
            childrenOf[parent].push(child);
          }
          // Sort children alphabetically
          for (const k of Object.keys(childrenOf)) childrenOf[k].sort();

          // Find roots (or subtree root if name specified)
          let roots;
          if (input.name) {
            roots = (childrenOf[input.name] || []).filter(n => allMentals.has(n));
            if (!roots.length) return `心智 "${input.name}" 无子心智。`;
          } else {
            roots = [...allMentals].filter(n => !parentOf[n]).sort();
          }

          // Count all descendants
          function countDesc(name) {
            const kids = (childrenOf[name] || []).filter(n => allMentals.has(n));
            let c = kids.length;
            for (const k of kids) c += countDesc(k);
            return c;
          }

          // Render tree at given max depth
          function renderTree(nodes, maxDepth) {
            const lines = [];
            function walk(name, depth) {
              const indent = '  '.repeat(depth);
              const sum = summaries[name];
              const kids = (childrenOf[name] || []).filter(n => allMentals.has(n));
              if (depth >= maxDepth && kids.length) {
                const desc = countDesc(name);
                lines.push(`${indent}${name}${sum ? ': ' + sum : ''} (+${desc})`);
              } else {
                lines.push(`${indent}${name}${sum ? ': ' + sum : ''}`);
                for (const kid of kids) walk(kid, depth + 1);
              }
            }
            for (const r of nodes) walk(r, 0);
            return lines.join('\n');
          }

          // Find max depth of tree
          function maxTreeDepth(nodes, depth) {
            let max = depth;
            for (const n of nodes) {
              const kids = (childrenOf[n] || []).filter(k => allMentals.has(k));
              if (kids.length) max = Math.max(max, maxTreeDepth(kids, depth + 1));
            }
            return max;
          }

          const MAX_CHARS = 4000;
          let depth = maxTreeDepth(roots, 0);
          let result = renderTree(roots, depth + 1); // depth+1 = no limit
          while (result.length > MAX_CHARS && depth >= 0) {
            result = renderTree(roots, depth);
            depth--;
          }
          return result;
        }

        const filePath = isLink ? resolveLinks(input.name) : resolveMd(input.name);

        // --- Delete ---
        if (input.delete) {
          if (input.select) {
            doEdit(filePath, input.select, '');
            hooks.onWrite?.(input.name, input.name);
            return 'ok';
          }
          if (isLink) {
            try { fs.unlinkSync(filePath); } catch {}
            hooks.onWrite?.(input.name, input.name);
            return 'ok';
          }
          try { fs.unlinkSync(resolveMd(input.name)); } catch {}
          try { fs.unlinkSync(resolveLinks(input.name)); } catch {}
          try { fs.unlinkSync(resolveSummary(input.name)); } catch {}
          hooks.onWrite?.(input.name, input.name);
          return 'ok';
        }

        // --- Set ---
        if (input.set != null) {
          if (input.select) {
            if (isLink && input.name) {
              const current = normalizeEndings(tryRead(filePath) || '');
              const simulated = current.replace(normalizeEndings(input.select), normalizeEndings(input.set));
              const cycle = detectParentCycle(input.name, simulated);
              if (cycle) return `错误：编辑会导致父链接循环（涉及 "${cycle}"），已拒绝。`;
            }
            doEdit(filePath, input.select, input.set);
            hooks.onWrite?.(input.name, input.name);
          } else {
            if (isLink && input.name) {
              const cycle = detectParentCycle(input.name, input.set);
              if (cycle) return `错误：写入会导致父链接循环（涉及 "${cycle}"），已拒绝。`;
            }
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, input.set);
            hooks.onWrite?.(input.name, input.name);
          }
          return 'ok';
        }

        // --- Read ---
        if (isLink) {
          return tryRead(resolveLinks(input.name)) || '(无链接)';
        }
        const md = tryRead(resolveMd(input.name));
        if (md == null) return `心智 "${input.name}" 不存在。`;
        const links = tryRead(resolveLinks(input.name));
        if (links) return md + '\n\n---\n' + links;
        return md;
      },
    },
    {
      name: 'commit',
      description: `提交故事。故事是你的经历记忆，固化每次有意义的工作成果。效果：
1. 将 title + story 写入故事档案（自动关联本轮修改的心智）
2. 之前的对话被截断（下轮推理只看 commit 之后的事件）
3. 隐式停止当前循环

commit 前确保相关心智已更新，让用户确认验收后再 commit。`,
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '一句话标题' },
          story: { type: 'string', description: '详细叙事' },
        },
        required: ['title', 'story'],
      },
      execute: async (input, ctrl, eventsDir) => {
        // Check for unclosed tasks
        const allEvents = readEvents(eventsDir);
        const unclosed = getUnclosedTasks(allEvents);
        if (unclosed.length > 0) {
          return `错误：还有未闭合任务：${unclosed.join(' → ')}。请先 task(done=...) 闭合所有任务再 commit。`;
        }

        const entities = extractEntities(ctrl.events || []);

        fs.mkdirSync(historyDir, { recursive: true });
        const existing = fs.readdirSync(historyDir).filter(f => f.endsWith('.md')).sort();
        const num = existing.length + 1;
        const pad = String(num).padStart(3, '0');

        const entitiesLine = entities.length ? `\nmentals: [${entities.join(', ')}]` : '';
        const frontMatter = `---\ntitle: ${input.title}${entitiesLine}\n---\n`;
        fs.writeFileSync(path.join(historyDir, `${pad}.md`), frontMatter + (input.story || ''));

        ctrl.stop();
        return `Committed v${num}: ${input.title}`;
      },
    },
    {
      name: 'history',
      description: `浏览故事和历史版本。

查看当前实例故事：不传参数，或传 offset/limit 分页。
查看某心智相关故事：传 mental 参数，从所有实例中查找涉及该心智修改的故事。
查看文件上一版本：传 file 参数（绝对路径）。`,
      input_schema: {
        type: 'object',
        properties: {
          mental: { type: 'string', description: '按心智名查找相关故事' },
          file: { type: 'string', description: '查看文件上一版本（绝对路径）' },
          offset: { type: 'number', description: '跳过前N条（默认0）' },
          limit: { type: 'number', description: '返回条数（默认10）' },
        },
      },
      execute: async (input, ctrl) => {
        // Mode 1: file previous version
        if (input.file) {
          const prev = readFilePrev(ctrl.events || [], input.file);
          if (prev == null) return '未找到该文件的历史版本。';
          return prev;
        }

        // Mode 2: stories related to a mental
        if (input.mental) {
          const allStories = [];
          try {
            const instances = fs.readdirSync(instancesDir, { withFileTypes: true })
              .filter(d => d.isDirectory()).map(d => d.name);
            for (const inst of instances) {
              const evDir = path.join(instancesDir, inst, 'events');
              const stories = findStoriesByMental(evDir, input.mental);
              allStories.push(...stories.map(s => ({ ...s, instance: inst })));
            }
          } catch {}
          if (!allStories.length) return `未找到涉及 "${input.mental}" 的故事。`;
          return allStories.map((s, i) => `${i + 1}. [${s.instance}] ${s.title}\n  ${s.story.substring(0, 200)}${s.story.length > 200 ? '...' : ''}`).join('\n\n');
        }

        // Mode 3: current instance stories
        let files;
        try {
          files = fs.readdirSync(historyDir).filter(f => f.endsWith('.md')).sort();
        } catch { return '暂无故事。'; }

        const commits = files.map(f => {
          const raw = fs.readFileSync(path.join(historyDir, f), 'utf-8');
          const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
          const meta = {};
          if (m) {
            for (const line of m[1].split('\n')) {
              const kv = line.match(/^(\w+):\s*(.+)$/);
              if (!kv) continue;
              let val = kv[2].trim();
              if (val.startsWith('[') && val.endsWith(']')) {
                val = val.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
              }
              meta[kv[1]] = val;
            }
          }
          return { file: f, title: meta.title || f, mentals: meta.mentals || [], story: m ? m[2] : raw };
        });

        commits.reverse();
        const offset = input.offset || 0;
        const limit = input.limit || 10;
        const page = commits.slice(offset, offset + limit);

        if (!page.length) return '暂无故事。';

        const lines = page.map((c, i) => {
          const idx = commits.length - offset - i;
          const ents = Array.isArray(c.mentals) && c.mentals.length ? ` [${c.mentals.join(', ')}]` : '';
          return `v${idx}: ${c.title}${ents}\n  ${c.story.substring(0, 200)}${c.story.length > 200 ? '...' : ''}`;
        });

        return `故事 ${offset + 1}-${offset + page.length} / ${commits.length}\n\n` + lines.join('\n\n');
      },
    },
  ];
};
