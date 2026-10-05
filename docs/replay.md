# Replay 会话录屏

录屏模块基于 rrweb 记录页面 DOM、输入和交互事件。事件默认只保存在浏览器内存的环形缓存中，不会持续上报；只有发生异常时，SDK 才会发送最近一次 DOM 快照和快照之后的近期事件。录屏不会在 `init()` 时自动启动，需要显式调用：

```ts
import monitor, {
  observeReplay,
  stopObserveReplay,
} from "frontend-moniter-sdk";

monitor.init({ url: "/monitor", appId: "web" });
observeReplay();
stopObserveReplay();
```

也可以使用默认导出的 `monitor.replay()`。`observeReplay()` 在同一个页面重复调用只更新回调，不会创建第二个 rrweb 录制器。

## 隐私保护

默认配置会将所有输入框的值脱敏，并屏蔽以下元素及其子树：

- class 为 `monitor-block` 的元素
- 带 `data-monitor-mask` 属性的元素

可按页面需要覆盖：

```ts
observeReplay({
  maskAllInputs: true,
  blockClass: "private-content",
  blockSelector: "[data-private], .secret",
  bufferSize: 100,
});
```

`bufferSize` 控制异常发生前保留的近期 rrweb 事件数量，默认值为 `100`。最近一次 DOM full snapshot 会独立保留，因此异常上报的数据可以直接交给 rrweb 播放器恢复页面。

## 错误定位

录制期间产生的错误报告会附加 `sessionId`、`replayId` 和 `replayOffset`。`sessionId` 是错误报告与 rrweb 事件的共同会话标识，`replayId` 为兼容已有消费者保留的别名；`replayOffset` 是错误发生时距录制开始的毫秒数。异常触发时，错误报告和同一 `sessionId` 的 `replay` 事件会一起冲刷上报，因此服务端可以按会话和相对时间定位错误。

SDK 提供 `createReplayUrl()` 生成回放页地址，回放页面读取这两个查询参数即可定位：

```ts
const url = createReplayUrl("/replay", {
  sessionId: error.sessionId,
  replayId: error.replayId,
  replayOffset: error.replayOffset,
});
```

录屏事件的形状为 `ReplayEventReportData`，其中 `event` 是 rrweb 事件，`sessionId` 与错误报告一致，`startTime` 是 rrweb 事件时间戳，`replayOffset` 是统一的相对毫秒时间轴。
