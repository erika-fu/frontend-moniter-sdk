# frontend-moniter-sdk

TypeScript SDK for frontend monitoring.

## Requirements

- Node.js 18 or newer
- npm

## Development

```bash
npm install
npm run check

```

## Workspace commands

SDK、server、platform 和 demo 通过 npm workspaces 管理：

```bash
npm run typecheck:all
npm test
npm run build:all
```

各应用可以独立启动：

```bash
npm run dev:server       # http://localhost:9800
npm run dev:platform     # http://localhost:4175
npm run dev:demo         # http://localhost:4173
npm run dev:react-demo   # http://localhost:4174
npm run cleanup          # 清理超过 RETENTION_DAYS 的 SQLite 数据
```

版本化上报入口为 `POST /api/v1/reportData`，合法请求返回 `202 Accepted`。
`GET /api/v1/health` 可独立验证 API 边界。旧的 `/reportData` 入口在升级期间
继续可用。

server 默认使用 `server/data/monitoring.sqlite`、端口 `9800` 和 30 天保留期。
部署时可通过以下环境变量调整：

```bash
PORT=9800
REPORT_DB_PATH=./data/monitoring.sqlite
RETENTION_DAYS=30
CORS_ORIGINS=http://localhost:4173,http://localhost:4175
```

`CORS_ORIGINS` 使用逗号分隔的精确 Origin；未设置时为 `*` 以兼容本地 SDK
示例。server 启动时清理一次，并每天重复清理；`npm run cleanup` 可安全地手动
重复执行。上报请求默认限制为 1 MiB，Source Map 默认限制为 5 MiB，回放还
额外限制为 1000 个事件、30 分钟和 5 MiB。

platform 使用 `VITE_SERVER_URL` 指向 server 地址，默认
`http://localhost:9800`；demo 使用以下变量配置上报：

```bash
VITE_MONITOR_URL=http://localhost:9800/api/v1/reportData
VITE_MONITOR_PROJECT=frontend-moniter-sdk-demo
VITE_MONITOR_APP_ID=vue-demo
VITE_MONITOR_USER_ID=local-developer
VITE_MONITOR_RELEASE=demo@0.1.0
```

demo 还将普通监控报告的 `batchSize` 固定为 `1`，因此每批发送 1 条普通报告。这个配置不作用于 Replay：Replay 片段使用独立的最多 1000 个事件和 5 MiB 数据限制，并且不会被普通报告的 `batchSize` 拆散。详见 [Replay 会话录屏](docs/replay.md) 和 [Server 服务端文档](docs/server.md)。

完整链路验收可运行 `npm run test:e2e`，会模拟 demo 的版本化信封，并从
server 提供给 platform 的错误、性能和回放 API 查询结果。

## Commands

- `npm run build` creates minified ESM, CommonJS, IIFE, and bundled declarations
  in `dist/`
- `npm run server` starts the report receiver on port `9800`
- `npm test` runs the test suite once
- `npm run test:watch` runs Vitest in watch mode
- `npm run typecheck` checks TypeScript without emitting files
- `npm run check` runs type checking, tests, and the production build
- `npm pack --dry-run` previews the files that will be published
- `npm publish` runs `prepublishOnly`, then publishes the production package

The production build emits:

- `dist/index.js` for ESM consumers
- `dist/index.cjs` for CommonJS consumers
- `dist/index.iife.js` for direct browser use as `FrontendMonitor`
- `dist/index.d.ts` for TypeScript declarations

ESM and CommonJS keep `web-vitals` external so package managers can deduplicate
it. The IIFE build includes `web-vitals` and can run as a standalone script.

## Usage

Initialize browser performance and runtime error monitoring with built-in
batched reporting:

```ts
import frontendMonitor from "frontend-moniter-sdk";

frontendMonitor.init({
  url: "/monitor",
  projectName: "storefront",
  appId: "web",
  userId: "user-1",
  batchSize: 5,
});

frontendMonitor.performance();
frontendMonitor.behavior({
  clickAttributes: ["clstag"],
});
frontendMonitor.error();
frontendMonitor.replay();
```

`init()` 只更新上报配置，不会启动监控。`behavior()` 启动时立即记录当前页
PV，默认继续监听 URL 变化，并独立记录原生 `hashchange` / `popstate` 诊断信号。
`clickAttributes` 是允许采集的 DOM 属性名列表，`clstag` 是示例；省略或传入空
列表时只关闭点击采集，PV 与地址变化仍会启动。

SDK 批量发送报告，优先使用 `navigator.sendBeacon`，再回退到未被监控包装的
`XMLHttpRequest`。设置 `isImageUpload: true` 可通过图片请求的 `data` 查询参数
发送编码后的载荷。未配置 `url` 时不发网络请求，但 `onReport` 与
`frontendMonitor.subscribe(handler)` 仍可在本地接收单条报告。传输被接受或安排
不等于服务端已经持久化。

Session replay uses rrweb. It masks all input values by default and blocks
elements with the `monitor-block` class or `data-monitor-mask` attribute.
Events stay in memory until an error; then the SDK uploads the pre-error
segment immediately and keeps recording on the same `replayId` (default max
5 minutes, or 30 seconds of idle) within the 1000-event / 5 MiB limits:

```ts
frontendMonitor.replay({
  onReport: (event) => console.log(event),
  maskAllInputs: true,
  preErrorDuration: 60_000,
  postErrorDuration: 5 * 60 * 1000,
  postErrorIdleTimeout: 30_000,
});
```

Runtime error reports collected during replay include `sessionId`,
`replayId`, and `replayOffset`, allowing a report viewer to open the session
at the error position. See [Replay 会话录屏](docs/replay.md) for privacy and
playback integration details.

Install Vue error capture through the application plugin API. It reuses the
configuration provided to `init`:

```ts
app.use(frontendMonitor);
```

Forward errors from a React Error Boundary:

```ts
componentDidCatch(error, info) {
  frontendMonitor.errorBoundary(error, info);
}
```

The public package API starts in `src/index.ts`. `init` only updates the default
reporting configuration; it does not start monitors or select individual
metrics. Call the monitor APIs directly when the application needs to start
collection.

The production build uses Vite library mode for the browser-ready ESM bundle
and TypeScript for declaration files. The package exposes the SDK through its
root ESM entry and declares `web-vitals` as an external runtime dependency.
Installing the package therefore installs `web-vitals` in the business
application. Vue remains a development dependency only because the SDK's Vue
integration is covered by tests.

The `demo/` directory is an independent Vue application with its own package
manifest, lock file, TypeScript configuration, Vite configuration, and build
output. It imports the SDK directly from `src/index.ts`, so SDK source changes
are reflected without building the package first. Root installation includes all
workspace dependencies:

```bash
npm install
npm run dev:demo
```

Then visit `http://localhost:4173/`.

## Documentation

- [业务侧使用说明](docs/business-usage.md)：安装、初始化、配置、上传、Vue/React 和 SPA PV 接入
- [Performance 性能监控](docs/performance.md)：FP、FCP、LCP、load、resource、Fetch、XHR
- [Behavior 用户行为监控](docs/behavior.md)：各功能模块的实现、调用链、设计理由、生命周期和边界
- [点击采集设计](docs/click-tracking.md)：属性门控、事件路径、旧版迁移、跨端边界和隐私治理
- [Error 错误监控](docs/error.md)：资源、JavaScript、Promise、Vue、React 错误
- [Replay 会话录屏](docs/replay.md)：rrweb 操作记录、隐私脱敏和错误定位
- [SDK 入口与内部链路](docs/sdk-internals.md)：统一分发、缓存、订阅、传输、History 包装和事件路径
- [Server 服务端文档](docs/server.md)：启动、版本化上报、SQLite、查询 API、SourceMap、错误和回放

## Report server

仓库提供一个基于 Node.js 和 SQLite 的本地报告服务。推荐使用版本化入口：

```bash
npm run dev:server
# http://localhost:9800
```

```ts
monitor.init({
  url: "http://localhost:9800/api/v1/reportData",
  projectName: "storefront",
  appId: "web",
  release: "web@2026.10.07",
});
```

`POST /api/v1/reportData` 成功返回 `202 Accepted`；旧客户端使用的
`/reportData` 仍兼容并返回 `200 ok`。server 默认将报告写入
`server/data/monitoring.sqlite`，并提供 health、应用/事件、性能、错误、SourceMap
和回放查询接口。`PORT`、`REPORT_DB_PATH`、`RETENTION_DAYS` 和 `CORS_ORIGINS`
可通过环境变量配置。完整的请求字段、响应示例、限制和生产部署注意事项见
[Server 服务端文档](docs/server.md)。

Vue demo 是单页监控场景页：带 `clstag` 的 Hash 按钮切换到
`#/scenario/orders` 或 `#/scenario/profile`，History 按钮通过
`history.pushState()` 修改查询参数；页面还保留一个未标记按钮用于验证它不会产生
点击报告。

## License

MIT
