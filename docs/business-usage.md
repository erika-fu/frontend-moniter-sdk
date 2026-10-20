# 业务侧使用说明

SDK 的模式是“采集与上报打通，但可以分开使用”：配置 `url` 后自动批量发送；不配置 `url` 时仍可通过回调或 `subscribe` 获取数据。

## 1. 安装和入口

Node.js 要求 18+：

```bash
npm install frontend-moniter-sdk
```

发布包提供 ESM `dist/index.js`、CommonJS `dist/index.cjs`、浏览器 IIFE `dist/index.iife.js`（全局名 `FrontendMonitor`）和 `dist/index.d.ts`。ESM/CJS 将 `web-vitals` 作为运行时依赖，IIFE 已内置它。

## 2. 推荐初始化

```ts
import monitor from "frontend-moniter-sdk";

monitor.init({
  url: "https://monitor.example.com/reportData",
  projectName: "storefront",
  appId: "web",
  userId: "user-1",
  release: "web@2026.10.06",
  batchSize: 5,
});

const unsubscribe = monitor.subscribe((data) => {
  console.log(data.type, data.subType);
});

monitor.performance();
monitor.behavior({
  clickAttributes: ["clstag"],
});
monitor.error();
monitor.replay();
```

`clickAttributes` 列出允许上报的 DOM 属性名，`clstag` 是示例。省略 `clickAttributes` 或传入空列表时，只关闭点击上报；页面访问和地址变化仍会启动。属性值由应用写入，不得包含密钥、个人数据、用户输入或无边界的标识。字段、最近祖先解析和迁移说明见 [Behavior 用户行为监控](behavior.md)。

错误报告建议在每次构建时配置稳定的 `release`：

```ts
monitor.init({
  url: "/reportData",
  release: "web@2026.10.06",
});
```

浏览器上传原始 `stack`、文件 URL、行列号和 release。监控服务端使用 `appId`、`release` 和 generated file 选择对应 SourceMap，解析后保存 `stackFrames`、`rawStack` 和 `resolutionStatus`，避免把 SourceMap 和解析逻辑放进业务页面。服务端启动、SourceMap 上传和查询接口见 [Server 服务端文档](server.md)。

`init` 只更新配置，不启动观察器。应先 `init` 再启动模块，避免首条 PV 或错误使用旧配置。

## 3. 配置参数

| 参数 | 类型 | 默认值 | 意义 |
| --- | --- | --- | --- |
| `url` | `string` | `""` | 服务端地址；为空时不发网络请求 |
| `projectName` | `string` | `""` | 项目标识，放入 envelope |
| `appId` | `string` | `""` | 应用/端标识 |
| `userId` | `string` | `""` | 业务用户标识；SDK 不生成、不校验 |
| `release` | `string` | `""` | 发布版本；附加到 JavaScript、Promise、Vue 和 React 错误 |
| `isImageUpload` | `boolean` | `false` | true 用 Image GET 查询参数发送 |
| `batchSize` | `number` | `5` | 达到数量时发送；小数向下取整，负数变 0 |

配置只更新已提供字段，`false` 和 `0` 也会生效。实际批处理把 `batchSize: 0` 按单条发送，避免数据永远留在缓存。

`batchSize` 只控制普通监控报告的批量发送，不控制 Replay 事件。当前 demo 在 [demo/src/main.ts](../demo/src/main.ts) 中显式配置 `batchSize: 1`，因此普通性能、行为和错误报告按每批 1 条发送；Replay 仍按自己的片段限制收集和上报，不会被这个值拆散。Replay 默认最多保留 1000 个事件或 5 MiB 数据，服务端还会限制单个片段最长 30 分钟，详见 [Replay 会话录屏](replay.md) 和 [Server 服务端文档](server.md)。

## 4. 接收报告

细粒度观察器通过命名导出使用。默认导出的 `monitor` 对象包含四个模块入口、对应的 `observeXxx` 别名和录屏控制，但没有 `observeFetch` 等更细的性能观察器。观察器回调只接收对应模块：

```ts
import { observeFetch } from "frontend-moniter-sdk";

observeFetch((data) => {
  console.log(data.subType, data.duration);
});
```

默认导出对象的模块入口：

```ts
monitor.performance(); // 启动全部性能观察器
monitor.behavior({ clickAttributes: ["clstag"] }); // PV、地址变化，以及允许属性上的点击
monitor.error();       // 启动浏览器错误观察器
monitor.replay();      // 启动 rrweb 录屏，错误发生后上报相关片段
```

默认对象还公开 `observePerformance`、`observeBehavior`、`observeError`、`observeReplay`、`getReplaySession`、`stopObserveReplay` 和 `createReplayUrl`。如果需要单独启动某一个性能观察器，应使用命名导出，例如 `observeFetch`、`observeXHR`、`observeLCP`。这些细粒度函数的回调只接收对应类型的数据。

全局订阅接收全部模块，返回取消函数：

```ts
const unsubscribe = monitor.subscribe((data) => {
  if (data.type === "error") console.error(data);
});
unsubscribe();
```

订阅只观察单条原始数据，不替换网络上报，也不是 envelope 或批数组。回调/订阅抛错会被隔离，不影响页面。

## 5. 网络载荷

```ts
interface ReportEnvelope<T = unknown> {
  protocolVersion: 1;
  id: string;
  projectName: string;
  appId: string;
  sessionId: string;
  timestamp: number;
  release: string;
  userId: string;
  user: { id: string };
  environment: {
    url: string;
    userAgent: string;
    language: string;
  };
  data: T;
}
```

`id` 由 SDK 生成。普通观察器经批处理 flush 时，`data` 是缓存数组。直接调用 `report(data)` 会原样把参数放入 envelope；仓库内 server 要求 `data` 为数组，因此直接面向该 server 调用时也应传入数组。推荐将 `url` 配置为 `/api/v1/reportData`，旧的 `/reportData` 仅作为兼容入口。

`timestamp` 和 `environment.url` 在 flush、组装 envelope 时读取，不一定等于每条事件的采集时间和采集页面。各数据字段见 `performance.md`、`behavior.md`、`error.md` 和 `replay.md`，服务端协议与响应见 [Server 服务端文档](server.md)。

## 6. 发送顺序和失败处理

`report(data)` 的选择顺序是：无 URL/非浏览器返回 false；JSON 序列化失败返回 false；`isImageUpload` 使用 Image；否则优先 `navigator.sendBeacon`；再退回 SDK 捕获的原始 XHR POST；都不可用返回 false。

达到 `batchSize` 自动 flush。`pagehide` 或页面隐藏时也尝试发送未满批次：

```ts
import { flushReportQueue } from "frontend-moniter-sdk";

flushReportQueue(); // boolean：传输已接受/安排为 true；无缓存或同步失败为 false
```

只有传输函数返回已接受或已安排时才清空缓存；失败时保留，避免同步失败时静默丢数。这里不是服务端确认：XHR 返回 true 只表示异步发送任务已安排，Image 返回 true 只表示已经设置 `src`。图片 GET 会把 JSON 放进 URL，不适合大报告或敏感内容。

`clearReportQueue` 目前是 SDK 内部能力，没有从包根公开。业务侧不应直接丢弃缓存。

## 7. 会话录屏

录屏需要单独启动，并默认只在发生错误后上报相关片段：

```ts
monitor.replay({
  maskAllInputs: true,
  preErrorDuration: 60_000,
  bufferSize: 100,
  maxReplayEvents: 1000,
  maxReplayBytes: 5 * 1024 * 1024,
  postErrorDuration: 5 * 60 * 1000,
  postErrorIdleTimeout: 30_000,
});

const current = monitor.getReplaySession();
console.log(current?.sessionId, current?.replayId);
```

运行时错误会携带 `sessionId`、`replayId` 和错误时刻的 `replayOffset`。`sessionId` 在本次页面录制期间稳定；错误前片段立即上报后，错误后继续录制仍使用同一 `replayId`，直到空闲 30 秒、最长 5 分钟，或触达事件/体积上限后才轮换。`preErrorDuration` 按时间保留错误前真实事件，不会伪造空白操作。使用 `monitor.createReplayUrl()` 可以生成回放定位地址。服务端按 `appId` 和 `replayId` 提供 `/api/v1/replays` 列表和详情接口，每个片段最多 1000 个事件、30 分钟和 5 MiB；隐私配置、报告结构和播放器对接见 [Replay 会话录屏](replay.md)，服务端查询和限制见 [Server 服务端文档](server.md)。

## 8. Vue 2 接入

在 Vue 2 应用的入口文件中，先初始化 SDK，再安装插件，最后创建 Vue 根实例：

```ts
// src/main.ts
import Vue from "vue";
import App from "./App.vue";
import router from "./router";
import monitor from "frontend-moniter-sdk";

monitor.init({
  url: "https://monitor.example.com/reportData",
  projectName: "storefront",
  appId: "vue2-web",
  userId: localStorage.getItem("userId") ?? "",
  batchSize: 5,
});

// 可选：本地观察所有模块产生的单条原始数据。
const unsubscribe = monitor.subscribe((data) => {
  console.log("[monitor]", data);
});

// 启动浏览器层面的性能、行为和运行时错误采集。
// 省略 clickAttributes 时只关闭点击上报，PV 与地址变化仍会采集。
monitor.performance();
monitor.behavior({
  clickAttributes: ["clstag"],
});
monitor.error();

// Vue.use 会调用 monitor.install(Vue)，安装 Vue.config.errorHandler 包装器。
Vue.use(monitor);

new Vue({
  router,
  render: (h) => h(App),
}).$mount("#app");
```

如果项目已经设置 `Vue.config.errorHandler`，应在 `Vue.use(monitor)` 之前设置：

```ts
Vue.config.errorHandler = (error, vm, info) => {
  console.error("existing Vue handler", error, vm, info);
};

Vue.use(monitor);
```

SDK 会保存并继续调用这个既有 handler。若在 `Vue.use(monitor)` 之后直接覆盖 `Vue.config.errorHandler`，会替换 SDK 的包装器，Vue 组件错误将不再被 SDK 捕获。

也可以不用 `Vue.use`，显式传入只处理 Vue 错误的回调：

```ts
monitor.install(Vue, {
  onReport(report) {
    // report.subType 固定为 "vue"
    console.log(report.error, report.info);
  },
});
```

Vue 2 的职责划分：

- `Vue.use(monitor)`：捕获 render、生命周期、事件处理器等进入 `Vue.config.errorHandler` 的框架错误；
- `monitor.error()`：捕获资源错误、未捕获 JavaScript 错误和未处理 Promise rejection；
- `monitor.performance()`：采集页面指标与 Fetch/XHR；
- `monitor.behavior({ clickAttributes: ["clstag"] })`：采集当前页 PV，并在 History/Hash 地址变化时继续记 PV；只上报带允许属性的点击，同时采集原生 hash/history 变化。省略 `clickAttributes` 时只关闭点击上报。

## 9. Vue 3 接入

Vue 3 使用 `createApp`，在 `mount` 前安装 SDK 插件：

```ts
// src/main.ts
import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";
import monitor from "frontend-moniter-sdk";

monitor.init({
  url: "https://monitor.example.com/reportData",
  projectName: "storefront",
  appId: "vue3-web",
  userId: localStorage.getItem("userId") ?? "",
  batchSize: 5,
});

monitor.performance();
monitor.behavior({
  clickAttributes: ["clstag"],
});
monitor.error();

const app = createApp(App);
app.use(router);

// app.use 会调用 monitor.install(app)，包装 app.config.errorHandler。
app.use(monitor);

app.mount("#app");
```

有已有 Vue 3 错误处理器时，也要在安装 SDK 前配置：

```ts
const app = createApp(App);

app.config.errorHandler = (error, instance, info) => {
  console.error("existing Vue handler", error, instance, info);
};

app.use(monitor);
app.mount("#app");
```

要单独处理 Vue 错误数据，可显式调用：

```ts
monitor.install(app, {
  onReport(report) {
    // 自动网络上报仍会执行；这里额外接收本次 Vue 报告。
    console.log(report);
  },
});
```

不要同时对同一个 app 调用 `app.use(monitor)` 和 `monitor.install(app, options)` 来表达两套配置。虽然 SDK 不会重复包装，但后一次调用会更新该 app 的 `onReport`；应选择一种方式并在入口执行一次。

## 10. React 接入

React 没有 Vue 式的全局组件错误插件。浏览器层监控在入口启动，组件渲染树错误通过 Error Boundary 转交给 SDK。

入口文件：

```tsx
// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import monitor from "frontend-moniter-sdk";
import App from "./App";
import { MonitorErrorBoundary } from "./MonitorErrorBoundary";

monitor.init({
  url: "https://monitor.example.com/reportData",
  projectName: "storefront",
  appId: "react-web",
  userId: localStorage.getItem("userId") ?? "",
  batchSize: 5,
});

// 这些函数只需要在应用入口调用一次，不要放进 React 组件 render。
// 省略 clickAttributes 时只关闭点击上报，PV 与地址变化仍会采集。
monitor.performance();
monitor.behavior({
  clickAttributes: ["clstag"],
});
monitor.error();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MonitorErrorBoundary>
      <App />
    </MonitorErrorBoundary>
  </React.StrictMode>,
);
```

Error Boundary：

```tsx
// src/MonitorErrorBoundary.tsx
import React, { type ErrorInfo, type ReactNode } from "react";
import monitor from "frontend-moniter-sdk";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class MonitorErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    monitor.errorBoundary(error, info);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return <div>页面暂时无法显示</div>;
    }

    return this.props.children;
  }
}
```

需要为某个 Boundary 增加单独处理逻辑时，传第三个参数：

```ts
componentDidCatch(error: Error, info: ErrorInfo): void {
  monitor.errorBoundary(error, info, (report) => {
    console.log("React boundary report", report);
  });
}
```

这条报告仍会进入 SDK 自动网络上报和全局 `subscribe`；第三个参数只是额外的本次回调。

Error Boundary 只能捕获 React 支持的组件树错误，不能捕获事件处理器、异步回调、服务端渲染以及 Boundary 自身的错误。`monitor.error()` 会补充浏览器未捕获 JavaScript 和 Promise 错误，但已经被业务 `try/catch` 消化的异常需要业务主动调用自己的上报逻辑。

## 11. SPA 页面访问（PV）与路由接入

### 11.1 默认行为

本节示例只演示页面访问和导航。下面的 `monitor.behavior()` 不传 `clickAttributes`，因此不会上报点击；需要点击时另传允许的属性名，例如 `clickAttributes: ["clstag"]`。省略或传空列表只关闭点击上报。

`monitor.behavior()` 会立即记录当前页 PV（`startSource: "initial"`），并默认开启 `autoPageView`，继续监听：

- `hashchange`（`startSource: "hashchange"`）
- `popstate`（`startSource: "popstate"`）
- `history.pushState` / `replaceState`（`startSource: "history"`）

History 模式和 Hash 模式的路由跳转都会自动产生 `subType: "pv"`。每条 Page View 带有稳定 `viewId`、View Start（`startTime`）和 `startSource`。连续相同的**脱敏后** `pageUrl` 只上报一次。

`pageUrl` 会剥离已知敏感 query（如 `token`、`password`、`code`），保留 pathname 与 hash，适合诊断；默认聚合应优先使用应用提供的 `pageName`，否则使用 `routePattern`。

同时，`behavior()` 仍会启动 `pageChange`，产出 `hashchange` / `popstate` 底层信号。产品漏斗应消费 `pv`，不要把 `pageChange` 当访问量。

自动监听只能确认 URL 变了。它不能确认：

- 路由守卫是否取消；
- 重定向最终落点；
- 页面组件是否已渲染；
- 路由模板名（例如 `/users/:id`）与实际地址的对应关系。

需要这些语义时，使用 Navigation Attempt API（见 11.3）。模块字段、去重、脱敏和 History 包装见 [Behavior 用户行为监控](behavior.md)。

### 11.2 推荐接入方式

| 场景 | 推荐做法 |
| --- | --- |
| 通用 SPA，只要求 URL 变化即计 PV | `monitor.behavior()`，使用默认自动 PV |
| 必须在路由守卫通过、重定向完成后才计后续 PV | `monitor.behavior({ autoPageView: false })`，用 `startNavigationAttempt` / `commitNavigationAttempt` / `cancelNavigationAttempt` |
| 自动 PV 与已有路由钩子暂时并存 | 两者可共用脱敏 URL 去重，但钩子通常不会替换先产生的自动 PV，也不赋予它“导航成功”语义 |
| 连首条 PV 都必须由业务控制 | 不调用聚合 `behavior()`；按需组合 `observeClick()`、`observePageChange()` 和业务侧 Attempt / `observePV()` |
| 微前端卸载 / 测试清理 | `stopObserveBehavior()`，还原可恢复的 History 包装并清除 PV 去重与进行中的 Attempt |

### 11.3 Navigation Attempt（推荐框架接入）

```ts
import {
  cancelNavigationAttempt,
  commitNavigationAttempt,
  markNavigationRedirect,
  startNavigationAttempt,
} from "frontend-moniter-sdk";

monitor.behavior({ autoPageView: false });

router.beforeEach((to, from, next) => {
  // 同一 Navigation Attempt 内重复进入时，start 会复用已有 View Start。
  startNavigationAttempt();
  if (needsLogin(to) && !isLoggedIn()) {
    markNavigationRedirect();
    next({ name: "login" });
    return;
  }
  next();
});

router.afterEach((to) => {
  if (to.meta.trackPageView === false) {
    cancelNavigationAttempt();
    return;
  }
  commitNavigationAttempt({
    ...(to.name != null ? { pageName: String(to.name) } : {}),
    ...(to.matched.at(-1)?.path
      ? { routePattern: to.matched.at(-1)?.path }
      : {}),
  });
});
```

取消的目的地不会产生 Page View。重定向链保留原始 View Start（重复 `startNavigationAttempt` 不会重置），提交时带上 `redirectCount`。提交的 PV 使用 `startSource: "navigation"`。

`autoPageView: false` 时，`behavior()` 仍会记录启动时的当前页；钩子对同一脱敏地址再调用会被去重。若希望“第一页也完全由 afterEach 决定”，需要自行避免启动瞬间与钩子的竞态，或接受启动时那一条首屏 PV。

### 11.4 React Router

```tsx
import { useEffect } from "react";
import { useLocation, useMatches } from "react-router-dom";
import {
  commitNavigationAttempt,
  startNavigationAttempt,
} from "frontend-moniter-sdk";

export function RouteMonitor(): null {
  const location = useLocation();
  const matches = useMatches();

  useEffect(() => {
    startNavigationAttempt();
    const leaf = matches.at(-1);
    const pageName =
      typeof leaf?.handle === "object" &&
      leaf.handle !== null &&
      "pageName" in leaf.handle
        ? String((leaf.handle as { pageName: unknown }).pageName)
        : undefined;
    const routePattern =
      typeof leaf?.pathname === "string" ? leaf.pathname : undefined;
    commitNavigationAttempt({
      ...(pageName ? { pageName } : {}),
      ...(routePattern ? { routePattern } : {}),
    });
  }, [location.key, matches]);

  return null;
}
```

在应用根部渲染 `<RouteMonitor />`，并关闭自动 PV：

```ts
monitor.behavior({ autoPageView: false });
```

若仍使用默认自动 PV，Effect 与自动监听共用去重，但不会把已产生的自动 PV 改成导航成功语义。React 18 开发模式下，`StrictMode` 可能重复执行 Effect；连续相同脱敏 URL 会被去重。

### 11.5 无路由框架时的手写导航

没有 Vue / React Router 时，只要最终改到了 URL，默认自动 PV 仍然有效：

```ts
// Hash
window.location.hash = "#/orders";

// History
const url = new URL(window.location.href);
url.searchParams.set("route", "orders");
window.history.pushState({ route: "orders" }, "", url);
```

Vue demo 同时演示自动 PV 与手动 Navigation Attempt（含取消），并用 `clickAttributes: ["clstag"]` 开启点击，见 [demo/src/scenarios.ts](../demo/src/scenarios.ts)。React demo 调用 `behavior()` 时不传 `clickAttributes`，演示自动 PV 与 Attempt 公共 API，见 [react-demo/src/App.tsx](../react-demo/src/App.tsx)。

### 11.6 消费与排查

```ts
monitor.subscribe((data) => {
  if (data.type === "behavior" && data.subType === "pv") {
    console.log(
      "page view",
      data.viewId,
      data.startSource,
      data.pageName ?? data.routePattern,
      data.pageUrl,
    );
  }
});
```

排查清单：

1. 是否先 `init` 再 `behavior`，避免首条 PV 用到空配置；
2. History 模式是否真的调用了 `pushState`（自动 PV 依赖包装）；
3. 是否误把 `hashchange` / `popstate` 报告当成 PV；
4. 连续相同脱敏 URL 被跳过是否符合预期；
5. 关闭 `autoPageView` 后是否仍有业务侧 Attempt / `observePV()`；
6. `pageUrl` 是否仍含敏感 query（应被剥离）；聚合是否误用完整 URL 而非 `pageName` / `routePattern`。

## 12. 停止监听

普通单页应用通常让 SDK 随页面生命周期持续运行，不需要停止。微前端子应用卸载或测试清理时可以：

```ts
import {
  stopObserveBehavior,
  stopObserveError,
  stopObserveFetch,
  stopObserveReplay,
  stopObserveXHR,
} from "frontend-moniter-sdk";

stopObserveBehavior();
stopObserveError();
stopObserveFetch();
stopObserveReplay();
stopObserveXHR();
unsubscribe();
```

`stopObserveReplay()` 会取消尚未触发的继续录制定时器，并清空当前内存录屏。FP、FCP、LCP、load 和首轮 resource 属于一次性观察，没有统一的停止入口。

## 13. 隐私

点击报告包含 `type`、`subType`、应用允许的属性值、标签名、事件时间戳、`eventType: "click"`、布局宽高，以及可选的节点名称路径，不再包含目标 HTML。这些属性值由应用自己写入，SDK 原样复制，不会脱敏或截断。允许的值不得包含密钥、个人数据、用户输入或无边界的标识；应使用稳定的动作名，例如 `clstag="checkout-submit"`。

PV / pageChange 含完整页面 URL（可能带 query 或 hash 中的业务参数），error 可能含 stack，Fetch/XHR 含 URL，replay 含页面 DOM 和交互。当前 Behavior API 没有 URL 转换钩子；并且报告会先克隆进网络队列，再通知 `subscribe()`，所以修改订阅参数不能清洗已排队的副本。应避免把敏感值放进 URL，并在接收服务持久化或消费前完成必要的过滤与脱敏。不要把 `userId` 当作 SDK 生成的匿名 ID。
