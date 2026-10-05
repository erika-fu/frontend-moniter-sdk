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
  batchSize: 5,
});

const unsubscribe = monitor.subscribe((data) => {
  console.log(data.type, data.subType);
});

monitor.performance();
monitor.behavior();
monitor.error();
```

错误报告建议在每次构建时配置稳定的 `release`：

```ts
monitor.init({
  url: "/reportData",
  release: "web@2026.10.05",
});
```

浏览器上传原始 `stack`、文件 URL、行列号和 release。监控服务端使用 release 选择对应 SourceMap，解析后保存 `stackFrames` 和 `sourceStack`，避免把 SourceMap 和解析逻辑放进业务页面。

`init` 只更新配置，不启动观察器。应先 `init` 再启动模块，避免首条 PV 或错误使用旧配置。

## 3. 配置参数

| 参数 | 类型 | 默认值 | 意义 |
| --- | --- | --- | --- |
| `url` | `string` | `""` | 服务端地址；为空时不发网络请求 |
| `projectName` | `string` | `""` | 项目标识，放入 envelope |
| `appId` | `string` | `""` | 应用/端标识 |
| `userId` | `string` | `""` | 业务用户标识；SDK 不生成、不校验 |
| `isImageUpload` | `boolean` | `false` | true 用 Image GET 查询参数发送 |
| `batchSize` | `number` | `5` | 达到数量时发送；小数向下取整，负数变 0 |

配置只更新已提供字段，`false` 和 `0` 也会生效。实际批处理把 `batchSize: 0` 按单条发送，避免数据永远留在缓存。

## 4. 接收报告

细粒度观察器通过命名导出使用，默认导出的 `monitor` 对象没有
`observeFetch` 属性。观察器回调只接收对应模块：

```ts
import { observeFetch } from "frontend-moniter-sdk";

observeFetch((data) => {
  console.log(data.subType, data.duration);
});
```

默认导出对象只提供三个总入口：

```ts
monitor.performance(); // 启动全部性能观察器
monitor.behavior();    // 启动全部行为观察器
monitor.error();       // 启动浏览器错误观察器
```

如果需要单独启动某一个性能观察器，应使用命名导出，例如
`observeFetch`、`observeXHR`、`observeLCP`。这些细粒度函数的回调只接收
对应类型的数据。

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
  id: string;
  projectName: string;
  appId: string;
  userId: string;
  data: T;
}
```

`id` 由 SDK 生成。直接调用 `report(data)` 时 `data` 是单条；批处理 flush 时 `data` 是缓存数组，因此服务端应兼容两种形态。各数据字段见 `performance.md`、`behavior.md`、`error.md`。

## 6. 发送顺序和失败处理

`report(data)` 的选择顺序是：无 URL/非浏览器返回 false；JSON 序列化失败返回 false；`isImageUpload` 使用 Image；否则优先 `navigator.sendBeacon`；再退回 SDK 捕获的原始 XHR POST；都不可用返回 false。

达到 `batchSize` 自动 flush。`pagehide` 或页面隐藏时也尝试发送未满批次：

```ts
import { flushReportQueue } from "frontend-moniter-sdk";

flushReportQueue(); // boolean：发送成功 true，无缓存或失败 false
```

只有传输函数接受成功才清空缓存；失败时保留，避免静默丢数。图片 GET 会把 JSON 放进 URL，不适合大报告或敏感内容。

`clearReportQueue` 目前是 SDK 内部能力，没有从包根公开。业务侧不应直接丢弃缓存。

## 7. Vue 2 接入

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
monitor.performance();
monitor.behavior();
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
- `monitor.behavior()`：采集首次 PV、点击和原生 hash/history 变化。

## 8. Vue 3 接入

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
monitor.behavior();
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

## 9. React 接入

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
monitor.performance();
monitor.behavior();
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

## 10. Vue Router 和 React Router

首次调用 `monitor.behavior()` 会立即生成一条 PV。SDK 能自动观察 `hashchange` 和 `popstate`，但路由库常通过 `history.pushState`/`replaceState` 切换页面，这两个 API 不会自动触发上述事件。

因此应在路由成功后补充 PV：

```ts
import { observePV } from "frontend-moniter-sdk";

// Vue Router
router.afterEach(() => {
  observePV();
});
```

React Router 可在路由位置变化时调用：

```tsx
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { observePV } from "frontend-moniter-sdk";

export function RouteMonitor(): null {
  const location = useLocation();

  useEffect(() => {
    observePV();
  }, [location.pathname, location.search, location.hash]);

  return null;
}
```

如果入口已经调用 `monitor.behavior()`，首次渲染又立即执行上述路由钩子，可能产生两条初始 PV。业务应选择一种首次 PV 策略：入口自动 PV，或完全由路由钩子记录。

React 18 开发模式下，`StrictMode` 可能重复执行 Effect；使用路由钩子记录 PV 时，开发环境需要自行去重。生产构建不受该开发检查机制影响。

## 11. 停止监听

普通单页应用通常让 SDK 随页面生命周期持续运行，不需要停止。微前端子应用卸载或测试清理时可以：

```ts
import {
  stopObserveBehavior,
  stopObserveError,
  stopObserveFetch,
  stopObserveXHR,
} from "frontend-moniter-sdk";

stopObserveBehavior();
stopObserveError();
stopObserveFetch();
stopObserveXHR();
unsubscribe();
```

FP、FCP、LCP、load 和首轮 resource 属于一次性观察，没有统一的停止入口。

## 12. 隐私

click 含目标 HTML，error 可能含 stack，Fetch/XHR 含 URL。业务应在订阅或服务端脱敏；不要把 `userId` 当作 SDK 生成的匿名 ID。
