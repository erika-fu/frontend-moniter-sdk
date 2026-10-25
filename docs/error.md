# Error 错误监控

错误模块监听资源加载失败、未捕获 JavaScript 异常、未处理 Promise rejection，以及 Vue/React 框架错误。它整理为 `ErrorReportData` 后交给统一分发器，不负责独立的服务端协议。

## 1. 浏览器错误

```ts
import { observeError, stopObserveError } from "frontend-moniter-sdk";

observeError((report) => console.log(report));
```

`observeError(onReport?)` 的 `onReport` 类型为 `(data: ErrorReportData) => void`，返回 `void`。没有 `window` 时直接返回；同一个 window 重复调用只更新回调。`stopObserveError()` 移除监听，并在 `window.onerror` 未被其他代码替换时恢复原处理器。

错误监听不能回溯已经发生的错误。要监控页面中 `<script>` 标签的加载和执行错误，应尽早加载 SDK，并在业务脚本执行前调用 `observeError()`：

```html
<head>
  <script src="/monitor-sdk.js"></script>
  <script>
    monitor.observeError();
  </script>

  <script src="/app.js"></script>
</head>
```

`/app.js` 加载失败、同步执行异常及其未处理 Promise rejection 此后分别进入资源错误、JavaScript 异常和 Promise rejection 通道。如果业务脚本先于监控初始化执行，它在初始化前产生的错误无法上报。

## 2. 资源错误

SDK 用 `window.addEventListener("error", handler, true)` 在捕获阶段观察 `<script>`、`<link>`、`<img>` 等资源。资源加载失败触发的 `error` 事件不会冒泡，因此必须在捕获阶段监听。

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

`paths` 是节点名称而不是 DOM 对象，例如 `["SCRIPT", "BODY", "HTML", "Document", "Window"]`，避免循环引用。普通资源事件通常不给 HTTP 状态码，所以报告也不包含响应状态、响应内容或具体失败原因。

例如，下面的脚本下载失败时会作为 `subType: "resource"` 上报，`url` 为脚本资源地址，`html` 为对应 `<script>` 元素的 HTML：

```html
<script src="/assets/not-exist.js"></script>
```

需要区分资源加载失败和脚本执行异常：前者的事件目标是 `<script>` 元素，进入资源错误通道；脚本成功加载后抛出的异常则由 `window.onerror` 捕获，进入 JavaScript 异常通道。

录屏运行时，所有浏览器和框架错误类型还会带上可选的 `replayId`、`sessionId` 和 `replayOffset`。错误先上报；具备完整 snapshot 后，错误前回放片段也会立即上报，随后在同一 `replayId` 下继续录制错误后事件（默认最长 5 分钟，空闲 30 秒结束，并受事件数/体积上限约束）。详见 [Replay 会话录屏](replay.md)。

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

`message/source/line/column/error` 分别成为 `msg/url/lineNo/columnNo/stack`。内联脚本执行异常时，`url` 通常是当前 HTML 文档地址；外部脚本执行异常时，`url` 通常是对应脚本地址。

跨域脚本未正确配置 CORS 时，浏览器可能只提供 `Script error.`，并隐藏文件地址、行列号和堆栈。要获取完整信息，需要同时在标签上声明 `crossorigin="anonymous"`，并让脚本服务器返回允许当前站点（或按部署策略允许所有来源）的 CORS 响应头：

```html
<script
  src="https://cdn.example.com/app.js"
  crossorigin="anonymous"
></script>
```

```http
Access-Control-Allow-Origin: https://app.example.com
```

只设置 `crossorigin` 或只返回 CORS 响应头都不足以解除该限制。

配置 `release` 后，错误报告会带上发布版本。SDK 只上传浏览器原始 stack、文件 URL、行号和列号，SourceMap 解析由监控服务端完成。

## 4. Promise rejection

SDK 监听 `unhandledrejection`，读取 `event.reason`，不调用 `preventDefault()`，所以不改变 Promise 行为。`<script>` 中未处理的 Promise rejection 同样通过此通道上报；已经被 `.catch()` 或 `try/catch` 处理的异常不会触发全局 `unhandledrejection`，因此不会由该监听器自动上报。

reason 转字符串的顺序是：字符串原样；`Error` 取 `stack` 或 `message`；普通对象尝试 `JSON.stringify`，失败则 `String`；其他值直接 `String`。

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

仓库提供的 `createReportServer` 在接收批量报告后使用 `error-stack-parser` 生成 `stackFrames`，再使用 `source-map-js` 查询 SourceMap。SQLite server 会保留原始 `rawStack`，并在查询 issue 时返回 `stackFrames` 和 `resolutionStatus`；不会用映射结果覆盖原始 stack。SourceMap 可以通过持久化 API 按 `appId`、`release` 和 generated file 上传，也可以为嵌入式 server 配置外部 URL：

```ts
createReportServer({
  stackResolution: {
    sourceMapUrl: (fileUrl, release) =>
      `https://maps.example.com/${release}/${encodeURIComponent(fileUrl)}.map`,
  },
});
```

`sourceMapUrl` 对每个包含文件名、行号和列号的 stack frame 调用。使用仓库内 SQLite server 时，也可以调用 `POST /api/v1/source-maps` 上传 version 3 SourceMap；同一 `appId`、`release`、`generatedFile` 默认不能重复上传，设置 `replace=true` 才会覆盖，上传上限为 5 MiB。SourceMap 不可用或解析失败时，服务端保留原始 `stack` 和构建后位置，不阻断报告接收，`resolutionStatus` 会说明是 `resolved`、`version_not_found`、`file_not_found`、`parse_failed` 还是 `unmapped`。错误 issue 可通过 `GET /api/v1/errors` 查询，并用 `PATCH /api/v1/errors/:fingerprint` 更新为 `unresolved`、`resolved` 或 `ignored`。完整请求、响应和部署说明见 [Server 服务端文档](server.md)。
