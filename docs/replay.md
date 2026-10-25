# Replay 会话录屏

录屏模块基于 rrweb 记录页面 DOM、输入和交互事件。事件默认只保存在浏览器内存中，不会持续上传；发生资源、JavaScript、Promise、Vue 或 React 错误后，SDK 会上报最近一次完整 DOM 快照与错误前事件，并在同一回放片段中继续录制错误后的真实事件，直到空闲超时、达到最长继续时长，或触达事件/体积上限。

`init()` 不会自动启动录屏，需要显式调用：

```ts
import monitor from "frontend-moniter-sdk";

monitor.init({ url: "/monitor", appId: "web" });
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
