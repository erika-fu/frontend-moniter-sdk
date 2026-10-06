# Replay 会话录屏

录屏模块基于 rrweb 记录页面 DOM、输入和交互事件。事件默认只保存在浏览器内存中，不会持续上传；发生资源、JavaScript、Promise、Vue 或 React 错误后，SDK 才会上报最近一次完整 DOM 快照、快照后的近期事件，以及错误后的尾段事件。

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

`observeReplay()` 在已有录制器时不会重复启动 rrweb。重复调用会替换 `onReport`，并更新后续错误尾段使用的 `postErrorDuration`；屏蔽规则等 rrweb 录制参数应在首次启动前确定。

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
  bufferSize: 100,
  postErrorDuration: 2000,
});
```

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `onReport` | `(data: ReplayEventReportData) => void` | 无 | 每条回放事件进入统一分发后调用 |
| `bufferSize` | `number` | `100` | 最近一次完整快照后保留的近期事件数，最小为 1 |
| `postErrorDuration` | `number` | `2000` | 错误后继续录制的毫秒数，最小为 0 |
| `maskAllInputs` | `boolean` | `true` | 是否脱敏所有输入值 |
| `blockClass` | `string` | `"monitor-block"` | rrweb 屏蔽元素的 class |
| `blockSelector` | `string` | `"[data-monitor-mask]"` | rrweb 屏蔽元素的选择器 |

最近一次 DOM full snapshot 独立于环形缓存保存。full snapshot 之前 rrweb 生成的初始化事件也会保留，确保上报数据能够直接交给 rrweb 播放器。

录屏包含 DOM 结构和用户交互。输入值虽然默认脱敏，但页面文本、属性和未屏蔽区域仍可能包含敏感信息，接入前应按业务页面配置屏蔽范围。

## 2. 会话生命周期

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

两个 ID 的生命周期不同：

- `sessionId` 从 `observeReplay()` 成功启动到 `stopObserveReplay()` 保持不变，用于关联同一次页面录制中的多个错误；
- `replayId` 标识一段可独立播放的回放。错误片段上报完成后，SDK 会停止旧录制器、生成新的 `replayId` 和 DOM snapshot，再继续录制；
- `stopObserveReplay()` 会取消待执行的错误尾段定时器、停止 rrweb、清空内存事件，并结束当前 `sessionId`。再次启动会生成新的两个 ID。

## 3. 错误触发与尾段

录制期间产生的错误报告会附加：

```ts
interface ReplayErrorContext {
  replayId: string;
  sessionId?: string;
  replayOffset: number;
}
```

`replayOffset` 是错误发生时距当前回放片段开始的毫秒数。错误报告立即进入统一分发；回放事件默认在错误后继续采集 2 秒再批量进入统一分发，因此播放器可以展示错误前后的上下文。`postErrorDuration: 0` 会在错误发生后立即冲刷已经具备完整快照的片段。

如果错误发生在 rrweb full snapshot 产生之前，SDK 会暂缓冲刷，不会上报只有 Meta/bootstrap 事件的不可播放片段；full snapshot 到达后再冲刷完整事件序列。即使 snapshot 晚于错误尾段窗口到达，也会等待它，避免产生 0ms 的 Meta-only 回放。

尾段窗口内发生多个错误时，SDK 会把定时器延后，并只冲刷一次当前片段，避免重复上传相同事件；每条错误报告仍保留各自发生时的 `replayOffset`。片段冲刷时还会调用 `flushReportQueue()`，尝试立即发送错误和回放事件。

## 4. 回放地址与事件

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

每个 rrweb 事件会形成一条报告：

```ts
interface ReplayEventReportData {
  type: "replay";
  subType: "event";
  replayId: string;
  sessionId?: string;
  event: eventWithTime;
  startTime: number;   // rrweb 事件的 Unix 毫秒时间戳
  replayOffset: number;
  isCheckout?: boolean;
}
```

`isCheckout` 保留 rrweb 的 checkout 标记。服务端或回放页应按 `replayId` 分组，并按事件时间排序后交给 rrweb player。
