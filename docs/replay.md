# Replay 会话录屏

录屏模块基于 rrweb 记录页面 DOM、输入和交互事件。事件默认只保存在浏览器内存中，不会持续上传；发生资源、JavaScript、Promise、Vue 或 React 错误后，SDK 会上报最近一次完整 DOM 快照与错误前事件，并在同一回放片段中继续录制错误后的真实事件，直到空闲超时、达到最长继续时长，或触达事件/体积上限。

`init()` 不会自动启动录屏，需要显式调用：

```ts
import monitor from "frontend-moniter-sdk";

monitor.init({ url: "/monitor", appId: "web" });

// 在应用根节点挂载完成，并确定脱敏规则与用户授权后调用。
monitor.replay();

const session = monitor.getReplaySession();
console.log(session?.sessionId, session?.replayId);

monitor.stopObserveReplay();
```

以上方法也都有命名导出：

```ts
import {
  getReplaySession,
  observeReplay,
  stopObserveReplay,
} from "frontend-moniter-sdk";

observeReplay();
getReplaySession();
stopObserveReplay();
```

`observeReplay()` 在已有录制器时不会重复启动 rrweb。重复调用会替换 `onReport`，并更新后续继续录制使用的 `postErrorDuration` / `postErrorIdleTimeout`；屏蔽规则等 rrweb 录制参数应在首次启动前确定。

### 启动时机与生命周期归属

不要在框架根节点挂载前，直接从 `main.ts` 等应用入口模块开始录制。Replay 启动时，rrweb 会生成用于独立播放的首个 DOM full snapshot；SDK 也以该 snapshot 作为错误回放片段的基础。若先调用 `replay()`、后执行 Vue 的 `mount()` 或 React 的 `render()`，首个 snapshot 可能只包含空的挂载容器，而不包含已经渲染的应用。

这种写法还会产生时序不一致：rrweb 是否立即生成 snapshot 取决于调用时的文档就绪状态，因此同一段入口代码可能在不同加载方式下得到不同的初始页面。`init()` 只负责配置 SDK，不会启动 Replay；普通性能、行为和错误观察器的入口初始化方式不应直接套用于包含 DOM、页面文本和用户交互的 Replay。

推荐按以下顺序接入：

1. 调用 `init()` 完成 SDK 配置；
2. 挂载并渲染应用根节点；
3. 确定 `maskAllInputs`、`blockClass`、`blockSelector` 等隐私规则，并在业务要求授权时取得用户同意；
4. 自动开始策略可在框架的挂载后生命周期中调用 `replay()`；要求用户主动授权时，只从明确的“开始录制”操作调用；
5. 由同一个应用或组件生命周期持有录制，在卸载、退出或撤回授权时调用 `stopObserveReplay()`。

Vue 示例：

```ts
onMounted(() => {
  monitor.replay({
    blockSelector: "[data-private]",
  });
});

onBeforeUnmount(() => {
  monitor.stopObserveReplay();
});
```

如果确实需要从应用入口统一管理，也必须先保存挂载结果，并在 `mount()` / `render()` 完成后开始录制，同时为应用卸载设计对应的停止路径；关键约束不是文件名，而是“首个 snapshot 在应用完成渲染之后生成”以及“录制具有明确的生命周期所有者”。

Replay 与普通报告使用两套独立的批量边界：SDK 初始化的 `batchSize` 只决定普通监控报告何时发送，不会拆分 Replay 事件。当前 demo 在 [demo/src/main.ts](../demo/src/main.ts) 配置 `batchSize: 1`，含义是普通报告每批 1 条；Replay 事件按自身的事件数和数据量限制进入统一分发。

## 1. 配置与隐私

默认将所有输入框的值脱敏，并屏蔽以下元素及其子树：

- class 为 `monitor-block` 的元素；
- 带 `data-monitor-mask` 属性的元素。

可按页面需要覆盖：

```ts
observeReplay({
  onReport(report) {
    console.log(report);
  },
  maskAllInputs: true,
  blockClass: "private-content",
  blockSelector: "[data-private], .secret",
  preErrorDuration: 60_000,
  bufferSize: 100,
  maxReplayEvents: 1000,
  maxReplayBytes: 5 * 1024 * 1024,
  postErrorDuration: 5 * 60 * 1000,
  postErrorIdleTimeout: 30_000,
});
```

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `onReport` | `(data: ReplayEventReportData) => void` | 无 | 每条回放事件进入统一分发后调用 |
| `preErrorDuration` | `number` | `60000` | 错误前按 rrweb 时间戳保留的毫秒数，最小为 0 |
| `bufferSize` | `number` | `100` | 兼容旧配置；作为回放最大事件数的兜底上限 |
| `maxReplayEvents` | `number` | `1000` | 单个回放片段最多保留/上报的事件数 |
| `maxReplayBytes` | `number` | `5 MiB` | 单个回放片段最多保留/上报的 JSON 字节数 |
| `postErrorDuration` | `number` | `300000` | 错误后最长继续录制的毫秒数；`0` 表示立即冲刷并轮换 |
| `postErrorIdleTimeout` | `number` | `30000` | 错误后无新事件时结束继续录制的空闲毫秒数 |
| `maskAllInputs` | `boolean` | `true` | 是否脱敏所有输入值 |
| `blockClass` | `string` | `"monitor-block"` | rrweb 屏蔽元素的 class |
| `blockSelector` | `string` | `"[data-monitor-mask]"` | rrweb 屏蔽元素的选择器 |

最近一次 DOM full snapshot 独立于环形缓存保存。full snapshot 之前 rrweb 生成的初始化事件也会保留，确保上报数据能够直接交给 rrweb 播放器。

录屏包含 DOM 结构和用户交互。输入值虽然默认脱敏，但页面文本、属性和未屏蔽区域仍可能包含敏感信息，接入前应按业务页面配置屏蔽范围。

<<<<<<< Updated upstream
## 2. 环形缓存与片段轮换

「环形缓存」是比喻，不是真的画了个圆：容量有限，新事件进来，太旧或超限的事件被丢掉，始终只保留**最近一段**，避免从打开页面起一直攒全量录制把内存和上传打爆。

```text
时间 →
[太旧丢掉][... 最近 ≤ preErrorDuration 的增量 ...][新事件]
              ↑ 内存 buffer
```

### 错误前：怎么裁剪

平时事件只进内存、不上报。每来一条增量事件会：

1. `push` 进 `buffer`；
2. 按时间窗丢掉早于「最新事件时间 − `preErrorDuration`」的事件（默认 60 秒）；
3. 再用 `maxReplayEvents` / `maxReplayBytes` 从队头继续裁，防止条数或体积撑爆。

FullSnapshot 不进环形缓冲，单独保存在 `snapshot`；它之前的 Meta 等放在 `bootstrapEvents`。来到新的 FullSnapshot 时会清空增量缓冲，从新快照之后重开窗口。

### 错误后：继续录与重新开始

出错时 SDK 先冻结错误前窗口并上报（有完整 snapshot 时）；若 `postErrorDuration > 0`，在**同一 `replayId`** 下继续录错误后真实事件（不再进环形缓冲，而是直接进入上报）。

满足下列任一条件后会**轮换片段**（`rotateSession`）：

- 错误后空闲超时（默认 `postErrorIdleTimeout` 30 秒）；
- 达到最长继续时长（默认 `postErrorDuration` 5 分钟）；
- 继续录触达事件数 / 体积上限；
- `postErrorDuration: 0`（冲刷后立即轮换）。

轮换时会停止当前 rrweb 录制器、清空缓冲与计时状态，再 `startReplaySession()`：**生成新的 `replayId`**（`sessionId` 保持不变），重新 `record()`，等待新的 FullSnapshot 后回到环形缓冲模式。

```text
缓冲模式 (ring) --错误--> 冻结错误前 + 上报 + 继续录 (同 replayId)
                              |
                    空闲 / 超时 / 上限
                              ↓
                         rotateSession
                              ↓
                    新 replayId + 新 snapshot + 再缓冲
=======
## 2. 录制与上报的数据结构

rrweb 不是视频或截图采集器，也不直接发送网络请求。`record()` 通过 `emit` 回调产生按时间排序的 JSON 事件流；播放器先用完整快照恢复页面，再依次应用 DOM 变化和用户操作。可以将其理解为“初始页面状态 + 后续操作日志”。

### 2.1 rrweb 原始事件

每条 rrweb 事件都是带时间戳的联合类型：

```ts
type eventWithTime = {
  type: number;
  data: unknown;
  timestamp: number;
  delay?: number;
};
```

顶层 `type` 表示事件种类：

| `type` | 事件 | 内容 |
| ---: | --- | --- |
| `0` | `DomContentLoaded` | DOMContentLoaded 生命周期标记 |
| `1` | `Load` | 页面 load 生命周期标记 |
| `2` | `FullSnapshot` | 完整的序列化 DOM 树和初始滚动位置 |
| `3` | `IncrementalSnapshot` | DOM 变化、点击、输入、滚动等增量事件 |
| `4` | `Meta` | 页面 URL 和视口宽高 |
| `5` | `Custom` | 调用方主动添加的自定义事件 |
| `6` | `Plugin` | rrweb 插件产生的事件 |
| `7` | `Asset` | 资源事件 |

一段典型事件流为 `Meta → FullSnapshot → IncrementalSnapshot...`。`FullSnapshot` 不是 HTML 字符串或浏览器 DOM 对象，而是带节点 ID、可 JSON 序列化的节点树：

```json
{
  "type": 2,
  "data": {
    "node": {
      "type": 0,
      "id": 1,
      "childNodes": [
        {
          "type": 2,
          "id": 2,
          "tagName": "html",
          "attributes": {},
          "childNodes": []
        }
      ]
    },
    "initialOffset": { "top": 0, "left": 0 }
  },
  "timestamp": 1728300000001
}
```

这里外层 `type: 2` 表示 `FullSnapshot`，而 `node.type` 表示节点种类，例如 `0` 是 Document、`2` 是 Element、`3` 是 Text。后续增量事件通过节点 `id` 指向快照中的节点，不需要在每次页面变化时重新发送整棵 DOM。

`IncrementalSnapshot` 使用 `data.source` 区分变化来源：

| `source` | 内容 |
| ---: | --- |
| `0` | DOM Mutation，包括节点增删、文本和属性变化 |
| `1` | 鼠标连续移动 |
| `2` | 点击、按下、抬起、聚焦和失焦等离散交互 |
| `3` | 页面或元素滚动 |
| `4` | 视口尺寸变化 |
| `5` | 输入值或选中状态变化 |
| `6` | 触摸移动 |
| `7` | 音视频播放状态变化 |
| `8` | CSS 样式表规则变化 |
| `9` | Canvas 操作 |
| `10` | 字体数据 |
| `12` | 拖动轨迹 |
| `13` | CSS 声明变化 |
| `14` | 文本选择 |
| `15` | Adopted StyleSheet 变化 |
| `16` | Custom Element 定义 |

例如一次点击会记录为：

```json
{
  "type": 3,
  "data": {
    "source": 2,
    "type": 2,
    "id": 52,
    "x": 615,
    "y": 410,
    "pointerType": 0
  },
  "timestamp": 1728300000520
}
```

其中外层 `type: 3` 表示增量事件，`source: 2` 表示鼠标/指针交互，内层 `type: 2` 表示 Click，`id` 指向被点击的序列化 DOM 节点。

当前 SDK 开启完整 DOM、DOM Mutation、离散鼠标/指针交互、输入、滚动、视口、媒体、样式和文本选择等观察，并明确设置 `mousemove: false`。默认不会采集连续鼠标/触摸/拖动轨迹、Canvas 绘图指令、字体数据、网络请求、Console 日志、屏幕视频、图片像素或跨域 iframe 内部内容。输入值默认替换为 `*`；被屏蔽元素的子树不会序列化，但未屏蔽的页面文本和属性仍可能包含敏感信息。

### 2.2 SDK 包装结构

SDK 不直接发送裸 rrweb 事件，而是为每一条事件附加回放上下文：

```ts
interface ReplayEventReportData {
  type: "replay";
  subType: "event";
  replayId: string;
  sessionId?: string;
  event: eventWithTime;
  startTime: number;
  replayOffset: number;
  isCheckout?: boolean;
}
```

示例：

```json
{
  "type": "replay",
  "subType": "event",
  "replayId": "replay-1728300000000-ab12cd3",
  "sessionId": "session-1728300000000-xy98z76",
  "event": {
    "type": 3,
    "data": {
      "source": 2,
      "type": 2,
      "id": 52,
      "x": 615,
      "y": 410,
      "pointerType": 0
    },
    "timestamp": 1728300000520
  },
  "startTime": 1728300000520,
  "replayOffset": 520
}
```

`event` 保留原始 rrweb 事件；`replayId` 标识可独立播放的片段；Replay `sessionId` 关联同一次录制生命周期中的多个片段；`replayOffset` 是事件距当前片段开始的毫秒数。当前实现中的 `startTime` 等于 `event.timestamp`。

网络传输时，一条或多条 `ReplayEventReportData` 会放入统一的 `ReportEnvelope.data` 数组：

```json
{
  "protocolVersion": 1,
  "id": "id-1728300000700-k3jf8pq",
  "projectName": "storefront",
  "appId": "web",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": 1728300000700,
  "release": "web@1.0.0",
  "userId": "user-1",
  "user": { "id": "user-1" },
  "environment": {
    "url": "https://shop.example/cart",
    "userAgent": "Mozilla/5.0 ...",
    "language": "zh-CN"
  },
  "data": [
    {
      "type": "replay",
      "subType": "event",
      "replayId": "replay-1728300000000-ab12cd3",
      "sessionId": "session-1728300000000-xy98z76",
      "event": {
        "type": 4,
        "data": {
          "href": "https://shop.example/cart",
          "width": 1440,
          "height": 900
        },
        "timestamp": 1728300000000
      },
      "startTime": 1728300000000,
      "replayOffset": 0
    }
  ]
}
```

外层 `sessionId` 是 SDK 通用报告会话，`data[].sessionId` 是 Replay 录制会话，二者分别生成，不要求相同。服务端最终保存原始 rrweb `event`，回放页面按 `replayOffset` 排序后，将事件数组交给 rrweb player。

### 2.3 缓存与发送时机

Replay 不是边录制边持续上传。正常录制期间，SDK 在浏览器内存中分别保存初始化事件、最近一次完整快照和受时间/数量/体积限制的增量事件。发生受支持的资源、JavaScript、Promise、Vue 或 React 错误后，才会发送：

1. `Meta` 等初始化事件；
2. 最近一次 `FullSnapshot`；
3. 错误前窗口内的增量事件；
4. 错误后继续录制的真实事件。

未发生受支持的错误时，Replay 数据通常不会上传；调用 `stopObserveReplay()` 会停止 rrweb 并丢弃尚未触发发送的内存数据。错误报告本身是独立的 `type: "error"` 数据，不会插入 rrweb 事件流，而是通过 `replayId`、Replay `sessionId` 和 `replayOffset` 与回放关联。

因此，Replay 的完整数据链路是：

```text
rrweb eventWithTime
  → ReplayEventReportData
  → ReportEnvelope.data[]
  → 服务端保存并按 replayOffset 排序
  → rrweb player 重放
>>>>>>> Stashed changes
```

## 3. 会话生命周期

`getReplaySession()` 在录制中返回当前状态的副本，修改该对象不会影响 SDK 内部状态；未录制或 rrweb 启动失败时返回 `undefined`：

```ts
interface ReplaySession {
  id: string;        // 兼容字段，始终等于 replayId
  replayId: string;  // 当前可独立播放片段的 ID
  sessionId: string; // 本次页面录制生命周期的稳定 ID
  startTime: number; // performance.now() 时间轴上的片段起点
  startedAt: number; // Date.now() 时间轴上的片段起点
}
```

### `sessionId` 与 `replayId` 的区别

两者都会挂在错误报告和回放事件上，用来把「错误」和「录像」关联起来，但粒度不同：

| | `sessionId` | `replayId` |
| --- | --- | --- |
| 含义 | 一次页面录制生命周期 | 一段可独立播放的回放片段 |
| 可类比 | 同一次打开页面的整场录制 | **一条可播放的「视频」** |
| 何时不变 | `observeReplay()` 成功到 `stopObserveReplay()` | 同一片段内（含错误前上报 + 错误后继续录） |
| 何时换新 | 停止后再启动录制 | 片段轮换：空闲超时、达到最长继续时长、或触达事件/体积上限 |
| 主要用途 | 关联同一次页面录制中的多个错误、多个片段 | 按片段查询事件并交给播放器 |

因此：**一个 `replayId` 对应一段可独立播放的录像**；一次 `sessionId` 生命周期里可以先后出现多个 `replayId`。

```text
一次页面录制  sessionId = S1
├── 片段 A   replayId = R1   ← 错误前 + 错误后继续录，仍是同一条「视频」
└── 片段 B   replayId = R2   ← 轮换后的新片段 / 新「视频」
```

补充：

- 错误前片段会立即上报，错误后继续录制仍使用同一 `replayId`；轮换时 SDK 会停止旧录制器、生成新的 `replayId` 和 DOM snapshot，再回到缓冲模式；
- `stopObserveReplay()` 会取消待执行的继续录制定时器、停止 rrweb、清空内存事件，并结束当前 `sessionId`。再次启动会生成新的两个 ID。

## 4. 错误触发与继续录制

录制期间产生的错误报告会附加：

```ts
interface ReplayErrorContext {
  replayId: string;
  sessionId?: string;
  replayOffset: number;
}
```

这些字段是挂在 **error 报告本身**上的关联信息，不是另发一条请求：录屏进行中发生错误时，SDK 调用 `getReplayErrorContext()`，把当前片段的 ID 与时间偏移 merge 进同一条 `type: "error"` 数据。

### `replayOffset` 怎么算

错误报告上的 `replayOffset` 是错误发生时距**当前回放片段**开始的毫秒数：

```text
replayOffset = max(0, now - session.startTime)
```

- `now`：优先 `performance.now()`
- `session.startTime`：该 `replayId` 片段开始录制时记下的 `performance.now()`

播放器用它跳到出错时刻。继续录制期间若再次出错，每条错误仍各自计算当时的 `replayOffset`，不会共用同一个值。

回放事件自己携带的 `replayOffset` 用另一套时钟：`event.timestamp`（rrweb 墙钟）减 `session.startedAt`（`Date.now()`）。两者都表示「相对片段起点的偏移」，但时钟来源不同；错误定位以 error 上的 `performance.now()` 偏移为准。

SDK 平时按 `preErrorDuration` 保留最近一段真实 rrweb 事件，并以 `maxReplayEvents`/`maxReplayBytes` 作为上限。错误报告立即进入统一分发；具备完整 snapshot 后，错误前片段也会立即上报。之后 SDK 在同一 `replayId` 下继续录制真实事件（默认最长 5 分钟，空闲 30 秒结束），并把错误后事件流式写入统一分发，因此播放器可以展示错误前后的上下文。不会伪造空白操作事件；页面空闲时回放时长仍以最后一个真实事件为准。`postErrorDuration: 0` 会在错误发生后立即冲刷已经具备完整快照的片段并轮换。

如果错误发生在 rrweb full snapshot 产生之前，SDK 会暂缓冲刷，不会上报只有 Meta/bootstrap 事件的不可播放片段；full snapshot 到达后再上报完整事件序列并开始继续录制。

继续录制期间再次发生错误时，SDK 会延长空闲计时，并保持同一 `replayId`；每条错误报告仍保留各自发生时的 `replayOffset`。触达事件数或字节上限时会提前结束继续录制并轮换片段。

## 5. 回放地址与事件

`createReplayUrl()` 根据错误上下文生成带查询参数的绝对地址。相对 `baseUrl` 在浏览器中按当前页面解析，在非浏览器环境中按 `http://localhost` 解析：

```ts
if (error.replayId && error.replayOffset !== undefined) {
  const url = monitor.createReplayUrl("/replay", {
    sessionId: error.sessionId,
    replayId: error.replayId,
    replayOffset: error.replayOffset,
  });
}
```

回放页面应使用 `replayId` 查询并组合该片段的事件，使用 `replayOffset` 定位错误时刻；`sessionId` 用于把同一次页面录制产生的多个片段关联起来。

### 上传的是什么

上传的**不是视频文件**，而是一串 rrweb 事件（DOM 快照与增量变更）。平时只在内存缓冲；出错后（以及错误后继续录期间）再进入统一上报管道，仍走普通 `reportData` 信封（带 `projectName` / `appId` / `userId` 等）。

每个 rrweb 事件仍保留一条标准化数据记录，但同一个错误片段会由 SDK 聚合成一个受限上报批次；普通报告的 `batchSize` 不会拆散 replay 片段：

```ts
interface ReplayEventReportData {
  type: "replay";
  subType: "event";
  replayId: string;
  sessionId?: string;
  event: eventWithTime; // rrweb 原始事件
  startTime: number;    // = event.timestamp（Unix 毫秒）
  replayOffset: number;
  isCheckout?: boolean;
}
```

<<<<<<< Updated upstream
`event`（rrweb 的 `eventWithTime`）大致为：

```ts
{
  type: number;      // 事件类型
  data: unknown;     // 随 type 变化的载荷
  timestamp: number; // 墙钟毫秒
}
```

常见 `type`：

| type | 含义 |
| --- | --- |
| Meta | 页面元信息（地址、尺寸等） |
| FullSnapshot（值为 `2`） | 整页 DOM 快照；片段可播放的关键 |
| IncrementalSnapshot | 之后的增量：鼠标、输入、DOM 变更等 |

`isCheckout` 保留 rrweb 的 checkout 标记。示意：

```json
{
  "type": "replay",
  "subType": "event",
  "replayId": "replay-...",
  "sessionId": "session-...",
  "startTime": 1730000000123,
  "replayOffset": 4500,
  "event": {
    "type": 2,
    "timestamp": 1730000000123,
    "data": { "node": {}, "initialOffset": { "top": 0, "left": 0 } }
  }
}
```

### 服务端与 platform 如何消费

服务端或回放页应按 `replayId` 分组，并按事件时间排序。仓库内 server 提供 `GET /api/v1/replays` 列表和 `GET /api/v1/replays/:replayId?appId=...` 详情接口；详情返回 session 元数据及按 `replayOffset` 排序的事件。服务端会将片段标记为 `ready`、`incomplete` 或 `unplayable`，并限制每个 replay 最多 1000 个事件、30 分钟和 5 MiB。

platform 侧用 `rrweb-player`：把同一 `replayId` 下的 `event` 抽成数组交给播放器重放；若带有错误上的 `replayOffset`，再 `goto` 到出错时刻。完整筛选参数、响应结构和限制见 [Server 服务端文档](server.md)。
=======
`isCheckout` 保留 rrweb 的 checkout 标记。服务端或回放页应按 `replayId` 分组，并按事件时间排序后交给 rrweb player。仓库内 server 提供 `GET /api/v1/replays` 列表和 `GET /api/v1/replays/:replayId?appId=...` 详情接口；详情返回 session 元数据及按 `replayOffset` 排序的事件。服务端会将片段标记为 `ready`、`incomplete` 或 `unplayable`，并限制每个 replay 最多 1000 个事件、30 分钟和 5 MiB。完整筛选参数、响应结构和限制见 [Server 服务端文档](server.md)。

## 6. 回放实现

录制和回放使用 rrweb 的两套不同能力：

| 阶段 | 能力 | 作用 |
| --- | --- | --- |
| 录制 | `rrweb.record()` | 观察真实页面并产生 `eventWithTime[]` |
| 存储 | 仓库内 server | 保存、分组并按 `replayOffset` 排序事件 |
| 播放器 | `rrweb-player` | 提供播放区域、时间轴和控制界面 |
| 回放引擎 | `@rrweb/replay` 的 `Replayer` | 在隔离 iframe 中恢复 DOM 并执行事件时间线 |

平台直接使用 `rrweb-player`，没有在应用代码中直接创建底层 `Replayer`。`rrweb-player` 内部包装了 `@rrweb/replay` 的 `Replayer`，并提供播放/暂停、时间轴、倍速、跳过空闲片段和全屏等控制。

### 6.1 播放器输入

详情接口返回带服务端元数据的事件：

```ts
interface ReplayDetail {
  session: ReplaySession;
  events: Array<{
    timestamp: number;
    replayOffset: number;
    event: eventWithTime;
    isCheckout: boolean;
  }>;
}
```

服务端查询时按 `replayOffset` 和存储顺序排列事件。平台只提取其中的原始 rrweb 事件，将 `events.map(item => item.event)` 作为 `eventWithTime[]` 传给播放器；`timestamp`、`replayOffset`、`isCheckout` 等服务端包装字段不会传入 `rrweb-player`。播放器根据每条 rrweb 事件自身的 `timestamp` 建立时间线：

```ts
player = new rrwebPlayer({
  target,
  props: {
    events,
    autoPlay: false,
    width: 960,
    height: 540,
    maxScale: 1,
  },
});
```

回放过程为：

1. 根据 `Meta` 和 `FullSnapshot` 在隔离 iframe 中恢复初始页面；
2. 按时间应用 DOM Mutation、滚动、输入、媒体和样式等增量事件；
3. 在相应时间和节点位置展示点击等交互；
4. 通过播放器控制条驱动、暂停或跳转事件时间线。

缺少 `FullSnapshot` 的片段被标记为 `incomplete`，持久化事件无法解析的片段被标记为 `unplayable`；平台只为 `ready` 片段创建播放器。

### 6.2 定位错误时刻

错误报告保存的 `replayOffset` 表示错误发生时距回放片段起点的毫秒数。平台从错误进入回放时，将它作为 `initialOffset` 传给播放器组件；播放器创建后读取总时长并调用：

```ts
const totalTime = player.getMetaData().totalTime;
player.goto(Math.min(initialOffset, Math.max(0, totalTime)));
```

当前配置为 `autoPlay: false`，因此 `goto()` 会先把页面恢复到错误时刻并停留在那里，等待用户主动播放。组件卸载时调用 `pause()` 并销毁播放器，避免回放任务在离开页面后继续运行。

完整链路如下：

```text
rrweb.record()
  → eventWithTime[]
  → SDK 包装、错误触发上报
  → server 持久化并按 replayOffset 排序
  → 平台提取 eventWithTime[]
  → rrweb-player
  → 内部 @rrweb/replay Replayer 重建并播放页面
```
>>>>>>> Stashed changes
