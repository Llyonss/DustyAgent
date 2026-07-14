# GraphView — `.graph` 接口图视图

> 一个人一眼接手用的完整设计文档：从**为什么做**到**怎么实现**。

---

## 一、目标：认识一个陌生系统

接手陌生代码时，人脑要回答三层问题：

1. **系统支持哪些功能？** —— 功能清单
2. **什么架构支撑这些功能？** —— 每个功能的数据怎么流、穿过哪些模块
3. **每个模块的职责和代码位置？** —— 节点标注职责 + 文件锚点

GraphView 就是把这三层认知，变成一张**可交互的图**。

### 关键抉择：把"功能"钉成"接口"

"功能"是人嘴里说的，主观、无法校验。**"接口"是代码里长着的**，可枚举、可核对：

- **后端接口** = HTTP 路由 / WebSocket / 定时任务（`grep app.get/post/delete` 就能枚举，一个不多一个不少）
- **前端接口** = 命令（按钮，控件值就是入参，如"发送消息"）+ 查询（视图，渲染列表就是出参，如"对话气泡列表"）

一个接口 = 一条从"用户触发"到"数据落地/读取"的完整执行链。命令链写存储、查询链读存储，**两条链在存储处汇合**——存储因此被显式画出来，成为架构的骨架。

### 关键抉择：图数据由 agent 生成，不靠静态解析

早期方案想用 acorn 静态解析代码建图，被否决。原因：

- 静态能解析出的边（同文件调用、import）恰恰是看代码 10 秒就懂的，**低价值**
- 真正难懂、图才值钱的边（HTTP↔路由、WS、事件、fs 间接耦合）**静态解析不出来**
- "模块职责"这种语义描述，解析器根本产不出

所以翻转：**`.graph` 是 agent 读代码后生成的"系统认知快照"（JSON）**，渲染器只管画。过期了让 agent 重跑刷新 → 不腐烂。产图侧和看图侧因此都闭环。

---

## 二、数据模型：`.graph` 文件

一个 JSON 文件，`.graph` 扩展名。样例见同目录上级的 `web.graph`（描述本 web 模块自身）。

```jsonc
{
  "root": "src/agent/mental/web",        // 图的范围（目录），左侧目录树以此为根

  "stores": [                            // 存储：命令写/查询读的汇合点 = 架构骨架
    { "id": "events", "path": "mental/instances/*/events/*.json",
      "desc": "事件流文件，系统唯一事实源" }
  ],

  "interfaces": [
    {
      "id": "chat.send",                 // 唯一 id，习惯用 "域.动作"
      "kind": "command",                 // command▶ | query◉ | duplex⇄ | http | ws | cron
      "group": "对话",                    // 功能域分组（顶部版面按此聚块）
      "groupHint": "left",               // 布局参考：left | right | overlay | top
      "label": "发送消息",
      "at": "index.html#sendBtn",        // 前端触发锚点（DOM）
      "in": ["输入框文本"],               // 接口入参（控件值）
      "desc": "用户发消息→落盘→驱动循环",
      "refresh": "200ms轮询",            // 查询类的刷新策略（可选）

      "writes": ["events"],              // 写哪些 store（命令链）
      "reads": [],                       // 读哪些 store（查询链）

      "steps": [                         // 执行链：一步一个节点
        { "id": "send", "file": "public/chat/index.js", "symbol": "Chat.send",
          "desc": "读输入框、清空、失败回填", "in": ["#chatInput"], "out": ["text"] },
        { "id": "core", "file": "../../core/loop.js", "symbol": "loop",
          "external": true,              // root 之外的文件 → 归入"外部依赖"
          "desc": "agent推理循环" },
        { "id": "ext", "file": "zenmux.ai/api", "service": "ZenMux",
          "external": true, "desc": "外部服务" }  // 带 service = 外部服务，非文件
      ],

      "edges": [                         // 步骤间的边，标 kind（value 之处在此）
        { "from": "send", "to": "core", "kind": "async", "label": "for await" }
      ]
    }
  ]
}
```

### 字段约定（重要）

- **`step.file` 基准 = 相对 root**：内部文件直接写相对路径（`public/chat/index.js`）；外部文件用 `../` 跳出（`../../core/loop.js`）
- **`external: true`** = 该文件在 root 之外，收进底部"外部依赖"分组（只画不展开）
- **带 `service` 字段** = 外部服务（非真实路径，如 `zenmux.ai/api`），显示为"名称（地址）"
- **`edges.kind`** = 边的类型，决定颜色和虚实：
  | kind | 颜色 | 语义 | 静态可解析? |
  |---|---|---|---|
  | call | 青 | 函数调用 | 是 |
  | http | 黄 | HTTP 请求 | **否** |
  | ws | 紫 | WebSocket | **否** |
  | async | 橙(虚) | 异步迭代 | **否** |
  | fs | 绿(点) | 经文件系统间接耦合 | **否** |
  | write/read | 红/蓝(虚) | step↔store | 推导 |

  → 标 `否` 的正是图的价值：这些边是读代码最容易迷路的地方。

---

## 三、界面：三区 + 联动

```
┌──────────────────────────────────────────────────────────┐
│  接口版面（分组平铺，参考页面布局摆放，一眼看全所有接口）        │  gv-tabs
│  ┌实例(top)──────────────────────────────────────┐       │
│  │ 实例列表 创建 删除                                │       │
│  ├对话(left,青)──────┬心智(right,紫)──────────────┤       │
│  │ 发送 气泡 停止 继续 │ 图谱 内容 保存               │       │
│  ├分支(left)─────────┼文件(right)─────────────────┤       │
│  ...                                                       │
├────────────┬─────────────────────────────────────────────┤
│ 左侧目录树   │  画布：选中接口的执行链（可拖拽平移）           │
│ (真实目录)   │   node → node → store，边按 kind 着色         │
└────────────┴─────────────────────────────────────────────┘
       gv-tree                        gv-canvas
```

### 版面（顶部）
- 所有接口按 `group` 聚成块，块按 `groupHint` 分区摆放（left|right 并排、top 横跨、overlay 贴下）
- "参考"真实页面布局，不追求像素还原
- 点任一接口 → 画布切到它的执行链 + 左树高亮

### 左侧目录树
- **真实目录树**：调 `/api/files` 懒加载 root 的真实内容（不是只显示相关文件）
- 相关目录自动展开、显示其下**全部**文件；相关文件青色高亮，无关文件灰
- **外部依赖**：全图所有接口的外部文件汇总成一棵树（公共根归拢），固定不变
- **外部服务**：显示"名称（地址）"
- **存储**：全图 store 全集
- **规则统一**：树只建一次，切接口只切高亮、不重建

### 画布（中间）
- Y 轴 = 文件在目录树中的泳道位置；X 轴 = 执行链拓扑序
- 节点 = 一个 step，显示 symbol + 职责描述（截断），hover 弹浮层看完整 desc + 出入参
- store 节点 = 中间立柱，命令写→它、它→查询读
- 左键按住拖拽平移

### 双向联动
- 选接口 → 高亮左树相关文件 + 画布画链
- hover 画布节点 → 高亮左树对应文件行（青底+左边框）
- hover/点左树文件 → 高亮画布对应泳道

---

## 四、代码结构（MECE，一句话职责）

挂载点：`../files/index.js` 的 `_renderFile` 中 `ext==='graph'` 分支 → `GraphView.renderTo(el, text)`。
**后端零改动**（`.graph` 是文本，`/api/file` 已能读；目录树复用 `/api/files`）。

| 文件 | 职责（不含"并且"） |
|---|---|
| `index.js` | 入口，编排 parse→layout→render→interact，管版面渲染与接口切换 |
| `parse.js` | `.graph` 字符串 → 校验规整的 data 对象 |
| `layout.js` | 单接口 → positions + 泳道（算坐标，不碰 DOM） |
| `render.js` | data + positions → SVG 字符串（拼字符串，不算坐标） |
| `interact.js` | 给画布 DOM 挂 hover 浮层 + 双向高亮联动（回调式，不反向依赖 index） |
| `tree.js` | 接口/全图 → 树数据（`collectAll` 全图收集 / `relatedOf` 单接口相关身份） |
| `gvtree.js` | 真实目录树：`buildRealTree` 建一次 / `applyRelated` 切接口只切高亮 |
| `pan.js` | 滚动容器左键拖拽平移 |
| `view.css` | 视图样式（版面 / 树 / 画布 / 浮层） |

### 数据流（管道，单向无 W→R 冲突）
```
graphText(R) → parse → data(R)
                        ├→ collectAll(全图) → 外部树/服务/存储全集 → 渲一次
                        ├→ buildRealTree → 真实目录树 → 建一次
                        └→ 每次选接口:
                             layout(iface) → positions
                             render(iface,positions) → SVG
                             relatedOf(iface) → 相关身份 → applyRelated 切高亮
                             interact 挂事件
```

### 身份约定
- **文件行身份 = 项目根规范路径 `projPath`**（跨接口稳定，切高亮靠它匹配）
- **画布泳道联动 = `laneKey`**（= `step.file` 原值，与 SVG `data-gv-file` 对应）

---

## 五、修过的坑（接手避雷）

1. **画布拖不动**：`#fileBody` 是 `display:block` + `min-width:auto`，被 SVG 内容撑爆到超出视口 → 容器无溢出 → 无处可滚。修复：`#fileBody:has(.gv-root)` 加 `flex:1; min-width:0`，链上各级都要 `min-width:0`。pan.js 本身没问题。
2. **目录树塌陷**：`.graph` 视图要撑满 `#fileScroll`，用 `:has()` 抵消其 padding 并 `display:flex`。
3. **external 路径写错**：`step.file` 基准是相对 root，`../../../core/loop.js` 规范化后要真正跳出 root 才会被归为外部。

---

## 六、验证方式

- **纯逻辑**：`node` 直接跑 parse→layout→render / collectAll / buildTree（都是纯函数，不依赖 DOM）
- **视觉+交互**：playwright（headless chromium，带 Basic Auth）打开真实服务、`Files.openFile('...web.graph')`、截图 + 打印 DOM 状态 + 派发真实鼠标事件二分定位
- 测试脚本用完即删，不留在目录

---

## 七、未做（下一批：让 `.graph` 变准的杠杆）

1. **孤儿文件检测**：root 真实文件 ∖ 接口涉及文件 = 孤儿，左树标红，反哺补全遗漏的接口（`.graph` 自我完备性校验，最有价值）
2. **选文件反查功能**：选左树某文件 → 隐约高亮所有用到它的接口
3. **后端参数拓扑**：从 store 的 reads/writes **自动推导**接口间依赖（A writes X、B reads X → 关联），不腐烂

---

## 附：如何为一个新目录生成 `.graph`

让 agent：
1. `grep` 后端路由文件枚举所有 HTTP/WS/cron 接口（客观基线）
2. 通读前端，找出命令（按钮）和查询（视图列表）
3. 每个接口追踪执行链：入口 → 中间步骤 → 写/读哪个存储
4. 边标 `kind`（尤其 http/ws/fs/async 这些静态解析不出的）
5. 补 `group`/`groupHint`（功能域 + 布局参考）、external、service
6. 校验：接口清单 diff 路由 grep 结果，应无遗漏
```
