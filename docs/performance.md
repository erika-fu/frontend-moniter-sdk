# Performance 性能监控

本文对应 `src/performance/`。性能模块只负责从浏览器 API 和网络方法中采集、整理数据，然后交给统一分发器；它不要求业务为每一种指标分别实现上传。

## 1. 启动入口和生命周期

公共入口 `src/index.ts` 重新导出 `observePerformance` 及七个细粒度观察器：

```ts
import { observePerformance } from "frontend-moniter-sdk";

observePerformance({
  onReport(report) {
    console.log(report);
  },
});
```

`observePerformance(options)` 的参数只有一个可选对象：

| 参数 | 类型 | 含义 | 默认值 |
| --- | --- | --- | --- |
| `options` | `PerformanceMonitoringOptions` | 本次启动的配置 | `{}` |
| `options.onReport` | `(data: PerformanceReportData) => void` | 每条性能数据生成后调用的回调 | 不调用 |

该函数依次调用 `observePaint`、`observeFCP`、`observeLCP`、`observeLoad`、`observeResources`、`observeFetch`、`observeXHR`。这个顺序只表示注册顺序，不表示报告到达顺序。`load`、资源和 Web Vitals 可能在稍后才完成，请不要按数组顺序解释数据。

重复启动的行为按观察器区分：

- Fetch、XHR、错误和行为中的长期监听器会避免重复包装/注册，并只更新最新回调；
- paint、FCP、LCP、load、resource 是一次性或由 `web-vitals` 管理的观察器，业务应在应用入口初始化一次；
- Fetch 可用 `stopObserveFetch()` 停止并恢复原始 `window.fetch`，XHR 可用 `stopObserveXHR()` 停止并恢复原型方法；
- `observePerformance` 没有总的 stop 函数；需要停止全部长期网络观察时，分别调用 `stopObserveFetch()` 和 `stopObserveXHR()`。

在服务端渲染、没有 `window`/`document`、没有 `PerformanceObserver` 或没有对应浏览器 API 时，观察器直接返回，不抛错，也不会生成报告。

## 2. 统一报告结构

所有性能报告至少有：

```ts
{
  type: "performance",
  subType: string,
  // 各子类型的字段
}
```

`type` 是一级分类；`subType` 是 TypeScript 判别字段。业务消费时应先判断 `subType`，再读取对应字段。

页面指标通常增加 `pageUrl: window.location.href`。浏览器相对时间 `startTime`、`duration` 的原点通常是本次页面导航的时间原点；Fetch/XHR 的 `startTime` 和 `endTime` 使用 `Date.now()`，是 Unix 毫秒时间戳。这两种时间不能直接混算。

## 3. FP：首次绘制

入口：`observePaint(onReport?)`。代码通过 `PerformanceObserver.observe({ type: "paint", buffered: true })` 读取 paint 条目。

处理步骤：

1. 检查 `PerformanceObserver` 是否存在，避免旧浏览器或 SSR 执行失败。
2. 使用 `buffered: true`，因为调用观察器前 FP 可能已经发生。
3. 遍历条目，只接受 `entry.name === "first-paint"`。
4. 找到后断开观察器。FP 每个页面只采集一次。
5. 从原生 `PerformancePaintTiming` 读取 `startTime` 和 `duration`，补充 `type`、`subType`、`pageUrl`。
6. 通过 `dispatchReport` 交给网络批处理、本地订阅和本次回调。

返回值：`void`。数据通过回调/统一上报产生，不从函数返回。

```ts
interface FirstPaintReportData {
  name: "first-paint";
  entryType: "paint";
  startTime: number; // 页面时间原点后的毫秒数
  duration: number;  // 通常为 0
  type: "performance";
  subType: "first-paint";
  pageUrl: string;
}
```

FP 是“浏览器第一次开始绘制”，不保证已经出现用户能识别的文字或图片；需要内容绘制语义时使用 FCP。

## 4. FCP：首次内容绘制

入口：`observeFCP(onReport?)`。实现调用 `web-vitals` 的 `onFCP`，而不是手动拼接 `PerformanceObserver` 结果。

步骤：

1. 检查浏览器环境和 `PerformanceObserver`。
2. 让 `web-vitals` 处理候选条目、页面生命周期和无效场景。
3. 回调收到 `FCPMetric` 后，保留指标对象全部字段。
4. 增加 `type: "performance"`、`subType: "first-contentful-paint"` 和 `pageUrl`。
5. 分发数据。

`FCPMetric` 的核心结构来自当前安装的 `web-vitals` 版本：

```ts
{
  name: "FCP",
  value: number,
  delta: number,
  rating: "good" | "needs-improvement" | "poor",
  entries: PerformanceEntry[],
  id: string,
  navigationType: string,
  type: "performance",
  subType: "first-contentful-paint",
  pageUrl: string
}
```

`value` 是当前指标值，`delta` 是本次回调相对上次报告的变化量，`rating` 是 Web Vitals 评级，`entries` 是关联原始性能条目，`id` 用于关联同一指标实例，`navigationType` 表示导航类型。SDK 不修改这些字段。

## 5. LCP：最大内容绘制

入口：`observeLCP(onReport?)`，使用 `web-vitals` 的 `onLCP`。

LCP 会在加载过程中出现多个候选元素，因此步骤不是“看到第一条就上报”：

1. 注册 Web Vitals LCP 观察器。
2. 持续比较候选元素。
3. 在首次用户交互、页面隐藏等规范定义的确认时机得到最终候选值。
4. 接收 `LCPMetric`，增加统一分类和页面 URL。
5. 分发最终报告。

报告结构与 FCPMetric 相同，但 `name` 通常为 `"LCP"`，`subType` 为 `"largest-contentful-paint"`。`entries` 中可能包含对应的 `LargestContentfulPaint`，其元素、资源 URL 和绘制时间由浏览器提供；不要假设这些字段在所有浏览器都存在。

## 6. Load：页面 load 完成耗时

入口：`observeLoad(onReport?)`。

步骤：

1. 检查 `window`、`document`、`performance` 和 `requestAnimationFrame`。
2. 若 `document.readyState === "complete"`，立即安排一次下一帧读取。
3. 否则注册一次 `load` 监听，触发后移除监听器。
4. 下一帧读取 `performance.getEntriesByType("navigation")[0]`。
5. 优先计算 `loadEventEnd - startTime`；若没有可用 Navigation Timing，则使用 load 事件的 `timeStamp`。
6. 生成并分发报告。

延迟一帧是因为 `load` 处理函数执行时 `loadEventEnd` 可能还没有最终写入。

```ts
interface LoadReportData {
  type: "performance";
  subType: "load";
  duration: number; // 导航开始到 loadEventEnd，毫秒
  pageUrl: string;
}
```

若既没有有效 Navigation Timing，又无法取得事件时间戳，则不报告。函数返回 `void`。

## 7. Resource：首轮资源加载

入口：`observeResources(onReport?)`。它只采集页面首轮资源，不持续监听后续所有资源。

步骤：

1. 检查浏览器环境和 `PerformanceObserver`。
2. 页面已完成时立即注册观察器；否则等待一次 `load` 并移除该监听。
3. 用 `buffered: true` 读取此前已经进入时间线的资源条目。
4. 每条 `PerformanceResourceTiming` 转换为一条报告。
5. 当前列表处理完后断开观察器，避免将未来的 SDK 上报请求再次作为资源采集。

```ts
interface ResourceLoadReportData {
  name: string;               // resourceEntry.name
  type: "performance";
  subType: "resource";
  sourceType: string;         // initiatorType，如 script/img/fetch
  duration: number;
  dns: number;                // domainLookupEnd - domainLookupStart
  tcp: number;                // connectEnd - connectStart
  redirect: number;           // redirectEnd - redirectStart
  ttfb: number;               // responseStart - requestStart
  protocol: string;           // nextHopProtocol
  responseBodySize: number;   // encodedBodySize，压缩后字节数
  responseHeaderSize: number; // transferSize - encodedBodySize
  transferSize: number;       // 传输总字节数
  resourceSize: number;       // decodedBodySize，解压后字节数
  startTime: number;           // 页面时间原点后的毫秒数
  pageUrl: string;
}
```

跨域资源可能受到 Timing-Allow-Origin 限制，浏览器会把部分时间和大小置为 0；这是浏览器权限结果，不是 SDK 计算错误。`responseHeaderSize` 是代码用总传输量减响应体传输量得到的估算值，不能当作精确 HTTP 头大小。

## 8. Fetch：Fetch 请求

入口：`observeFetch(onReport?)`。SDK 保存原始 `window.fetch`，用异步包装函数替换它。

一次请求的步骤：

1. 记录 `Date.now()` 作为开始时间。
2. 从 `input` 和 `init` 提取 URL 与方法。`init.method` 优先，其次是 `Request.method`，再否则为 `GET`；方法统一转大写。
3. 调用原始 fetch，并保留原始 `this` 和所有参数。
4. 成功得到 Response 时记录结束时间、状态码和 `response.ok`。
5. 网络异常时记录状态码 `0`、`success: false`，然后重新抛出原异常，不改变业务 Promise 行为。

```ts
interface FetchReportData {
  status: number;       // 响应状态码；网络异常为 0
  duration: number;     // endTime - startTime
  startTime: number;    // Date.now()，Unix 毫秒
  endTime: number;      // Date.now()，Unix 毫秒
  url: string;
  method: string;       // 大写
  type: "performance";
  subType: "fetch";
  success: boolean;     // response.ok；异常为 false
  pageUrl: string;
}
```

HTTP 404/500 仍然是“成功完成的 Fetch”，因为 Promise 已得到 Response；这时 `success` 由 `response.ok` 判断。网络层抛错才是状态码 0。

停止时只有 `window.fetch` 仍等于 SDK 的包装函数，才恢复原始函数；若其他工具在期间再次替换了 fetch，SDK 不覆盖它。

## 9. XHR：XMLHttpRequest 请求

入口：`observeXHR(onReport?)`。实现包装 `XMLHttpRequest.prototype.open` 和 `send`，因此 axios 等使用 XHR 的库也会被采集。

步骤：

1. `open` 包装器保存每个 XHR 实例的 method 和 URL。
2. `send` 包装器记录 `Date.now()`，注册一次 `loadend`。
3. 调用原始 `send`；若同步抛错，清理本次监听并重新抛出。
4. `loadend` 触发时只处理一次，读取 `status`，计算耗时，移除监听并清理元数据。
5. `status >= 200 && status < 300` 时 `success` 为 true，其余状态为 false。

```ts
interface XHRReportData {
  status: number;
  duration: number;
  startTime: number; // Date.now()，Unix 毫秒
  endTime: number;
  url: string;
  method: string;    // 大写
  type: "performance";
  subType: "xhr";
  success: boolean;  // 仅 2xx 为 true
  pageUrl: string;
}
```

Fetch 使用 `response.ok`，XHR 使用 2xx 区间，这是两种 API 的原生成功语义差异。

## 10. `web-vitals` 与原生 Performance API

FP、load、resource 需要的是浏览器直接给出的原始条目，因此 SDK 直接读取 Performance API。FCP 和 LCP 需要候选值、页面隐藏、首次交互和评级等规范逻辑，SDK 委托 `web-vitals`。因此 FCP/LCP 报告字段比 FP 多，且其最终回调时间不一定等于原始条目产生时间。
