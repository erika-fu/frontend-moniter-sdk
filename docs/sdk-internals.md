# SDK 公共入口与内部链路

本文覆盖各监控模块之外的公共代码：入口、配置、统一分发、缓存、传输，以及错误与录屏的关联链路。

## 1. 入口

`src/index.ts` 导出 `SDK_NAME`、`init`、`subscribe`、performance/behavior/error/replay 模块入口、细粒度观察器、框架错误入口和 report 工具。

默认对象提供 `performance`、`behavior`、`error`、`replay` 四个启动入口，并公开 `createReplayUrl`、`getReplaySession`、`stopObserveReplay`。为了兼容需要显式命名的调用方式，默认对象还提供 `observePerformance`、`observeBehavior`、`observeError`、`observeReplay`；更细的观察器继续通过包根命名导出。

`SDKOptions` 等于 `ReportConfigOptions`。`init(options = {})` 只调用 `setConfig`，不会安装监听器；启动模块时才检查浏览器能力，因此初始化本身可以在 SSR 代码中执行。

## 2. 统一链路

```text
浏览器事件/API
  -> observeXxx 整理字段
  -> dispatchReport(data, onReport)
  -> lazyReportBatch(data) -> 缓存 -> 达到阈值后 flush -> report
  -> notifyReportListeners(data)
  -> 当前 onReport(data)
```

三条路径都做异常隔离，监控逻辑不会因业务回调或发送实现抛错而影响页面。

## 3. 配置

默认配置：

```ts
{
  url: "",
  projectName: "",
  appId: "",
  userId: "",
  release: "",
  isImageUpload: false,
  batchSize: 5
}
```

`setConfig` 只修改非 `undefined` 字段；`getReportConfig` 返回浅副本；`resetReportConfig` 恢复默认值。`release` 会附加到有堆栈意义的 JavaScript、Promise、Vue 和 React 错误，用于服务端选择 SourceMap，不属于 envelope 字段。配置是页面/模块级状态，不是每条报告独立配置。

## 4. 缓存和订阅

`src/cache.ts` 只在模块内部持有缓存。入队和读取都会复制数据，优先使用 `structuredClone`，失败后递归处理数组、普通对象、Date、RegExp 和循环引用，防止回调修改待发送数据。

`flushQueue` 先取快照再发送，只有传输返回 true 才清空；因此 Beacon 被拒绝时数据仍在缓存。`subscribeReports(listener)` 返回取消函数，所有订阅者分别 try/catch；订阅收到的是单条原始采集数据，不是 envelope。

## 5. Report API

| 函数 | 接收 | 返回 | 作用 |
| --- | --- | --- | --- |
| `report(data)` | 任意可 JSON 序列化数据 | `boolean` | 包 envelope 并选择传输 |
| `beaconRequest(data)` | JSON 字符串 | `boolean` | 返回 Beacon 是否接受 |
| `imgRequest(data)` | JSON 字符串 | `boolean` | Image 查询参数发送 |
| `xhrRequest(data)` | JSON 字符串 | `boolean` | 使用原始 XHR 异步 POST |
| `lazyReportBatch(data)` | 任意数据 | `boolean` | 入缓存，达到阈值时 flush |
| `flushReportQueue()` | 无 | `boolean` | 立即发送缓存 |
| `clearReportQueue()` | 无 | `void` | 内部清空缓存；当前未从包根导出 |

`createEnvelope` 生成 `{ id, projectName, appId, userId, data }`。SDK 在模块加载时捕获原始 XHR `open/send`，避免启用 XHR 监控后把 SDK 自己的上传请求再次采集。

## 6. 错误与录屏

录屏运行时，错误模块先调用 `getReplayErrorContext()`，把 `sessionId`、`replayId` 和 `replayOffset` 写入错误报告，再调用 `flushReplayOnError(context)`。录屏模块平时按 `preErrorDuration` 保留最近真实事件，并以事件数和字节数限制内存；错误报告与错误前回放片段立即分发，随后在同一 `replayId` 下按 `postErrorDuration` / `postErrorIdleTimeout` 继续录制并把错误后事件流式分发，不受普通 `batchSize` 拆分影响。不会生成虚假 rrweb 事件。

`sessionId` 标识一次页面录制生命周期，`replayId` 标识一次可独立播放的错误片段。继续录制结束后保留 `sessionId`，生成新的 `replayId` 和 DOM snapshot；显式停止录屏后两个 ID 都结束。

## 7. 事件路径

`getSerializableEventPath` 优先 `event.composedPath()`，旧环境回退 `event.path`，将 Window、Document、tagName、nodeName 或构造器名称转换为 `string[]`。不保存 DOM 对象是为了避免循环引用和不可序列化。

## 8. 行为模块中的 History 包装

行为自动 PV（`src/behavior/autoPageView.ts`）会包装 `history.pushState` 和 `history.replaceState`，以便覆盖路由库常用、但不会触发 `popstate` 的导航。包装策略与 Fetch / XHR 一致：

1. 保存原始方法；
2. 用包装函数替换，先调用原方法，成功返回后再调用 `observePV()`；
3. 不修改参数和返回值；
4. `stopObserveAutoPageView()` / `stopObserveBehavior()` / `stopObservePageChange()` 仅在当前方法仍等于 SDK 包装函数时还原。

PV 去重状态保存在 `src/behavior/pv.ts` 的模块级变量中。`stopObserveBehavior()` 会调用 `clearPageViewDedup()`，避免停止后再启动时被旧地址挡住首条 PV。

`pageChange` 与自动 PV 并行：前者产出 `hashchange` / `popstate` 底层信号，后者统一产出 `subType: "pv"`。细节见 [Behavior 用户行为监控](behavior.md) 和 [SPA 页面访问（PV）自动采集设计](solutions/spa-page-view-tracking.md)。

## 9. 边界规则

- SSR/Node 缺少浏览器对象时观察器直接跳过；
- 回调、订阅和传输异常不会传播到页面；
- 网络失败时缓存保留；
- 停止录屏会取消尚未触发的继续录制定时器并清空内存事件；
- stop 函数只恢复仍是 SDK 包装函数的对象（含 `fetch`、XHR 原型方法、History 方法），不覆盖其他工具后来做的替换；
- SDK 不调用 `preventDefault`，不改变业务事件、Promise、History 导航或请求结果。
