# Error 错误监控

错误模块监听资源加载失败、未捕获 JavaScript 异常、未处理 Promise rejection，以及 Vue/React 框架错误。它整理为 `ErrorReportData` 后交给统一分发器，不负责独立的服务端协议。

## 1. 浏览器错误

```ts
import { observeError, stopObserveError } from "frontend-moniter-sdk";

observeError((report) => console.log(report));
```

`observeError(onReport?)` 的 `onReport` 类型为 `(data: ErrorReportData) => void`，返回 `void`。没有 `window` 时直接返回；同一个 window 重复调用只更新回调。`stopObserveError()` 移除监听，并在 `window.onerror` 未被其他代码替换时恢复原处理器。

## 2. 资源错误

SDK 用 `window.addEventListener("error", handler, true)` 在捕获阶段观察 `<script>`、`<link>`、`<img>` 等资源。捕获阶段可以收到不一定冒泡的资源事件。

步骤：读取 `event.target`；优先取 `target.src`、其次取 `target.href`；没有地址则忽略；读取元素 HTML、页面 URL 和可序列化事件路径；分发。

```ts
interface ResourceErrorReportData {
  type: "error";
  subType: "resource";
  url: string;
  html: string;
  pageUrl: string;
  paths?: string[]; // 不支持 composedPath/path 时不提供
  replayId?: string;
  sessionId?: string;
  replayOffset?: number;
}
```

`paths` 是节点名称而不是 DOM 对象，例如 `["SCRIPT", "BODY", "HTML", "Document", "Window"]`，避免循环引用。普通资源事件通常不给 HTTP 状态码，所以报告也不包含响应状态。

录屏运行时，所有浏览器和框架错误类型还会带上可选的 `replayId`、`sessionId` 和 `replayOffset`。错误先上报，关联的回放片段默认继续录制 2 秒后再上报；详见 [Replay 会话录屏](replay.md)。

## 3. JavaScript 异常

SDK 先保存原有 `window.onerror`，再安装包装器。异常发生后先生成报告，再调用原处理器，最后返回原处理器的返回值；没有原处理器时返回 `false`。

```ts
interface JavaScriptErrorReportData {
  type: "error";
  subType: "js";
  msg: string;
  url: string;
  lineNo: number | undefined;
  columnNo: number | undefined;
  stack?: string;
  release?: string;
  pageUrl: string;
  startTime: number; // performance.now()
  replayId?: string;
  sessionId?: string;
  replayOffset?: number;
}
```

`message/source/line/column/error` 分别成为 `msg/url/lineNo/columnNo/stack`。跨域脚本可能只有 `Script error.`，属于浏览器同源策略限制。

配置 `release` 后，错误报告会带上发布版本。SDK 只上传浏览器原始 stack、文件 URL、行号和列号，SourceMap 解析由监控服务端完成。

## 4. Promise rejection

SDK 监听 `unhandledrejection`，读取 `event.reason`，不调用 `preventDefault()`，所以不改变 Promise 行为。reason 转字符串的顺序是：字符串原样；`Error` 取 `stack` 或 `message`；普通对象尝试 `JSON.stringify`，失败则 `String`；其他值直接 `String`。

```ts
interface PromiseErrorReportData {
  type: "error";
  subType: "promise";
  reason: string;
  stack?: string;
  release?: string;
  replayId?: string;
  sessionId?: string;
  replayOffset?: number;
  pageUrl: string;
  startTime: number; // event.timeStamp
}
```

## 5. Vue

`install(host, options?)` 兼容 Vue 3 `app` 和 Vue 2 配置对象：

```ts
app.use(monitor);
// 或 monitor.install(app, { onReport });
```

`host` 必须有 `config.errorHandler`。安装时保存既有 handler 并写入包装器；错误时将异常优先转换为 `stack`、`message` 或 `String(error)`，生成报告后继续调用原 handler。

```ts
interface VueErrorReportData {
  type: "error";
  subType: "vue";
  error: string;
  info: string;
  pageUrl: string;
  startTime: number;
  stack?: string;
  release?: string;
  replayId?: string;
  sessionId?: string;
  replayOffset?: number;
}
```

`options.onReport` 是该 app 的额外回调；不传时，报告仍进入自动网络上报和全局 `subscribe`。同一个 app 重复安装只更新回调，不重复包装，不同 app 独立保存状态。

## 6. React Error Boundary

在 `componentDidCatch` 中调用：

```ts
componentDidCatch(error: unknown, info: unknown) {
  monitor.errorBoundary(error, info);
}
```

也可传第三个参数覆盖全局回调：`errorBoundary(error, info, onReport)`。`error` 会提取 stack/message，`info` 原样保存。

```ts
interface ReactErrorReportData {
  type: "error";
  subType: "react";
  error: string;
  info: unknown;
  pageUrl: string;
  startTime: number;
  stack?: string;
  release?: string;
  replayId?: string;
  sessionId?: string;
  replayOffset?: number;
}
```

## 7. 服务端堆栈还原

仓库提供的 `createReportServer` 在接收批量报告后使用 `error-stack-parser` 生成 `stackFrames`，再使用 `source-map-js` 查询 SourceMap，并把结果保存为 `sourceStack`。SourceMap 存储可按 release 定制：

```ts
createReportServer({
  stackResolution: {
    sourceMapUrl: (fileUrl, release) =>
      `https://maps.example.com/${release}/${encodeURIComponent(fileUrl)}.map`,
  },
});
```

`sourceMapUrl` 对每个包含文件名、行号和列号的 stack frame 调用。SourceMap 不可用或解析失败时，服务端保留原始 `stack` 和构建后位置，不阻断报告接收。
