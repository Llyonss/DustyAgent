# Dusty4

一个极简的 ReAct Agent 框架。约 500 行代码，支持 CLI 和 Web 两种前端。

## 架构

```
src/
├── core/           # 核心引擎，无 UI 依赖
│   ├── loop.js     # 主循环：读 events → 构建 prompt → 推理 → 执行工具 → 写 events
│   ├── prompt.js   # 将 events 序列构建为 Anthropic messages 格式
│   ├── infer.js    # 流式调用 Anthropic API，逐块 yield
│   ├── action.js   # 消费推理流，执行工具调用，写入 events
│   ├── tool.js     # 工具定义与实现（cmd/read/write/edit/stop/wait）
│   ├── event.js    # events 持久化（JSON 文件，按时间戳排序）
│   └── log.js      # 推理日志与 usage 统计
├── cli/
│   └── index.js    # CLI 前端：readline + 轮询 events
└── web/
    ├── index.js    # Web 前端：Express API 服务
    └── public/     # 静态页面（单页应用）
```

### 数据流

```
用户输入 → writeEvent(user) → loop {
  readEvents → build(prompt) → infer(stream) → run {
    对每个 text_block: writeEvent(speak)
    对每个 tool_call: executeTool → writeEvent(action)
  }
  如果没有工具调用 → stop
  如果有工具调用 → 继续下一轮 loop
}
```

### 核心设计：Events 即状态

整个系统的状态就是 `instances/<name>/events/` 目录下的一组 JSON 文件。没有数据库，没有内存状态。每个 event 是一个带时间戳的 JSON 文件：

```
event.1719000001000.json  # { type: "user", content: "你好" }
event.1719000002000.json  # { type: "action", tool: "speak", output: "你好！" }
event.1719000003000.json  # { type: "action", tool: "read", input: {path: "..."}, output: "..." }
```

这意味着：
- **CLI 和 Web 可以同时连同一个 instance**，因为它们只是读写文件
- **崩溃恢复天然支持**——重启后读文件即可恢复全部上下文
- **调试极其简单**——直接看 JSON 文件就能理解整个对话历史

## 精妙的设计细节

### 1. Prompt Cache 的三层布局

Anthropic 的 prompt cache 是前缀匹配的——请求的前缀与上一次相同的部分会命中缓存，按 1/10 价格计费。Dusty4 利用 `cache_control: { type: 'ephemeral' }` 标记了三个缓存断点：

```
[system prompt]        ← cache_control  (几乎永远命中，极少变化)
[tools definitions]    ← cache_control  (工具不变则命中)
[messages ... 最后一条] ← cache_control  (每轮只新增尾部，前缀命中)
```

效果：一轮对话中 agent 可能调用多次工具（loop 内多次推理），每次推理只有新增的 events 是新 token，前面的全部走缓存。**system + tools 几乎永远命中，历史 messages 随对话增长也大部分命中。**

### 2. Loop 的推停判断

`loop.js` 中的 `needsInfer` 函数决定是否需要继续推理：

```js
function needsInfer(events) {
  const last = events[events.length - 1];
  return last.type === 'user' ||
    (last.type === 'action' && last.tool !== 'stop' && last.tool !== 'wait');
}
```

逻辑：**最后一个 event 是用户消息，或者是一个工具调用（非 stop/wait），就继续推理。** 这形成了 ReAct 循环——LLM 调用工具 → 得到结果 → 再次推理 → 直到它主动调用 `stop` 或者只输出文本（没有工具调用时 `action.js` 自动 stop）。

### 3. 纯文本输出的隐式 Stop

`action.js` 中：

```js
if (!hasToolCalls) {
  ctrl.stop();
}
```

如果 LLM 只输出了文本没有调用任何工具，自动停止循环。这意味着 LLM 不需要每次都显式调用 `stop`——直接说话就会停下来，减少了一次不必要的工具调用开销。

### 4. Turn 分组

每次 `action.js` 的 `run` 调用开始时生成一个 `turn = Date.now()` 时间戳，同一次推理产生的所有 events 共享这个 turn 值。`prompt.js` 在构建 messages 时按 turn 分组：

```js
const turn = e.turn;
const actions = [];
while (i < events.length && events[i].type === 'action' && events[i].turn === turn) {
  actions.push(events[i]);
  i++;
}
```

这确保了一次推理中的多个输出（文本 + 多个工具调用）被正确地组装成一条 `assistant` message，而不是拆成多条。这对于 Anthropic API 的 messages 格式是必须的。

### 5. 工具结果与用户消息的合并

`prompt.js` 中有一个容易被忽略的细节：

```js
if (i < events.length && events[i].type === 'user') {
  toolResults.push({ type: 'text', text: events[i].content });
  i++;
}
```

如果工具执行完之后紧跟着一条用户消息，它会被合并到同一个 `user` message 中（和 tool_results 放在一起）。这是因为 Anthropic API 要求 messages 必须严格 user/assistant 交替——不能有两个连续的 user messages。这个合并保证了格式合法性。

### 6. Web 端的多实例与中止

`web/index.js` 用一个 `Map<string, AbortController>` 管理多个并发的 agent loop：

```js
const loops = new Map(); // instance名 → AbortController
```

- 每个 instance 最多一个活跃 loop（通过 `loops.has(key)` 防止重复启动）
- 用户可以通过 `DELETE /api/loop` 中止任意 instance 的推理
- AbortSignal 透传到 `infer` 的 API 调用，实现真正的流式中止

### 7. CLI 的轮询式显示

CLI 不是在 loop 内直接打印输出，而是用 `setInterval` 轮询 events 目录：

```js
const watcher = setInterval(() => {
  const events = readEvents(eventsDir);
  if (events.length > lastCount) { ... }
}, 150);
```

这意味着即使有外部进程（比如 Web 端）写入了新 events，CLI 也能实时看到。**前端完全解耦于推理引擎。**

## 使用

```bash
# 安装依赖
npm install

# 配置 .env
LLM_API_KEY=your-api-key
LLM_BASE_URL=https://api.anthropic.com
LLM_MODEL=claude-sonnet-4-20250514

# CLI 模式
npm run cli

# Web 模式
npm run web
```
