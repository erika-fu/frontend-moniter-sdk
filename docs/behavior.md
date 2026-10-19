# Behavior 用户行为监控

本文对应 `src/behavior/`。行为模块采集页面访问（PV）、鼠标/触摸交互和地址变化事件，整理后交给统一分发器；它不依赖 Vue Router / React Router，也不负责独立的服务端协议。

它实际监听的是 `mousedown` 与 `touchstart`，不是浏览器的 `click` 事件。PV 默认会在 URL 变化时自动上报；地址变化原始信号（`hashchange` / `popstate`）与 PV 是两套数据，不要混用。

## 1. 启动入口和生命周期

公共入口 `src/index.ts` 重新导出 `observeBehavior` 及细粒度观察器：

```ts
import monitor from "frontend-moniter-sdk";

monitor.init({ url: "/monitor", appId: "web" });
monitor.behavior();
```

命名导出适合本地旁路或单独启停：

```ts
import {
  observeBehavior,
  observeAutoPageView,
  observeClick,
  observePageChange,
  observePV,
  stopObserveBehavior,
  stopObserveAutoPageView,
  stopObserveClick,
  stopObservePageChange,
} from "frontend-moniter-sdk";

observeBehavior({
  onReport(data) {
    console.log(data.type, data.subType);
  },
});

stopObserveBehavior();
```

`observeBehavior(options)` 的参数：

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `options` | `BehaviorMonitoringOptions` | `{}` | 本次启动的配置 |
| `options.onReport` | `(data: BehaviorReportData) => void` | 无 | 额外接收 pv、click、hashchange、popstate；不替代统一上报 |
| `options.autoPageView` | `boolean` | `true` | 为 `true` 时在 URL 变化后自动上报 PV；为 `false` 时只保留启动时的一次 PV |

启动顺序：

1. `observeClick`
2. `observePageChange`
3. `observeAutoPageView`（仅当 `autoPageView !== false`）
4. `observePV`（立即采集当前页）

这个顺序只表示注册顺序。首条 PV 会在启动时立刻发出；后续 Hash / History 变化产生的 PV 取决于用户导航时机。

`monitor.behavior()` 与 `observeBehavior()` 等价。`stopObserveBehavior()` 会：

- 停止 click、page change、自动 PV；
- 还原被包装的 `history.pushState` / `history.replaceState`；
- 调用 `clearPageViewDedup()`，清除去重缓存，使下次启动能重新记录当前页。

`stopObservePageChange()` 也会顺带调用 `stopObserveAutoPageView()`，避免只停止地址变化监听后仍留下 History 劫持。`observePV()` 本身不注册监听器。

在服务端渲染、没有 `window` / `document` / `performance` 时，观察器直接返回，不抛错，也不会生成报告。

## 2. 架构总览

行为模块拆成四个职责清晰的文件：

| 文件 | 职责 | 产出 `subType` |
| --- | --- | --- |
| `pv.ts` | 唯一 PV 出口；连续相同 `pageUrl` 去重 | `pv` |
| `autoPageView.ts` | 监听 Hash / History，并包装 History API，调用 `observePV` | 无独立 `subType`，最终仍是 `pv` |
| `pageChange.ts` | 记录原生 `hashchange` / `popstate` 的 from/to | `hashchange`、`popstate` |
| `click.ts` | 捕获阶段采集鼠标/触摸 | `click` |

数据流：

```text
behavior() 首屏
  -> observePV()
       -> 连续相同 pageUrl？跳过 : dispatchReport(subType: "pv")

URL 变化触发源
  hashchange / popstate / pushState 包装 / replaceState 包装
  -> observeAutoPageView
       -> observePV()   （同一去重出口）

业务路由钩子 afterEach / useLocation
  -> observePV()       （同一去重出口）

原生地址事件（并行）
  hashchange / popstate
  -> observePageChange
       -> dispatchReport(subType: "hashchange" | "popstate")
```

设计约束：

1. **通用 SDK 不依赖路由框架。** 包根不引入 `vue-router` / `react-router`。
2. **PV 只有一个出口。** 首屏、自动监听、业务手动调用都走 `observePV()`。
3. **自动监听与精确上报可并存。** 连续相同 `pageUrl` 去重，避免双计。
4. **`pageChange` 不是 PV。** 看板和漏斗应消费 `subType: "pv"`。

## 3. PV 页面访问

入口：`observePV(onReport?)`。调用即按当前地址采集一次。返回 `void`；数据通过统一分发、订阅和可选回调产生。

### 3.1 采集步骤

1. 检查 `window`、`document`、`performance`。
2. 读取 `window.location.href` 作为 `pageUrl`。
3. 若 `pageUrl === lastReportedPageUrl`，直接返回，不上报。
4. 写入去重缓存，读取 `performance.now()` 与 `document.referrer`。
5. 用 `generateBehaviorId()` 生成 `uuid`。
6. `dispatchReport` 交给网络批处理、本地订阅和本次回调。

```ts
interface PageViewReportData {
  type: "behavior";
  subType: "pv";
  startTime: number; // 页面时间原点后的毫秒数
  pageUrl: string;
  referrer: string;
  uuid: string;
}
```

`referrer` 来自浏览器的 `document.referrer`，直接打开页面时可能为空。SPA 内跳转通常不会把它改成上一个前端路由；第一版刻意保持该浏览器语义，避免 silently 把字段改成 SDK 自维护的“上一页”。`uuid` 只标识本条行为数据，不是用户 ID 或会话 ID。

### 3.2 去重规则

模块级变量 `lastReportedPageUrl` 记录最近一次**成功进入上报**的地址：

- 连续两次 `observePV()` 且 `location.href` 相同 → 第二次跳过；
- 地址变化后再调用 → 重新上报；
- `clearPageViewDedup()` / `stopObserveBehavior()` 会清空缓存。

比较的是完整 `href`，因此 pathname、search、hash 任一变化都会产生新的 PV。这符合“URL 变了就算一次访问”的默认产品语义；若业务只想按 pathname 计 PV，需要自行在路由钩子里规范化后再调用，或关闭自动 PV。

### 3.3 默认自动与精确模式

`monitor.behavior()` 默认 `autoPageView: true`：

- 启动时立即采集当前页；
- 之后由 `observeAutoPageView` 在 URL 变化时继续调用 `observePV()`。

业务若能确认导航成功，仍可在路由钩子里调用 `observePV()`。相同地址不会重复计数。

需要完全由业务决定何时记 PV 时：

```ts
monitor.behavior({ autoPageView: false });
```

此时 SDK 只在启动时采集一次，不会包装 History，也不会为 `hashchange` / `popstate` 自动记 PV。后续跳转由业务调用 `observePV()`。

自动 PV 只知道 URL 变了。它不能判断：

- 路由守卫是否取消导航；
- 重定向最终落在哪个路由；
- 页面组件是否已经渲染完成；
- 路由模板是 `/users/:id` 还是实际地址 `/users/123`。

这些场景应在导航成功后手动调用 `observePV()`。

## 4. 自动 PV：`observeAutoPageView`

入口：`observeAutoPageView(onReport?)`。通常由 `observeBehavior` 代为启动，也可单独使用。

### 4.1 覆盖的触发源

| 触发源 | 是否覆盖 | 说明 |
| --- | --- | --- |
| `hashchange` | 是 | 含代码改 `location.hash` 和前进/后退 |
| `popstate` | 是 | 浏览器前进/后退等历史记录切换 |
| `history.pushState` | 是 | 包装后在原方法成功返回时上报 |
| `history.replaceState` | 是 | 同上 |
| 仅改 `location.pathname` 且不经过 History API | 否 | 整页跳转会重新加载，由新页面的首屏 PV 覆盖 |

原生 `popstate` **听不到**代码主动调用的 `pushState` / `replaceState`。这是通用 SPA（Vue Router / React Router History 模式）丢 PV 的常见原因，所以 SDK 需要包装这两个方法。

### 4.2 History 包装步骤

1. 保存 `history.pushState` / `history.replaceState` 的原始实现。
2. 用包装函数替换它们。
3. 包装函数先 `Reflect.apply` 调用原方法，保留原始 `this` 和全部参数。
4. 原方法成功返回后，调用 `observePV(reportHandler)`。
5. 把原方法的返回值原样返回，不改变业务行为。

原方法若同步抛错，不会进入上报。停止时只有当前方法仍等于 SDK 包装函数，才还原；若其他工具在期间再次替换了 History 方法，SDK 不覆盖它。这与 Fetch / XHR 包装的停止策略一致。

### 4.3 与 `pageChange` 的关系

同一次 Hash 导航可能同时触发：

- `pageChange` 的 `hashchange` 报告（含 `from` / `to`）；
- 自动 PV 的 `pv` 报告。

同一次 `pushState`：

- **不会**产生 `pageChange`（因为没有 `popstate`）；
- **会**产生自动 PV。

因此消费侧：

- 统计“看了哪个页” → 用 `subType: "pv"`；
- 调试原生 Hash / 前进后退链路 → 用 `subType: "hashchange" | "popstate"`。

### 4.4 重复启动与停止

对同一 `window` 重复调用 `observeAutoPageView` 只更新回调，不重复安装监听器、不重复包装 History。换到新的 `window` 时会先停止旧实例再安装。

`stopObserveAutoPageView()` 移除 `hashchange` / `popstate` 监听，并还原 History 方法。

### 4.5 设计考虑与实现亮点

1. **完整覆盖 SPA 路由变化**：监听 `hashchange`、`popstate`，同时包装 `history.pushState()` 和 `history.replaceState()`，弥补后两者不会触发 `popstate` 的问题。
2. **不改变 History 原方法的行为**：通过 `Reflect.apply(original, this, args)` 保留原始 `this` 和参数；先执行原方法，成功后才上报，并将执行结果原样返回。
3. **避免重复初始化**：使用 `observedWindow` 判断是否已监听同一个 `window`。重复调用时仅通过 `reportHandler = onReport` 更新最新回调，不重复注册事件或包装 History。
4. **安全恢复 History 方法**：同时保存原始函数和本模块安装的包装函数。若其他工具后来再次包装该方法，SDK 停止时不会强行覆盖它；各工具应按与安装相反的顺序停止（后安装、先卸载），才能逐层恢复原方法。
5. **完整清理资源**：保存事件处理函数引用，以便准确调用 `removeEventListener()`；停止后清空所有模块状态，支持安全地重复停止和重新启动。
6. **兼容 SSR 和非浏览器环境**：初始化前检查 `window`、`performance` 和 `addEventListener`，缺少浏览器能力时直接返回，避免运行时报错。
7. **职责分离并避免重复 PV**：本模块只负责感知 URL 变化，再统一调用 `observePV()`；具体的数据生成、分发及相同 URL 去重由 `pv.ts` 负责。

整体上，它通过“监听浏览器事件 + 包装 History API”覆盖 SPA 导航，同时利用状态缓存、透明调用和条件恢复，保证监听可复用、可清理且不干扰业务及其他工具。

## 5. 点击/触摸交互

入口：`observeClick(onReport?)`。在捕获阶段注册 `mousedown` 和 `touchstart`，以便在业务调用 `stopPropagation()` 前完成采集。

每次事件：

1. 检查目标是否有 `tagName`；没有则忽略。
2. 读取标签名、`innerHTML`、`outerHTML`、`offsetWidth`、`offsetHeight` 和 `event.timeStamp`。
3. 用 `getSerializableEventPath()` 把 `composedPath()`（旧环境回退 `event.path`）转成节点名称字符串数组。
4. 分发报告。

```ts
interface ClickReportData {
  type: "behavior";
  subType: "click";
  target: string;      // 如 BUTTON
  startTime: number;   // event.timeStamp
  innerHtml: string;
  outerHtml: string;
  width: number;       // CSS 像素
  height: number;      // CSS 像素
  eventType: "mousedown" | "touchstart";
  path?: string[];
}
```

`path` 只保存节点名称，不保存 DOM 引用，避免循环引用导致批量上报序列化失败。详见 [点击后错误不上报及页面卡顿解决方案](solutions/click-event-path-reporting.md)。

`innerHtml`、`outerHtml` 可能含用户输入，业务上传前应评估隐私和体积风险；SDK 当前不会脱敏或截断。重复启动只更新最新回调，`stopObserveClick()` 移除两个监听器。

## 6. 地址变化：`observePageChange`

入口：`observePageChange(onReport?)`。监听捕获阶段的 `hashchange` 和 `popstate`。初始化时保存 `window.location.href`。

- `hashchange`：使用事件的 `oldURL` 和 `newURL`；
- `popstate`：使用上次保存的 URL 和当前 URL；
- 读取 `performance.now()`，生成 UUID，分发后更新上次 URL。

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

`pushState` / `replaceState` 不会触发 `popstate`，因此也不会产生 `pageChange`。需要覆盖这两种导航时，应依赖自动 PV，或在业务路由成功后调用 `observePV()`。

重复调用只更新回调。`stopObservePageChange()` 移除监听、清空 `previousUrl`，并调用 `stopObserveAutoPageView()` 还原 History 包装。

## 7. ID 和时间

`generateBehaviorId()` 优先使用 `crypto.randomUUID()`，降级格式为 `behavior-${Date.now()}-${random}`。它不应作为安全凭证。

行为 `startTime` 是页面时间轴或事件时间戳，不是 Unix 时间。服务端应另记接收时间。`PageViewReportData.uuid` 与 envelope 的 `id`、会话 `sessionId` 都不是同一概念。

## 8. Demo 中的用法

Vue demo（`demo/`）与 React demo（`react-demo/`）都使用默认自动 PV：

```ts
frontendMonitor.behavior();
```

Vue demo 的行为区提供：

- Hash 切换：`switchRoute('#/scenario/orders')` 等，走 `hashchange`；
- History 切换：`pushHistoryRoute('orders')`，内部调用 `history.pushState` 改 query。

React demo 的侧边栏 Hash 导航（`#/console`、`#/reports`、`#/coverage`）以及事件触发器里的 History 按钮，都会自动产生 PV；实时报告流可直接看到 `subType: "pv"`。

更偏设计决策与接入选型的说明见 [SPA 页面访问（PV）自动采集设计](solutions/spa-page-view-tracking.md)；业务路由钩子示例见 [业务侧使用说明](business-usage.md) §11。
