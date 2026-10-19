# Behavior 用户行为监控

本文是 `src/behavior/` 的权威实现参考，说明页面访问（PV）、自动 PV、原生地址变化和属性门控点击的公开契约、内部调用链、设计理由与边界。

Behavior 只负责采集并把报告交给 SDK 的统一分发器：它不依赖 Vue Router / React Router，不提供行为专用网络协议，也不直接实现 PV 看板、点击聚合或漏斗分析。仓库内 server 将这些数据作为通用事件保存。

## 1. 数据语义

| `subType` | 含义 | 主要用途 |
| --- | --- | --- |
| `pv` | 当前完整 URL 的一次页面访问记录 | 页面访问量、路由访问分析 |
| `click` | 最近一个显式标记元素上的语义化点击 | 业务动作分析 |
| `hashchange` | 浏览器原生 Hash 变化信号 | 导航链路诊断 |
| `popstate` | 浏览器原生历史记录遍历信号 | 前进/后退链路诊断 |

`hashchange` / `popstate` 与 `pv` 是两套数据。同一次 Hash 导航通常同时产生一条原生变化报告和一条 PV，不能把它们一起累计为访问量。

## 2. 公共入口与配置

默认导出对象提供 `behavior`，它与命名导出的 `observeBehavior` 是同一个函数：

```ts
import monitor from "frontend-moniter-sdk";

monitor.init({
  url: "/api/v1/reportData",
  appId: "web",
});

monitor.behavior({
  clickAttributes: ["clstag"],
  onReport(report) {
    console.log(report.type, report.subType);
  },
});
```

`init()` 只更新统一上报配置，不启动任何观察器。应先调用 `init()`，再启动 Behavior，避免首条同步 PV 使用旧配置。

`BehaviorMonitoringOptions`：

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `onReport` | `(report: BehaviorReportData) => void` | 无 | 额外接收本次观察器产生的 Behavior 报告；不替代网络上报或全局订阅 |
| `autoPageView` | `boolean` | `true` | 是否把后续 URL 变化自动转换为 PV |
| `clickAttributes` | `string[]` | 无 | 允许上报的 DOM 属性名；省略或规范化后为空时不采集点击 |

细粒度入口也从包根导出：

```ts
import {
  observeAutoPageView,
  observeClick,
  observePageChange,
  observePV,
  stopObserveAutoPageView,
  stopObserveBehavior,
  stopObserveClick,
  stopObservePageChange,
} from "frontend-moniter-sdk";
```

## 3. 模块与状态

| 文件 | 职责 | 主要模块状态 | 产出 |
| --- | --- | --- | --- |
| `src/behavior/index.ts` | 聚合启动、停止和联合类型 | 无 | 转发各模块报告 |
| `src/behavior/pv.ts` | 构造 PV、连续完整 URL 去重 | `lastReportedPageUrl` | `pv` |
| `src/behavior/autoPageView.ts` | 把原生导航和 History API 调用适配为 `observePV()` | 当前 `window`、最新回调、监听器、原始和包装后的 History 方法 | 无独立报告 |
| `src/behavior/pageChange.ts` | 记录原生导航诊断信号 | 当前 `window`、最新回调、监听器、`previousUrl` | `hashchange`、`popstate` |
| `src/behavior/click.ts` | 解析属性门控的点击 | 当前 `window`、最新回调、允许列表、监听器 | `click` |
| `src/behavior/utils.ts` | 生成 Behavior 记录 ID | 无 | `uuid` |
| `src/eventPath.ts` | 将事件路径中的浏览器宿主对象转换成字符串 | 无 | `string[]` |

这些状态属于当前加载的 SDK 模块实例。页面中若加载两份独立 SDK，它们会分别持有监听器、去重游标和 History 包装状态。

## 4. 聚合启动与停止

### 4.1 启动顺序

`observeBehavior(options)` 按固定顺序同步执行：

```text
observeBehavior(options)
  -> observeClick({ onReport, clickAttributes })
  -> observePageChange(onReport)
  -> autoPageView === false
       ? stopObserveAutoPageView()
       : observeAutoPageView(onReport)
  -> observePV(onReport)                  // 立即尝试首条 PV
```

设计考虑：

1. 先装监听器，再记录当前页，避免初始化过程中发生的后续导航没有观察者。
2. 点击配置与页面访问相互独立；没有有效 `clickAttributes` 只会关闭点击。
3. 所有首屏和后续 PV 最终都经过 `observePV()`，共用字段构造与去重规则。

对同一个 `window` 重复启动时，长期监听模块只更新最新回调或配置，不重复安装监听器；但聚合入口仍会再次调用 `observePV()`，相同 URL 通常会被去重。

### 4.2 停止边界

| API | 实际效果 |
| --- | --- |
| `stopObserveClick()` | 移除点击监听，清空点击回调和允许列表 |
| `stopObserveAutoPageView()` | 移除自动 PV 的原生事件监听，按条件恢复 History 方法 |
| `stopObservePageChange()` | 移除原生地址变化监听、清空 URL 游标，并同时停止自动 PV |
| `stopObserveBehavior()` | 依次停止点击、地址变化和自动 PV，再清除 PV 去重地址 |

`stopObserveBehavior()` 不会：

- 发送或清空共享上报队列；
- 取消通过 `subscribe()` 注册的全局订阅；
- 重置 `init()` 写入的配置或报告会话 ID；
- 停止 performance、error 或 replay 模块；
- 撤回已经交给传输层的数据。

## 5. 统一分发调用链

每个采集器构造普通、可序列化的报告对象后调用同一个 `dispatchReport()`：

```text
Behavior collector
  -> dispatchReport(report, onReport)
       -> lazyReportBatch(report)          // 配置了 url 才入队；入队时克隆
            -> 达到 batchSize / 生命周期 flush
                 -> getCache()             // 再次克隆
                 -> createEnvelope(batch)
                 -> Image / Beacon / XHR
       -> notifyReportListeners(report)    // 全局 subscribe()，逐个隔离异常
       -> onReport(report)                 // 本次观察器回调，隔离异常
```

需要区分三条出口：

- **共享网络队列**保存报告副本。未配置 `url` 时不会入队，也不会在以后补发。
- **全局 `subscribe()`** 接收每条原始报告，不接收批数组或 envelope。
- **`onReport`** 只额外接收本次观察器的报告，不替代前两条路径。

队列先克隆，订阅者随后按注册顺序接收同一个原始对象。因此，订阅者修改对象不会影响已排队的副本，但可能影响后续订阅者和 `onReport` 看到的值。不要依赖订阅回调清洗已经进入网络队列的数据。

传输返回成功只表示客户端已经接受或安排这次发送：Beacon 返回接受状态，XHR 返回已安排异步任务，Image 返回已设置 `src`。它们都不是服务端持久化确认。

## 6. PV：`observePV`

### 6.1 调用链与实现

```text
observePV(onReport?)
  -> 检查 window / document / performance
  -> pageUrl = window.location.href
  -> pageUrl === lastReportedPageUrl ? 返回
  -> lastReportedPageUrl = pageUrl
  -> 构造 PageViewReportData
  -> dispatchReport(report, onReport)
```

报告结构：

```ts
interface PageViewReportData {
  type: "behavior";
  subType: "pv";
  startTime: number;
  pageUrl: string;
  referrer: string;
  uuid: string;
}
```

字段来源：

- `startTime`：`performance.now()`，是页面时间原点后的毫秒数，不是 Unix 时间；
- `pageUrl`：采集时的完整 `window.location.href`；
- `referrer`：浏览器的 `document.referrer`；
- `uuid`：`generateBehaviorId()` 生成的本条 Behavior ID。

`document.referrer` 通常不会在 SPA 内部跳转时变成上一条前端路由。它保留浏览器文档来源语义，不是 SDK 维护的“上一页”。

### 6.2 去重规则

`lastReportedPageUrl` 是模块级的单一游标，规则是“连续完整 URL 相同则跳过”：

- `A -> A`：第二次跳过；
- `A -> B -> A`：三次均可产生 PV；
- pathname、query 或 hash 任一部分变化：视为新 URL；
- `stopObserveBehavior()` / `clearPageViewDedup()`：清除游标，重启后同一 URL 可再次记录。

游标在调用 `dispatchReport()` **之前**写入。因此这里的“已记录”只表示采集器接受了该 URL，不表示已经入队、发送或被服务端接收。即使没有配置 `url`，相同 URL 的下一次调用也会被去重。

当前 API 不接收自定义 URL、路由名或规范化函数。若要按 `/users/:id`、pathname 或其他业务维度聚合，应在消费端或服务端派生该维度；不能通过给 `observePV()` 传入规范化 URL 实现。

### 6.3 自动模式与业务确认模式

默认 `monitor.behavior()`：

1. 启动时立即尝试当前页 PV；
2. 后续由自动 PV 监听 URL 变化。

自动模式只能确认浏览器 URL 在某个触发点发生了变化，不能确认：

- 路由守卫已经通过；
- 重定向已经到达最终地址；
- 页面数据已经加载；
- 组件已经渲染；
- 实际地址已经映射到业务路由模板。

如果必须以路由成功钩子作为后续 PV 的唯一依据：

```ts
monitor.behavior({ autoPageView: false });

router.afterEach(() => {
  observePV();
});
```

`autoPageView: false` 仍会保留 `observeBehavior()` 启动末尾的首条 PV，只关闭后续自动 PV。若连首条 PV 也必须由业务决定，应组合所需的细粒度观察器，而不是直接调用聚合入口。

不要把“默认自动 PV + 路由成功钩子”描述为成功语义：自动包装可能已经先记录同一 URL，后续钩子调用只会被去重，不能替换前一条报告或改变其时间。

## 7. 自动 PV：`observeAutoPageView`

### 7.1 触发矩阵

| 触发源 | 自动 PV | 原生 `pageChange` |
| --- | --- | --- |
| `hashchange` | 调用 `observePV()` | `hashchange` |
| `popstate` | 调用 `observePV()` | `popstate` |
| `history.pushState()` | 包装后调用 `observePV()` | 无 |
| `history.replaceState()` | 包装后调用 `observePV()` | 无 |

浏览器主动调用 `pushState()` / `replaceState()` 不会触发 `popstate`，因此仅监听原生事件无法覆盖常见 History 模式 SPA。

### 7.2 History 包装

```text
业务调用 history.pushState / replaceState
  -> SDK wrapper
       -> Reflect.apply(original, this, args)
       -> 原方法正常返回后 observePV(latestHandler)
       -> 返回原始结果
```

这样设计是为了：

1. 保留原方法的 `this`、参数、返回值和同步异常；
2. 只有浏览器原方法成功返回后才读取当前 URL；
3. 把报告字段和去重统一留给 `observePV()`；
4. 不引入任何路由框架依赖。

只有 `pushState` 和 `replaceState` 同时是函数时才会安装两个包装。只存在其中一个的特殊环境不会包装任何一个。

### 7.3 重复启动与恢复

同一个 `window` 上重复调用只更新 `reportHandler`。切换到新的 `window` 时，模块会先停止旧实例，再安装新监听器和包装。

停止时只有当前 History 方法仍然等于 SDK 安装的 wrapper，才恢复保存的原方法。这避免覆盖其他工具后来安装的包装，但也意味着：

```text
original O -> SDK wrapper S -> third-party wrapper T
```

SDK 停止时看到的是 `T`，不会用 `O` 覆盖它。如果 `T` 仍调用捕获的 `S`，自动 PV 逻辑仍可能被间接触发。多个包装器应按“后安装、先卸载”的逆序清理。

## 8. 原生地址变化：`observePageChange`

`pageChange` 保留浏览器原生导航信号，用于诊断，不是准确的 SPA 路由事实表，也不是 PV。

### 8.1 调用链

```text
observePageChange(onReport?)
  -> previousUrl = window.location.href
  -> addEventListener("hashchange", hashHandler, true)
  -> addEventListener("popstate", popHandler, true)

hashchange
  -> reportPageChange("hashchange", event.oldURL, event.newURL)
  -> previousUrl = event.newURL

popstate
  -> currentUrl = window.location.href
  -> reportPageChange("popstate", previousUrl, currentUrl)
  -> previousUrl = currentUrl
```

报告结构：

```ts
interface PageChangeReportData {
  type: "behavior";
  subType: "hashchange" | "popstate";
  from: string;
  to: string;
  startTime: number;
  uuid: string;
}
```

`startTime` 来自 `performance.now()`；`uuid` 是本条 Behavior ID。

### 8.2 URL 归因边界

`hashchange` 自带 `oldURL` 和 `newURL`，模块直接使用它们。`popstate` 没有等价字段，只能用内部 `previousUrl` 作为 `from`。

`previousUrl` 只在以下时机更新：

- 初始化 `observePageChange()`；
- 处理 `hashchange`；
- 处理 `popstate`。

它**不会**在 `pushState()` 或 `replaceState()` 时更新。例如：

```text
初始化于 A       previousUrl = A
pushState 到 B   自动 PV 记录 B；previousUrl 仍是 A
随后 popstate    from 使用 A，未必是浏览器刚离开的实际 URL
```

因此不能假设 `popstate.from` 始终是实际上一跳，也不能承诺混合 History API 与原生遍历时总能形成严格连续的 `A -> B -> C` 链。片段历史遍历在浏览器中还可能同时涉及 `popstate` 和 `hashchange`；两条诊断信号不应重复计为访问量。

`from` 和 `to` 都保留完整 URL，可能包含敏感 query 或 hash。SDK 不自动脱敏，应避免在 URL 中放敏感值，并在接收服务的存储/消费边界执行必要治理。

### 8.3 生命周期

对同一个 `window` 重复调用只替换最新回调，不重复安装监听器。`stopObservePageChange()` 使用保存的函数引用和相同捕获参数移除两个监听器，清空游标，并同时调用 `stopObserveAutoPageView()`；这个细粒度停止函数会影响自动 PV。

## 9. 属性门控点击：`observeClick`

点击默认关闭。只有有效允许列表才会安装捕获阶段监听器：

```ts
monitor.behavior({
  clickAttributes: ["clstag"],
});
```

```html
<button type="button" clstag="checkout-submit">提交订单</button>
```

### 9.1 采集链路

```text
window capture-phase click
  -> 允许列表为空？忽略
  -> event.composedPath()，否则 event.path
  -> 从内向外找到第一个带任一允许属性的元素
  -> 收集该元素上存在的全部允许属性
  -> getSerializableEventPath(event)
  -> 构造 ClickReportData
  -> dispatchReport(report, latestHandler)
```

允许列表会被复制、过滤非字符串、`trim`、去空并去重。调用方随后修改原数组不会改变已生效配置。重复启动可更新最新回调和允许列表而不重复安装监听器；新列表为空会移除已有监听器。

选择路径上最近的标记元素，可以让按钮内部图标、文本或包装节点变化时仍归因到稳定的业务控件。如果内外层都标记，只报告最近一层；不会合并外层属性，也不会为同一次点击生成多条报告。同一命中元素上的多个允许属性会全部复制，显式空值保留为 `""`。

### 9.2 报告结构

```ts
interface ClickReportData {
  type: "behavior";
  subType: "click";
  target: string;
  startTime: number;
  width: number;
  height: number;
  eventType: "click";
  attributes: Record<string, string>;
  path?: string[];
}
```

- `target`：命中元素的 `tagName`；
- `startTime`：原始 `event.timeStamp`；
- `width` / `height`：`offsetWidth` / `offsetHeight`，缺失时为 `0`；
- `attributes`：只包含命中元素上的允许属性；
- `path`：节点名称字符串，不包含 DOM 引用。

报告不包含 `innerHtml`、`outerHtml`、任意未允许属性、原始 `Event`、DOM、`Window` 或 `Document` 对象。

### 9.3 兼容性与行为边界

- 监听的是语义化浏览器 `click`，不是 `mousedown`、`touchstart`、拖拽或手势事件；
- 监听器位于 `window` 捕获阶段，不调用 `preventDefault()`；
- 目标解析依赖 `composedPath()` 或旧式 `event.path`；当前实现不会从 `event.target` 手动向父级遍历，两者都缺失时点击被忽略；
- 不检查 `event.isTrusted`，因此 `element.click()` 等程序化点击也可能上报；
- 没有节流、去抖、采样或同点击去重，每次符合条件的事件都会分发；
- `composedPath()` 会分别用于目标解析和可序列化路径生成，即一条已命中的点击通常读取两次路径；
- `dispatchReport()` 之后的队列、订阅和回调异常会被隔离，但采集阶段没有覆盖整个监听器的最外层 `try/catch`；异常的 `composedPath()`、`hasAttribute()` 或 `getAttribute()` 仍可能逃逸。

允许列表只批准**属性名**。属性值会原样复制，不校验、不脱敏、不截断。只应使用稳定、有限、低基数的动作名，禁止令牌、个人数据、用户输入、自由文本和无边界用户/订单 ID。

完整设计、旧版迁移、H5/WebView/小程序边界及隐私清单见 [点击采集设计](click-tracking.md)。

## 10. 可序列化事件路径

`getSerializableEventPath()` 优先读取 `event.composedPath()`，否则读取 `event.path`，再按以下顺序把每个宿主对象转换成字符串：

1. 当前全局 `window` → `"Window"`；
2. 当前全局 `document` → `"Document"`；
3. 字符串 `tagName`；
4. 字符串 `nodeName`；
5. 构造器名称；
6. `"EventTarget"`。

这项转换必须发生在 `dispatchReport()` 之前。原始 DOM、`Document` 和 `Window` 体积大、持有对象图并常含循环引用；一旦进入共享缓存，JSON 序列化失败的记录会留在队列中并阻塞后续 Behavior、Error 等报告。事故背景见 [点击后错误不上报及页面卡顿解决方案](solutions/click-event-path-reporting.md)。

## 11. ID、时间与页面上下文

`generateBehaviorId()` 优先调用 `crypto.randomUUID()`；不可用时生成 `behavior-${Date.now()}-${random}`。它不是用户 ID、会话 ID、envelope ID 或安全凭证。PV 和 page change 带有该 `uuid`，click 当前没有。

| 值 | 产生时机 | 语义 |
| --- | --- | --- |
| PV / page change `startTime` | 采集时 | `performance.now()` 的页面相对时间 |
| click `startTime` | 事件创建时 | `event.timeStamp` |
| envelope `timestamp` | 批次 flush、组装 envelope 时 | `Date.now()` 的绝对时间 |
| PV `pageUrl` | PV 采集时 | 该 PV 的完整 URL |
| page change `from` / `to` | 原生事件处理时 | 原生事件或模块游标推导的 URL |
| envelope `environment.url` | 批次 flush 时 | 发送时当前 URL |

点击报告没有独立的事件时 `pageUrl`。如果一个批次跨越 SPA 导航，多个点击可能共享较晚 flush 时读取的 envelope URL；server 也会把该 envelope URL作为这一批通用事件的 `page_url`。不要把它当作严格的点击发生页归因。

## 12. 数据治理与运行环境

- PV、page change 和 envelope 会保留完整 URL；query/hash 可能携带敏感数据；
- 点击标记值由业务提供，SDK 不验证其安全性；
- 点击路径仍会暴露标签层级，envelope 还包含配置的 `userId`、user agent 和语言；
- 需要用户同意后才能采集时，应延迟调用 `behavior()`；只省略 `clickAttributes` 仍会采集 PV 和原生导航；
- 监听器只作用于安装它的 `window`。iframe 是独立浏览上下文；父页面不能借此采集跨域 iframe 内部点击；
- 缺少所需浏览器对象时，各观察器直接返回。SSR 安全不等于所有不完整 WebView API 都具备完整降级能力；
- bfcache 同 URL 恢复没有专门的 `pageshow` 采集逻辑，不能假设每次恢复都会产生新 PV。

仓库内 server 不校验 Behavior 各 subtype 的完整字段，也不使用 Behavior `uuid` 去重；平台当前以通用事件列表展示这些 JSON，没有专用 PV、点击或漏斗分析。

## 13. Demo 与验证覆盖

Vue demo 在 `demo/src/startMonitoring.ts` 显式配置：

```ts
frontendMonitor.behavior({
  clickAttributes: ["clstag"],
});
```

标记按钮会产生 `click`；未标记对照按钮仍执行应用动作，但不产生点击报告。Hash 导航产生 `hashchange` 和 PV；`pushState()` 产生 PV，不产生 page change。

React demo 的 `react-demo/src/main.tsx` 调用 `behavior()` 时没有传 `clickAttributes`，因此只演示 PV 和导航，不采集点击。UI 中历史遗留的 Click/Touch 展示不能作为实际初始化配置或 API 契约。

主要测试证据：

| 测试 | 覆盖内容 |
| --- | --- |
| `test/behavior.test.ts` | 初始 PV、原生导航、点击门控与规范化、最近标记祖先、去重、History 包装与恢复、`autoPageView: false` |
| `test/initReporting.test.ts` | Behavior 进入统一 envelope、事件路径可序列化 |
| `test/unifiedReport.test.ts` | Behavior 与其他模块共用统一分发器 |
| `demo/clickTracking.test.ts` | Vue demo 标记/未标记控件的 jsdom 集成行为 |

仓库目前没有真实浏览器 Behavior E2E。Vitest/jsdom 验证不能等同于 Chrome、Firefox、Safari、真实 Shadow DOM、bfcache 或浏览器导航事件顺序的兼容性证明。`npm run test:e2e` 是 server operational E2E，也不是浏览器 Behavior E2E。

业务侧路由接入示例见 [业务侧使用说明](business-usage.md) §11；共享缓存、envelope 和传输实现见 [SDK 公共入口与内部链路](sdk-internals.md)。
