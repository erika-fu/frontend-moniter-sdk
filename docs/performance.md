# Performance 性能监控

本文是 `src/performance/` 的权威实现指南，说明 SDK 如何采集性能数据、各采集器为何使用特定浏览器 API、报告如何经过共享上报管道，以及数据不得被过度解读的边界。

该模块当前会产生十种报告子类型：

- `first-paint`
- `first-contentful-paint`
- `largest-contentful-paint`
- `view-first-contentful-paint`
- `view-largest-contentful-paint`
- `key-content-paint`
- `load`
- `resource`
- `fetch`
- `xhr`

它不采集 CLS、INP、作为独立 Web Vital 的 TTFB、长任务、内存、FPS 或自定义标记。资源报告确实包含一个派生字段 `ttfb`，但该值描述的是单个资源请求，而非页面级 TTFB Web Vital。

`view-first-contentful-paint`（View First Contentful Paint）是 Page View 作用域的 View Paint Metric，与文档级 `first-contentful-paint` 相互独立；不会由 `monitor.performance()` 自动启动，需业务调用 `markViewFirstContentfulPaint()`、`observeViewFirstContentfulPaint()`，或在支持时通过 `observeSoftNavigationViewPaint()` 使用原生 Soft Navigation。

`view-largest-contentful-paint`（View Largest Contentful Paint）同样属于 Page View，与文档级 `largest-contentful-paint` 相互独立。它观察声明的首屏内容区，候选只保留在本地，每个 `viewId` 最多上报一次最终值。不会由 `monitor.performance()` 自动启动，需业务调用 `observeViewLargestContentfulPaint()`，或在支持时通过 `observeSoftNavigationViewPaint()`。

`key-content-paint`（Key Content Paint）测量应用声明的任务关键内容可见耗时，与最大元素无关，也不是 View LCP 的别名或回退。每个 `(viewId, keyContentName)` 最多上报一次；不会由 `monitor.performance()` 自动启动，需业务调用 `markKeyContentPaint()` 或 `observeKeyContentPaint()`。

性能采集器只创建报告并将其交给 SDK 全局分发器。安装与应用集成见 [业务使用](business-usage.md)，共享缓存 / envelope / 传输行为见 [SDK 入口与内部机制](sdk-internals.md)，端点、存储、保留和查询契约见 [服务端文档](server.md)。

## 1. 公共 API 与启动

需要网络发送时，应先配置上报，再启动性能采集：

```ts
import monitor from "frontend-moniter-sdk";

monitor.init({
  url: "/api/v1/reportData",
  appId: "web",
});

monitor.performance({
  onReport(report) {
    console.log(report.subType, report);
  },
});
```

`init()` 只更新共享上报配置。它不会安装采集器；仅回调或仅订阅的采集也不需要它。网络入队要求已配置 `url`。默认导出将聚合采集器同时暴露为 `performance` 和 `observePerformance`。

`PerformanceMonitoringOptions` 有一个可选字段：

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `onReport` | `(report: PerformanceReportData) => void` | 无 | 接收此次聚合注册产生的每条报告；不替代全局订阅或网络上报 |

细粒度采集器从包根以命名导出的方式提供：

```ts
import {
  observePaint,
  observeFCP,
  observeLCP,
  observeLoad,
  observeResources,
  observeFetch,
  stopObserveFetch,
  observeXHR,
  stopObserveXHR,
  markViewFirstContentfulPaint,
  observeViewFirstContentfulPaint,
  stopObserveViewFirstContentfulPaint,
  observeViewLargestContentfulPaint,
  stopObserveViewLargestContentfulPaint,
  observeSoftNavigationViewPaint,
  stopObserveSoftNavigationViewPaint,
  isSoftNavigationSupported,
  getSoftNavigationSupport,
  markKeyContentPaint,
  observeKeyContentPaint,
  stopObserveKeyContentPaint,
} from "frontend-moniter-sdk";
```

默认导出不暴露这些细粒度函数。`observePerformance()` 没有聚合停止函数；只有 Fetch、XHR、View FCP、View LCP、Soft Navigation View Paint 与 Key Content Paint 观察器具有显式停止 API。

## 2. 模块职责与生命周期

| 文件 | 职责 | 模块级状态 | 产出 |
| --- | --- | --- | --- |
| `src/performance/index.ts` | 定义报告联合类型并启动文档级采集器 | 无 | 转发文档级七种子类型 |
| `observePaint.ts` | 读取原生 First Paint 条目 | 无；每次调用创建一个观察器 | `first-paint` |
| `observeFCP.ts` | 适配 `web-vitals` FCP 输出 | 每次调用的生命周期由 `web-vitals` 持有 | `first-contentful-paint` |
| `observeLCP.ts` | 适配 `web-vitals` LCP 输出 | 每次调用的生命周期由 `web-vitals` 持有 | `largest-contentful-paint` |
| `observeViewFCP.ts` | Page View 作用域的 View First Contentful Paint | 已上报 `viewId`、声明区 MutationObserver | `view-first-contentful-paint` |
| `observeViewLCP.ts` | Page View 作用域的 View Largest Contentful Paint | 已上报 `viewId`、声明区 MutationObserver、最终确定监听与超时 | `view-largest-contentful-paint` |
| `observeSoftNavigationViewPaint.ts` | 原生 Soft Navigation 作为 VFCP/VLCP 优先 Measurement Source | Soft Navigation 支持状态、PerformanceObserver、等待中的 viewId、VLCP 绑定 | `view-first-contentful-paint` / `view-largest-contentful-paint`（`measurementSource: soft-navigation`） |
| `viewPaintClaim.ts` | View Paint 正式样本去重与来源优先级 | 已 claim 的 viewId、暂存的低优先级 emit、soft-nav 优先开关 | 无独立报告 |
| `observeKeyContentPaint.ts` | Page View 作用域的 Key Content Paint | 已上报 `(viewId, name)`、按名称的 MutationObserver | `key-content-paint` |
| `observeLoad.ts` | 测量文档加载完成 | 无；每次加载前调用添加一个一次性监听器 | `load` |
| `observeResources.ts` | 获取一次缓冲的首屏加载资源快照 | 无；每次调用创建监听器或观察器 | `resource` |
| `observeFetch.ts` | 包装当前 `window.fetch` | 被观察的所有者、原始 / 包装后的函数、最新回调 | `fetch` |
| `observeXHR.ts` | 包装 `XMLHttpRequest.prototype.open/send` | 被观察的原型、原始 / 包装后的方法、最新回调 | `xhr` |

这些状态属于一个已加载的 SDK 模块实例。加载两份相互独立的 SDK 副本会创建两套观察器和包装器。

### 2.1 聚合注册链

`observePerformance(options)` 按以下顺序同步注册采集器：

```text
monitor.performance(options)
  -> observePerformance(options)
       -> observePaint(options.onReport)
       -> observeFCP(options.onReport)
       -> observeLCP(options.onReport)
       -> observeLoad(options.onReport)
       -> observeResources(options.onReport)
       -> observeFetch(options.onReport)
       -> observeXHR(options.onReport)
```

这是注册顺序，而非报告到达顺序。缓冲的时间线条目可能会在注册后很快送达，load 和资源数据等待文档生命周期状态，LCP 等待最终确定，网络报告则等待请求完成。

### 2.2 重复启动与停止

除非有意重复进行文档级观察，否则应在应用启动期间只调用一次聚合入口：

- 每次调用 `observePaint()`、`observeFCP()` 或 `observeLCP()` 都会创建另一项观察器注册；
- 每次在加载前调用 `observeLoad()` 或 `observeResources()` 都会添加另一个一次性 `load` 监听器；在加载后调用会创建另一个计划执行的测量或资源观察器；
- 当其包装器仍已安装时，再次调用 `observeFetch()` 不会再次包装；它会替换当前采集器专用回调；
- 当两个 SDK 原型包装器仍已安装时，`observeXHR()` 的行为相同；
- `stopObserveFetch()` 和 `stopObserveXHR()` 只恢复仍等于 SDK 包装器的方法，因此不会覆盖后来由其他工具安装的包装器；
- 停止包装器只影响未来发起的调用，不会取消已经发出但尚未完成的 Fetch 或 XHR。既有闭包 / 监听器仍可通过共享分发器发送完成报告，但已清除的采集器专用回调不会再被调用。

停止任一网络采集器不会发送或清空共享报告队列、取消订阅全局监听器、重置 `init()` 配置，也不会停止任何其他监控模块。

## 3. 采集器概览

| 采集器 / `subType` | 浏览器来源 | 报告触发时机与数量 | 时间域 | 读取 `pageUrl` 的时机 | 生命周期 / 停止边界 |
| --- | --- | --- | --- | --- | --- |
| FP / `first-paint` | 原始 Paint Timing | 首个匹配的缓冲 FP 条目；通常每次注册一次 | 页面 performance 时间原点 | 观察器回调 | 匹配后断开；无停止 API |
| FCP / `first-contentful-paint` | `web-vitals` `onFCP` | 最终确定的 FCP；BFCache 恢复可创建另一项指标 | 页面相对时间，经 `web-vitals` 调整 | 指标回调 | 由 `web-vitals` 管理；无 SDK 停止 API |
| LCP / `largest-contentful-paint` | `web-vitals` `onLCP` | 最终确定的 LCP；BFCache 恢复可创建另一项指标 | 页面相对时间，经 `web-vitals` 调整 | 指标回调 | 由 `web-vitals` 管理；无 SDK 停止 API |
| Load / `load` | Navigation Timing 和 `load` 事件 | 每次具有可用时序数据的注册一次 | 导航相对毫秒数 | 下一动画帧 | 一次性；无停止 API |
| Resource / `resource` | Resource Timing | 首个已送达缓冲列表中每个条目一条报告 | 页面 performance 时间原点 | 观察器回调 | 首次加载快照后断开；无停止 API |
| Fetch / `fetch` | `window.fetch` 包装器 | 每个被包装 Promise 成功兑现或拒绝时一次 | `Date.now()` 返回的 Unix 毫秒 | 请求完成时 | 长生命周期包装器；显式停止 |
| XHR / `xhr` | XHR 原型包装器 | 每次被包装的 send 在 `loadend` 时一次 | `Date.now()` 返回的 Unix 毫秒 | `loadend` 时 | 长生命周期包装器；显式停止 |

不要把不同时间域中的值当作共享同一原点来相减或排序。特别是，FP / resource / Web Vitals 值不是 Unix 时间戳，而 Fetch / XHR 的 `startTime` 和 `endTime` 是。

## 4. 共享报告管道

每个采集器构造其子类型专属对象，并调用同一个 `dispatchReport()` 函数：

```text
浏览器 API 或被包装的请求
  -> 采集器规范化 PerformanceReportData 对象
  -> dispatchReport(report, collectorOnReport)
       -> lazyReportBatch(report)
            -> 共享内存缓存（报告的克隆）
            -> 达到 batchSize / pagehide / document hidden / 显式 flush
            -> createEnvelope(batch)
            -> Image，或 Beacon 并回退至原始 XHR
       -> notifyReportListeners(report)       // 全局 subscribe()，一次一条报告
       -> collectorOnReport(report)           // 仅本次采集器注册
  -> 已配置 URL（仓库服务端推荐 /api/v1/reportData）
       -> envelope 结构校验
       -> SQLite envelope ID 去重与规范化事件存储
       -> 基于 SQLite 的性能指标 / 请求 / 资源查询
       -> 监控平台
```

### 4.1 分发顺序与隔离

对于一条报告，`dispatchReport()` 严格按以下顺序运行：

1. 尝试将报告添加到网络批次；
2. 通知 SDK 全局 `subscribe()` 监听器；
3. 调用采集器专用的 `onReport` 回调。

每条路径的异常相互隔离。一旦报告进入 `dispatchReport()`，传输或回调异常都不会阻止其他路径运行，也不会传播到应用代码。采集器进入 `dispatchReport()` 前执行的调用（例如原始 `PerformanceObserver.observe()`）不在此保证范围内。

缓存会在本地回调接收原始对象前保存克隆。因此订阅者的修改不会重写排队的副本，但会影响后续订阅者和采集器回调，因为这些本地消费者会依次收到同一个原始对象。

### 4.2 队列与 flush 行为

Performance、Behavior、Error 以及普通 Replay 相关报告共用一个模块级内存队列。

- 当 `url` 为空时，`lazyReportBatch()` 不会将报告入队。全局订阅者和 `onReport` 仍会收到它。
- 默认 `batchSize` 为 `5`；运行时批处理将配置的 `0` 视为单条阈值。
- 当页面触发 `pagehide`、可见性变为 `hidden`，或应用代码调用 `flushReportQueue()` 时，会尝试发送不完整批次。
- Replay 使用的 `dispatchReportBatch()` 共享该缓存，并会在加入当前数据块后执行 flush，因此也可能一并发送此前未满阈值的普通批次。
- 没有定时器周期性 flush。不完整批次可能一直留在内存中，直至达到阈值、发生生命周期事件、显式 flush 或报告批次 flush。
- 队列不持久化。崩溃或页面终止可能丢失没有被任何传输方式接受的报告。
- 序列化失败、没有可用传输方式或传输立即拒绝会保留队列。一旦 Image 赋值、XHR 调度或 Beacon 接受返回 `true`，队列就会被清空；后续网络或服务端失败不能恢复它。因此，不可序列化值可能会阻塞后续 flush，直到坏数据被移除或队列被内部清除。

### 4.3 Envelope 时间、传输与自观察

`createEnvelope()` 在批次 flush 时而非每一项采集时读取配置和环境。因此：

- 一个批次中的所有事件共享 envelope 的 `timestamp`；
- `environment.url` 是 flush 时的 URL；
- SPA 导航后，一条报告自身的 `pageUrl` 可以不同于 envelope URL；
- 在采集与 flush 之间发生的配置变更会影响最终 envelope。

当 `isImageUpload` 为 true 时，SDK 将编码后的 JSON 放入 Image 查询参数。否则，它尝试 `navigator.sendBeacon()`，并在 Beacon 不可用、抛出异常或返回 `false` 时回退到 XHR。

上报模块在首次加载时捕获当时的 XHR `open` 和 `send` 方法。上传使用这些捕获的方法而非后续性能包装器，避免 SDK XHR 上传递归上报自身。Fetch 不用作上传传输方式。资源采集器也会在后续上传资源条目被观察到前断开。

传输返回 `true` 仅表示浏览器接受了 Beacon 调用、已调度 XHR 任务或已设置 Image `src`。这不是服务端收到或持久化 envelope 的确认。

## 5. FP：`observePaint()`

### 5.1 实现与调用链

```text
observePaint(onReport?)
  -> 要求存在 PerformanceObserver
  -> observe({ type: "paint", buffered: true })
  -> 遍历已送达条目
  -> 忽略 name 不为 "first-paint" 的条目
  -> 首个匹配条目后断开
  -> 复制原生时序字段和当前 pageUrl
  -> dispatchReport(report, onReport)
```

由于 First Paint 可能早于应用代码初始化 SDK，`buffered: true` 是必需的。如果已送达列表不含匹配 FP，观察器将保持连接，仅在匹配后断开。

### 5.2 报告契约

```ts
interface FirstPaintReportData {
  name: "first-paint";
  entryType: "paint";
  startTime: number; // 页面 performance 时间原点后的毫秒数
  duration: number;  // 对 paint 条目通常为 0
  type: "performance";
  subType: "first-paint";
  pageUrl: string;   // 观察器回调处理 FP 时读取
}
```

FP 表示浏览器已开始绘制某些内容。它不保证文本、图像或其他有意义内容可见；FCP 提供面向内容的该含义。

### 5.3 设计与边界

SDK 直接使用原生条目，因为 FP 不需要候选项聚合或评级算法。它仅检查 `PerformanceObserver` 是否存在。它不检查 `PerformanceObserver.supportedEntryTypes`，也不捕获构造器 / `observe()` 失败，因此暴露构造器但拒绝 `paint` 类型的部分浏览器实现可能在注册期间抛出异常。

## 6. FCP：`observeFCP()`

### 6.1 实现与调用链

```text
observeFCP(onReport?)
  -> 要求存在 window、document 和 PerformanceObserver
  -> web-vitals onFCP(metric)
  -> 保留完整 FCPMetric
  -> 添加 type、subType 和回调时的 pageUrl
  -> dispatchReport(report, onReport)
```

SDK 将 FCP 委托给已安装的 `web-vitals` 6.2.2 依赖，而不是重新实现可见性、预渲染、导航、BFCache、delta 和评级逻辑。它以默认选项调用 `onFCP()`。

### 6.2 报告契约

SDK 类型扩展依赖类型，而不重新定义其字段：

```ts
interface FirstContentfulPaintReportData extends FCPMetric {
  type: "performance";
  subType: "first-contentful-paint";
  pageUrl: string;
}
```

已安装的 `FCPMetric` 提供 `name: "FCP"`、`value`、`delta`、`rating`、`entries: PerformancePaintTiming[]`、`id`、导航类型联合和数值型 `navigationId`，以及可选导航元数据。采集器在添加 SDK 字段前展开完整指标，因此依赖类型在演进时仍是事实来源。

对于已安装依赖，FCP 在不超过 1800 ms 时评级为 `good`，高于 1800 ms 且不超过 3000 ms 时为 `needs-improvement`，高于 3000 ms 时为 `poor`。SDK 不计算或配置这些阈值。

### 6.3 设计与边界

`web-vitals` 观察缓冲的 paint 条目，筛选在页面首次隐藏时间或之后的 FCP，按 `activationStart` 调整预渲染页面，并可在 BFCache 恢复后创建另一项指标。它也会检测支持的条目类型并在内部捕获观察器失败。

SDK 不传递 `reportSoftNavs: true`；FCP 以文档导航为作用域，不会因普通 SPA 路由重置。`pageUrl` 在依赖回调运行时读取，因此它可能反映底层 paint 条目发生时之后的路由。

## 6.A View First Contentful Paint：`markViewFirstContentfulPaint` / `observeViewFirstContentfulPaint`

View First Contentful Paint（VFCP）测量**当前 Page View** 从 View Start 到「属于该页的有意义内容首次可见」的耗时。它：

- 通过 `viewId` 关联活动 Page View（由 `observePV` / Navigation Attempt 建立）；
- 使用独立 `subType: "view-first-contentful-paint"`，不得与文档级 `first-contentful-paint` 混读；
- 每个 `viewId` 最多上报一次最终值；
- 保留 Measurement Source（如何判定内容绘制）与 Start Source（如何建立 View Start）。

### 6.A.1 Measurement Source

| API | Measurement Source | 适用 |
| --- | --- | --- |
| `observeSoftNavigationViewPaint({ onViewFCP? })` | `soft-navigation` | 浏览器完整支持 Soft Navigation 时的原生 paint（优先） |
| `observeViewFirstContentfulPaint({ root?, onReport? })` | `declared-content` | 观察声明内容区，首个合格节点出现时上报 |
| `markViewFirstContentfulPaint(onReport?)` | `application-mark` | 业务在真实内容就绪时显式标记 |

同一 `viewId` 只产出一条正式 VFCP。启用 Soft Navigation 观察后，优先级为 `soft-navigation` > 容器观察（`declared-content`）> `application-mark`。低优先级在 soft-nav 仍可能到达时暂存，避免重复生产样本。

`declared-content` 只认可带 `data-view-content` 的节点，并排除：

- View Start 时已在文档中的 retained 节点；
- `data-view-skeleton` / `data-view-placeholder` / `data-view-spinner`；
- 无文本且无 `img`/`svg`/`canvas`/`video` 的空节点。

`application-mark` 由业务保证在真实内容就绪时调用；勿在仅有 skeleton / spinner / placeholder 时标记。声明观察使用 MutationObserver 后的 `performance.now()` 近似可见时刻，并非浏览器 paint 时间戳。

### 6.A.2 报告契约

```ts
{
  type: "performance";
  subType: "view-first-contentful-paint";
  name: "VFCP";
  value: number; // 相对 View Start 的毫秒
  pageUrl: string;
  viewId: string;
  measurementSource: "soft-navigation" | "application-mark" | "declared-content";
  startSource: PageViewStartSource;
  pageName?: string;
  routePattern?: string;
}
```

服务端查询见 [Server](server.md) 的 `/api/v1/performance/view-paint`；platform 在性能页单独展示 VFCP，不与文档 Web Vitals 卡片合并，也不套用 Core Web Vitals 好坏评级。可用 `scope`（`document` / `view`）与 `measurementSource` 筛选；默认顶层百分位与 Metric Coverage 只统计 `view`，`document` 投影出现在组成维度中。聚合键优先 Page Name，否则 Route Pattern。Metric Coverage = 有效样本 / 可测 Page View，缺失测量保持缺席。

## 6.B View Largest Contentful Paint：`observeViewLargestContentfulPaint`

View Largest Contentful Paint（VLCP）测量**当前 Page View** 从 View Start 到「声明首屏内容区里最大合格候选被绘制」的耗时。它：

- 通过 `viewId` 关联调用观察时的 Page View；
- 使用独立 `subType: "view-largest-contentful-paint"`，不得与文档级 `largest-contentful-paint` 混读；
- 候选替换只发生在本地，每个 `viewId` 最多上报一次最终值；
- 没有合格候选时不上报，不会把 `0` 或超时时长写成样本；
- 保留 Measurement Source（`soft-navigation` 或 `declared-region`）、Start Source，以及最终确定原因。

启用 `observeSoftNavigationViewPaint({ onViewLCP? })` 且浏览器完整支持时，优先使用 Soft Navigation 的 Interaction Contentful Paint；否则使用声明区观察。同一 `viewId` 只产出一条正式 VLCP。

### 6.B.1 候选与排除

只统计声明根节点内、有直接文本或 `img` / `svg` / `canvas` / `video` 的元素。面积优先用边框盒；边框盒为空时使用元素上显式的 px 宽高。View Start 时已经存在的 retained 节点、`data-view-skeleton` / `data-view-placeholder` / `data-view-spinner` 不计。

默认排除这些共享或非主区域，除非该区域或其中的候选带 `data-view-lcp-include`：

- `data-view-navigation`
- `data-view-overlay`
- `data-view-advertising`
- `data-view-recommendation`

声明区域之外的内容即使更大也不会成为候选。更大的合格内容会替换当前候选，并记下它达到该面积的时刻；更小的后续内容不会替换，已经记录的更大候选被移出区域后也不会把指标退回。图片或视频在 `load` 时会重新测量。`value` 是最大候选达到该面积时相对 View Start 的毫秒数。

### 6.B.2 最终确定

| 原因 | 触发 |
| --- | --- |
| `interaction` | 可信的 `pointerdown` 或 `keydown`（`event.isTrusted`） |
| `page-hidden` | `visibilityState` 变为 `hidden`，或 `pagehide` |
| `next-page-view` | 下一个 Page View 成功建立 |
| `timeout` | 观察超时，默认 10 秒，可用 `timeout` 覆盖 |

超时只结束观察。若当时已有合格候选，上报该候选的绘制耗时；若没有，则不产生样本。`stopObserveViewLargestContentfulPaint()` 会拆掉监听和计时器且不上报。

### 6.B.3 报告契约

```ts
{
  type: "performance";
  subType: "view-largest-contentful-paint";
  name: "VLCP";
  value: number;
  pageUrl: string;
  viewId: string;
  measurementSource: "soft-navigation" | "declared-region";
  startSource: PageViewStartSource;
  finalizationReason: "interaction" | "page-hidden" | "next-page-view" | "timeout";
  pageName?: string;
  routePattern?: string;
}
```

服务端 `/api/v1/performance/view-paint` 按 Page Name（否则 Route Pattern）聚合，并保留 scope、Measurement Source、Start Source、finalization reason 与 Metric Coverage。文档级 LCP 可投影到初始 Page View（`scope=document`），与客户端 VLCP（`scope=view`）默认分列。platform 的 View Paint 区单独展示 VLCP，不与文档级 LCP 卡片合并，不套用 Core Web Vitals 评级。Vue demo 的「小候选 → 更大主内容」会同时展示候选替换和被排除的更大广告。

## 6.A′ Soft Navigation 增强：`observeSoftNavigationViewPaint`

在 Chromium Soft Navigation（约 Chrome 151+，以实际 `PerformanceObserver` 能力为准）完整可用时，可把原生 soft-navigation / interaction-contentful-paint 条目映射为当前 Page View 的 VFCP / VLCP：

```ts
import {
  observeSoftNavigationViewPaint,
  isSoftNavigationSupported,
  getSoftNavigationSupport,
} from "frontend-moniter-sdk";

observeSoftNavigationViewPaint({
  onViewFCP(report) {
    console.log(report.measurementSource, report.value, report.startSource);
  },
  onViewLCP(report) {
    console.log(report.measurementSource, report.finalizationReason);
  },
});

if (!isSoftNavigationSupported()) {
  // 不支持 / 部分支持 / observe 失败：继续用 declared-* 或 application-mark
  console.log(getSoftNavigationSupport());
}
```

关联规则：soft-navigation 条目的 `name`（URL）与活动 Page View 的脱敏 `pageUrl` 一致，且条目 `startTime` 不早于 View Start。`value` 始终相对 Page View 的 View Start；Measurement Source（`soft-navigation`）与 Start Source（如路由 `navigation`）相互独立。

启用 soft-navigation 优先后，低优先级来源会暂存；若在 `softNavWait`（默认 3s）内没有原生样本，或下一个 Page View 到来，则释放回退样本，避免无限阻塞。

兼容性：缺少 `PerformanceObserver`、`supportedEntryTypes` 不含 `soft-navigation` / `interaction-contentful-paint`、或 `observe()` 抛错时，状态为 unsupported，不抛错，现有来源继续工作。这不是对所有浏览器的 Core Web Vitals soft-nav 覆盖；真实浏览器请在支持 Soft Navigation 的 Chromium 中用 Vue demo「Soft Navigation 优先」验证，并在 platform 用来源筛选核对样本。

## 6.C Key Content Paint：`markKeyContentPaint` / `observeKeyContentPaint`

Key Content Paint（KCP）测量**当前 Page View** 从 View Start 到「应用声明的任务关键内容可见」的耗时。它：

- 通过 `viewId` 关联活动 Page View；
- 使用独立 `subType: "key-content-paint"`，**不是**标准 Web Vital，也**不是** View Largest Contentful Paint 的别名或回退；
- 同一 Page View 上按 `keyContentName` 去重：同一名称最多一次，不同名称可并存；
- 保留 Measurement Source 与 Start Source；样本不会进入 VLCP 的分位数。

### 6.C.1 两种 Measurement Source

| API | Measurement Source | 适用 |
| --- | --- | --- |
| `markKeyContentPaint(name, onReport?)` | `application-mark` | 业务在关键内容就绪时显式标记 |
| `observeKeyContentPaint({ name, root?, onReport? })` | `declared-content` | 观察带 `data-key-content="<name>"` 的节点 |

`declared-content` 只认可属性值与 `name` 完全一致的节点，并排除 retained、`data-view-skeleton` / `data-view-placeholder` / `data-view-spinner`、以及无文本且无媒体的空节点。面积再大的视觉块若未声明为该名称，也不会触发 KCP。

### 6.C.2 报告契约

```ts
{
  type: "performance";
  subType: "key-content-paint";
  name: "KCP";
  value: number; // 相对 View Start 的毫秒
  pageUrl: string;
  viewId: string;
  keyContentName: string;
  measurementSource: "application-mark" | "declared-content";
  startSource: PageViewStartSource;
  pageName?: string;
  routePattern?: string;
}
```

服务端 `/api/v1/performance/view-paint` 支持 `metrics=key-content-paint` 与 `keyContentName` 过滤，并按关键内容名称分组，同样暴露 Metric Coverage 与来源组成；platform 在独立的「Key Content Paint」区展示，用语不暗示 Web Vital。Vue demo 的「大主图 → 小价格关键内容」对照最大视觉块与任务关键目标。

## 6.D Page View 漆面分析：文档投影与 Metric Coverage

查询层把已有的文档级 `first-contentful-paint` / `largest-contentful-paint` **投影**到 `startSource: "initial"` 的 Page View 上，作为 `view-first-contentful-paint` / `view-largest-contentful-paint` 的 `scope: "document"` 样本；客户端无需也不应再为同一初始呈现复制一份 View Paint。客户端 View Paint 保留 `scope: "view"`。

默认（未传 `scope`）时：

- 顶层 `sampleCount` / P50 / P75 / P95 / Metric Coverage 只统计 `view`；
- `sources` / `scopes` 仍列出 document 与 view 的组成；
- 传入 `scope=document` 或 `scope=view` 后，顶层统计与分母都收窄到该作用域（document 的可测分母为初始 Page View）。

Metric Coverage = 有效样本数 / 可测 Page View 数。没有产出指标的 Page View 不会被写成 `0` 或超时样本。Page URL 只用于单次诊断，默认聚合键始终是 Page Name，否则 Route Pattern。

## 7. LCP：`observeLCP()`

### 7.1 实现与调用链

```text
observeLCP(onReport?)
  -> 要求存在 window、document 和 PerformanceObserver
  -> web-vitals onLCP(metric)
       -> 跟踪 LCP 候选项
       -> 按依赖的生命周期规则最终确定
  -> 保留完整 LCPMetric
  -> 添加 type、subType 和回调时的 pageUrl
  -> dispatchReport(report, onReport)
```

随着更大内容被渲染，LCP 可能发生变化。委托给 `web-vitals` 可避免此 SDK 维护候选项选择、隐藏页排除、交互最终确定、预渲染调整、BFCache 处理、评级和浏览器专用观察细节。

### 7.2 报告契约

`LargestContentfulPaintReportData` 扩展 `LCPMetric` 并添加：

```ts
{
  type: "performance";
  subType: "largest-contentful-paint";
  pageUrl: string;
}
```

由依赖持有的字段包括 `LCP` 名称、`value`、`delta`、`rating`、`entries`、`id`、导航元数据，以及已安装 `LCPMetric` 类型中的任何其他字段。最新候选项通常体现在 `entries` 中；不得假定浏览器提供候选元素 / 资源详情。

对于已安装依赖，LCP 在不超过 2500 ms 时评级为 `good`，高于 2500 ms 且不超过 4000 ms 时为 `needs-improvement`，高于 4000 ms 时为 `poor`。

### 7.3 设计与边界

在默认 `web-vitals` 行为下，候选项变化不会逐一发送给此采集器。LCP 会在可信首次交互或页面隐藏前后最终确定，并在可用时使用空闲回调。首次隐藏时间后的候选项会被排除。BFCache 恢复可创建另一项 LCP 指标。

与 FCP 一样，未启用实验性软导航上报。客户端路由变更不会启动新的 SDK LCP 测量，回调时的 `pageUrl` 可能不同于候选项绘制所在的路由。

## 8. 页面加载：`observeLoad()`

### 8.1 实现与调用链

```text
observeLoad(onReport?)
  -> 要求存在 window、document、performance 和 requestAnimationFrame
  -> document.readyState === "complete"
       -> 立即调度 reportLoad()
       -> 否则添加一个 load 监听器，保留 event.timeStamp，随后移除
  -> 下一动画帧
  -> navigation = performance.getEntriesByType("navigation")[0]
  -> navigation.loadEventEnd > 0
       ? navigation.loadEventEnd - navigation.startTime
       : load event timeStamp
  -> 仅在存在 duration 时分发
```

下一动画帧延迟是有意为之：`load` 处理器运行期间，`PerformanceNavigationTiming.loadEventEnd` 可能仍为零，因为事件尚未结束。

### 8.2 报告契约

```ts
interface LoadReportData {
  type: "performance";
  subType: "load";
  duration: number;
  pageUrl: string; // 在计划的动画帧回调中读取
}
```

`duration` 是导航相对毫秒数。首选值为 `loadEventEnd - startTime`；加载前注册路径可回退到 load 事件的相对 `timeStamp`。

### 8.3 设计与边界

如果文档已完成且没有可用的 Navigation Timing 条目，则没有保留的 load 事件时间戳，也不会产生报告。重复调用会创建重复的计划测量或监听器。该函数不暴露取消句柄，且此文档级指标不会在 SPA 路由变化时重置。

## 9. 首次加载资源：`observeResources()`

### 9.1 实现与调用链

```text
observeResources(onReport?)
  -> 要求存在 window、document 和 PerformanceObserver
  -> 除非文档已完成，否则等待 load
  -> observe({ type: "resource", buffered: true })
  -> 对首个已送达列表中的每个资源条目
       -> 派生网络阶段和大小
       -> dispatchReport(report, onReport)
  -> 该列表后断开
```

等待 load 使其成为一次首次加载快照。`buffered: true` 可取得在安装观察器前创建的条目。首次回调后断开是有意为之，既避免持续资源监控，也防止此观察器采集后续 SDK 上传流量。

### 9.2 报告契约与字段派生

```ts
interface ResourceLoadReportData {
  name: string;               // resourceEntry.name
  type: "performance";
  subType: "resource";
  sourceType: string;         // initiatorType
  duration: number;
  dns: number;                // domainLookupEnd - domainLookupStart
  tcp: number;                // connectEnd - connectStart
  redirect: number;           // redirectEnd - redirectStart
  ttfb: number;               // responseStart - requestStart
  protocol: string;           // nextHopProtocol
  responseBodySize: number;   // encodedBodySize
  responseHeaderSize: number; // transferSize - encodedBodySize
  transferSize: number;
  resourceSize: number;       // decodedBodySize
  startTime: number;          // 页面 performance 时间原点
  pageUrl: string;            // 处理观察器列表时读取
}
```

没有派生字段会被截断。`responseHeaderSize` 是算术估算，而非 HTTP 头的精确测量；缓存和浏览器行为可能使其为零，或使其不适合用于协议核算。

### 9.3 设计与边界

跨源 Resource Timing 详情由 `Timing-Allow-Origin` 控制。没有许可时，浏览器可暴露资源，但将时序和大小字段置零。这些零值会作为浏览器提供的数据被保留。

与原始 FP 类似，此采集器检查 `PerformanceObserver`，但不测试对 `resource` 条目类型的支持，也不捕获观察器注册失败。它不是持续观察器：首次回调后加载的资源不在其范围内。

一次 Fetch 或 XHR 也可能创建 Resource Timing 条目。SDK 不会将该资源视图与其 Fetch / XHR 包装器报告去重，因为它们承载不同的时序和大小语义。

## 10. Fetch：`observeFetch()`

### 10.1 安装与请求调用链

```text
observeFetch(onReport?)
  -> 要求 window.fetch 可调用
  -> 当前是同一 SDK 包装器？
       -> 仅替换最新回调
       -> 否则停止之前的所有权并包装当前 fetch

wrapped fetch(input, init)
  -> startTime = Date.now()
  -> method = init.method ?? Request.method ?? "GET"，然后转为大写
  -> url = Request.url 或 String(input)
  -> Reflect.apply(originalFetch, original this, original arguments)
  -> resolve：使用 response.status 和 response.ok，然后返回同一 Response
  -> reject：使用 status 0 和 success false，然后抛出同一错误
  -> pageUrl 在结算时读取
```

`Reflect.apply()` 保留接收者和参数列表。等待原始 Promise 可产生一条完成报告，同时返回完全相同的原始 `Response`，或重新抛出完全相同的原始拒绝。因此，监控不会将 HTTP 失败转换为 Promise 拒绝，也不会吞掉网络失败。

### 10.2 报告契约

```ts
interface FetchReportData {
  status: number;       // 响应状态；拒绝时为 0
  duration: number;     // endTime - startTime
  startTime: number;    // Date.now() 返回的 Unix 毫秒
  endTime: number;      // Date.now() 返回的 Unix 毫秒
  url: string;
  method: string;       // 大写
  type: "performance";
  subType: "fetch";
  success: boolean;     // response.ok，或拒绝时为 false
  pageUrl: string;      // Promise 结算时读取
}
```

HTTP 404 或 500 通常会 resolve 为一个 `Response`；它会带其状态和 `success: response.ok` 被上报。只有拒绝会被规范化为状态 `0`。

### 10.3 所有权与停止边界

`stopObserveFetch()` 仅在 `window.fetch` 仍等于 SDK 包装器时恢复捕获的函数。如果另一个库后来替换了 Fetch，SDK 会保持该替换不变，并清除自身引用。

已经发出但尚未完成的被包装请求会在停止后保留其闭包。请求结束时仍会进入 `dispatchReport()`，因此仍可进入网络队列和全局订阅。由于模块回调已被清除，旧的细粒度或聚合 `onReport` 回调不会被调用。

请求元数据提取发生在包装器的 `try` 块之前。因此，诸如抛出异常的 `String(input)` 等转换异常不会被转换为性能报告。

## 11. XHR：`observeXHR()`

### 11.1 安装与请求调用链

```text
observeXHR(onReport?)
  -> 要求存在 XMLHttpRequest
  -> 当前是同一 SDK open / send 包装器？
       -> 仅替换最新回调
       -> 否则停止之前的所有权并包装当前原型方法

open wrapper
  -> 在 WeakMap<XMLHttpRequest, metadata> 中存储 method 和 URL
  -> Reflect.apply(originalOpen, this, arguments)

send wrapper
  -> startTime = Date.now()
  -> 附加捕获阶段 loadend 监听器
  -> Reflect.apply(originalSend, this, arguments)
       -> 同步抛出：移除监听器 / 元数据并重新抛出
  -> loadend：防止重复完成
       -> 读取 status 和 metadata
       -> 移除监听器和 WeakMap 条目
       -> dispatchReport(report, latest callback)
```

包装 XHR 原型可捕获直接 XHR 使用，以及使用浏览器 XHR adapter 的 Axios 等库。`WeakMap` 将请求元数据置于业务可见的实例属性之外，并允许已完成对象被回收。

### 11.2 报告契约

```ts
interface XHRReportData {
  status: number;
  duration: number;
  startTime: number; // Date.now() 返回的 Unix 毫秒
  endTime: number;
  url: string;       // 最初传给 open() 的 URL，而非最终 responseURL
  method: string;    // 大写
  type: "performance";
  subType: "xhr";
  success: boolean;  // 仅当 200 <= status < 300 时为 true
  pageUrl: string;   // 在 loadend 时读取；仅当此时 window 不可用时为空
}
```

`loadend` 覆盖成功响应、HTTP 失败、中止、超时和网络失败。后几种情况通常具有状态 `0` 且不成功。XHR 使用严格的 2xx 规则，而 Fetch 使用 `response.ok`；实现明确保留每个浏览器 API 选择的成功表示。

### 11.3 所有权与停止边界

`stopObserveXHR()` 独立恢复 `open` 和 `send`，且仅当每个方法仍等于对应 SDK 包装器时恢复。它绝不会覆盖后来的第三方替换。

已有 `loadend` 闭包附加的 XHR 在停止后仍可通过共享分发器上报，而被清除的采集器回调会被省略。同步调用 `send()` 且收到抛出时不会产生报告，因为监听器和元数据会在原始异常被重新抛出前清理。

实现假定正常 XHR 使用方式。以异常方式复用同一个 XHR 实例，或发出多次无效 send，并非单独支持的生命周期模型。

## 12. 如何解读数据

### 12.1 时间与页面归属

| 值 | 采集点 | 含义 |
| --- | --- | --- |
| FP `startTime` | 原生 paint 条目 | 页面 performance 时间原点后的毫秒数 |
| FCP / LCP `value` | 依赖指标 | 按 `web-vitals` 生命周期规则调整后的导航相对值 |
| Load `duration` | load 后的下一帧 | 导航相对时长 |
| Resource `startTime` / `duration` | Resource Timing 条目 | 页面相对请求时序 |
| Fetch / XHR `startTime` / `endTime` | 请求开始 / 完成 | `Date.now()` 返回的 Unix 毫秒 |
| 报告 `pageUrl` | 采集器回调或请求完成 | 该较晚时点的当前 URL |
| envelope `timestamp` / `environment.url` | 批次 flush | 绝对发送尝试时间和 URL |

请求可在路由 A 开始，在路由 B 完成；其 Fetch / XHR 报告归属到路由 B。较晚的 Web Vitals 回调也可能产生相同漂移。该模块不修补 History、不监听路由，也不会为 SPA 导航重置文档指标。应使用 Behavior 模块获取路由 / PV 信号，且不要从这些文档级采集器推断每路由 Core Web Vitals。

### 12.2 重叠视图并不天然是重复数据

一次操作可能表现为：

- 包含浏览器网络阶段和传输大小的 `resource` 报告；以及
- 包含应用 API、挂钟完成时间、状态和成功结果的 `fetch` 或 `xhr` 报告。

没有客户端跨采集器去重。消费者应当分别分析这些数据集，或定义自己的关联规则；简单地将三者的计数相加会夸大请求量。

### 12.3 数据与兼容性边界

- 完整页面和请求 URL 会被保留，不会自动脱敏 query / hash。应用必须避免敏感 URL 数据，或在启动监控前对其进行清理。
- FCP / LCP 本地回调接收完整依赖指标对象。原生 `PerformanceEntry` 子类可能包含不可枚举或浏览器专有属性，因此消费者应优先依赖文档列出的标量字段；若要使用 `entries` 的更多字段，应先在目标浏览器中验证其 JSON 序列化结果。
- 不同采集器的能力检查不同。FCP / LCP 受益于 `web-vitals` 特性检测；原始 FP / resource 注册具有上文所述的部分支持异常。
- 仓库中没有浏览器版本矩阵。ES2022 目标和模拟 API 测试不能建立精确的 Chrome、Firefox 或 Safari 支持情况。
- 采集、传输接受、服务端摄取和持久化存储是独立阶段。本地回调仅证明采集已到达分发。

## 13. 服务端与看板解读

推荐的 `/api/v1/reportData` 端点要求对象具有 `data` 数组和非空 `appId`；当存在 `protocolVersion` 时，其必须为 `1`，且服务端还会校验带版本的 session、timestamp、release、user 和 environment 字段。这是结构校验而非穷尽的子类型校验，端点本身不校验 envelope `id`。

当仓库服务端使用 `SQLiteReportStore` 时，它按 envelope ID 去重，并将每条报告存为规范化事件及其原始 JSON。去重仅在 envelope 级别：不同 envelope 中等价的报告会被保留并独立计数。内存存储不提供该去重或下文描述的性能查询端点。

基于 SQLite 的性能查询层将数据分为三组：

| 查询组 | 包含的子类型 | 使用的值 |
| --- | --- | --- |
| 指标摘要 | `first-paint`、`first-contentful-paint`、`largest-contentful-paint`、`load` | FP `startTime`、FCP / LCP `value`、load `duration` |
| 请求列表 | `fetch`、`xhr` | 时长、状态、方法、URL、成功结果等请求字段 |
| 资源列表 | `resource` | 时长、发起方类型、URL、传输和解码后大小 |

指标摘要拒绝非有限值和负值。它们通过线性插值计算 P50 / P75 / P95，但在样本少于两条时有意返回 `null` 分位数。趋势桶使用从 envelope 继承的规范化事件时间戳，因此批量事件按 flush 时间绘制，而非其页面相对指标时间或请求开始时间。

性能查询规范化在存在时优先使用报告自身的 `pageUrl`，而非 envelope URL。看板分别请求指标摘要、网络请求和资源；它不会将资源和包装器观察合并为一个请求模型。

端点 schema、筛选器、分页、SQLite 布局、保留和运行行为见 [服务端文档](server.md)。

## 14. 验证证据与缺口

| 范围 | 主要证据 |
| --- | --- |
| 聚合顺序与回调转发 | `test/performanceIndex.test.ts` |
| FP、FCP、LCP、load 和 resources | `test/observePaint.test.ts`、`test/observeFCP.test.ts`、`test/observeLCP.test.ts`、`test/observeLoad.test.ts`、`test/observeResources.test.ts` |
| Fetch 和 XHR 行为、重复注册与基本恢复 | `test/observeFetch.test.ts`、`test/observeXHR.test.ts` |
| 统一采集器分发 | `test/unifiedReport.test.ts` |
| 批处理、传输选择和原始 XHR 上传 | `test/report.test.ts`、`test/reportXHR.test.ts` |
| 服务端分位数、趋势、筛选和列表响应 | `test/performance.test.ts` |
| HTTP 从摄取到查询的流程 | `test/operationalE2E.test.ts` |

采集器测试使用带有模拟浏览器 API 的 Vitest；它们不是真实浏览器 Performance Timeline 测试。运行 E2E 使用报告形状的数据验证服务端摄取和查询，而不是原生 FP / FCP / LCP / resource 观察。

因此，当前自动化覆盖并未证明：

- 精确的浏览器版本兼容性；
- 部分支持浏览器中的原始观察器行为；
- 真实 BFCache FCP / LCP 行为；
- 跨源 `Timing-Allow-Origin` 结果；
- 各浏览器中的原生 `PerformanceEntry` JSON 形状；
- 指标延迟回调或请求尚未完成期间发生路由变化时的归因；
- 停止后重启或停止后完成的网络包装器行为；
- 停止时保留第三方包装器替换；
- 多页请求 / 资源分页行为；
- 与任意第三方 Fetch / XHR 包装器的完整互操作性。

有关应用设置和框架示例，请继续阅读 [业务使用](business-usage.md)。有关队列克隆、envelope 构造、订阅和传输行为，见 [SDK 入口与内部机制](sdk-internals.md)。
