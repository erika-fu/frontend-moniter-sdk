# frontend-moniter-sdk

前端监控 TypeScript SDK。

## 环境要求

- Node.js 18 或更高版本
- npm

## 开发

```bash
npm install
npm run check
```

## 线上 Demo（Fly.io）

同源单应用 `frontend-moniter-demo`：`/` 为 demo，`/platform/` 为看板，`/api/v1` 为上报与查询。部署步骤见 [docs/deploy-demo.md](docs/deploy-demo.md)。

## Workspace 命令

SDK、server、platform 和 demo 通过 npm workspaces 管理：

```bash
npm run typecheck:all
npm test
npm run build:all
```

各应用可独立启动：

```bash
npm run dev:server       # http://localhost:9800
npm run dev:platform     # http://localhost:4175
npm run dev:demo         # http://localhost:4173（Vite 开发服）
npm run dev:react-demo   # http://localhost:4174（Vite 开发服）
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

## 常用命令

- `npm run build`：在 `dist/` 生成压缩后的 ESM、CommonJS、IIFE 与类型声明
- `npm run server`：在端口 `9800` 启动报告接收服务
- `npm test`：跑一遍测试
- `npm run test:watch`：Vitest 监听模式
- `npm run typecheck`：只做 TypeScript 检查，不产出文件
- `npm run check`：类型检查 + 测试 + 生产构建
- `npm pack --dry-run`：预览将要发布的文件
- `npm publish`：执行 `prepublishOnly` 后发布生产包

生产构建产物：

- `dist/index.js`：ESM
- `dist/index.cjs`：CommonJS
- `dist/index.iife.js`：浏览器直接使用，全局名 `FrontendMonitor`
- `dist/index.d.ts`：TypeScript 声明

ESM / CommonJS 将 `web-vitals` 保持为 external，便于包管理器去重。IIFE 会打包
`web-vitals`，可独立作为脚本运行。

## 使用方式

初始化浏览器性能与运行时错误监控，并使用内置批量上报：

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

Session replay 基于 rrweb。默认遮蔽所有输入值，并屏蔽带 `monitor-block` class
或 `data-monitor-mask` 属性的元素。事件先留在内存中，直到发生错误；随后 SDK
立即上传错误前片段，并在同一 `replayId` 上继续录制（默认最长 5 分钟，或空闲
30 秒），同时受 1000 事件 / 5 MiB 限制：

```ts
frontendMonitor.replay({
  onReport: (event) => console.log(event),
  maskAllInputs: true,
  preErrorDuration: 60_000,
  postErrorDuration: 5 * 60 * 1000,
  postErrorIdleTimeout: 30_000,
});
```

回放期间采集的运行时错误会带上 `sessionId`、`replayId` 和 `replayOffset`，方便
在报告查看器中跳到错误位置。隐私与播放接入见 [Replay 会话录屏](docs/replay.md)。

通过 Vue 应用插件接入错误捕获（复用 `init` 的配置）：

```ts
app.use(frontendMonitor);
```

从 React Error Boundary 转发错误：

```ts
componentDidCatch(error, info) {
  frontendMonitor.errorBoundary(error, info);
}
```

对外 API 入口在 `src/index.ts`。`init` 只更新默认上报配置，不会启动监控或选择
具体指标；需要采集时请直接调用各监控 API。

生产构建使用 Vite library 模式产出浏览器可用的 ESM，并用 TypeScript 生成声明。
包通过根 ESM 入口暴露 SDK，并将 `web-vitals` 声明为运行时依赖，因此安装本包会
一并安装 `web-vitals`。Vue 仅作为开发依赖，因为 Vue 集成由测试覆盖。

`demo/` 是独立的 Vue 应用，有自己的 package 清单、锁文件、TS / Vite 配置和构建
产物。它直接从 `src/index.ts` 引入 SDK，因此改 SDK 源码无需先构建包即可生效。
根目录安装会装上所有 workspace 依赖：

```bash
npm install
npm run dev:demo
```

然后访问 `http://localhost:4173/`。

## 本地联调 Source Map（demo / server / platform）

服务端解析 Source Map 依赖三个键对齐：

| 键 | 来源 | 必须一致 |
|----|------|----------|
| `appId` | SDK 上报信封 | 与 platform 当前选中的应用相同（demo 默认 `vue-demo`） |
| `release` | SDK 上报信封 | 与上传表单「发布版本」相同（demo 默认 `demo@0.1.0`） |
| 生成文件名 | 错误堆栈里的 JS 路径 | 与上传表单「对应生成文件」相同（如 `index-xxxxx.js`） |

匹配规则：堆栈中的文件路径与 `generatedFile` 做路径尾部比较（例如
`http://localhost:4173/assets/index-xxxxx.js` 可匹配 `index-xxxxx.js`）。

### 为什么 `npm run dev:demo` 解不开

`dev` 走 Vite 开发服，模块直接是 `/src/...`，`Error.stack` 通常类似：

```text
at http://localhost:4173/src/scenarios.ts:15:11
```

这不是打包后的生成文件，上传 `index-xxxxx.js.map` 也无法匹配。  
要验证「服务端 Source Map」，必须用 **生产构建 + preview**。

### 1. Demo：产出打包文件并上报「未还原」的栈

```bash
npm run build:demo
npm --workspace demo run preview
# 打开 http://localhost:4173
```

- Vue demo 预览端口是 **4173**；**4174** 是 react-demo。
- 构建产物在 `demo/dist/assets/`，形如 `index-xxxxx.js` 与 `index-xxxxx.js.map`。
- 在 Chrome DevTools → Settings 中**关闭** “Enable JavaScript source maps”，再硬刷新页面并触发一次 JS 错误。
- 期望上报堆栈类似：

```text
at http://localhost:4173/assets/index-xxxxx.js:144:24258
```

若仍看到 `src/scenarios.ts`，说明浏览器已用页面自带的 `.map` 还原了栈，服务端会显示「未找到对应生成文件」。

### 2. Server：自动存储与解析（无需额外操作）

保持上报接收服务运行：

```bash
npm run dev:server
# http://localhost:9800
```

server 会：

1. 接收 SDK 信封并入库；
2. 通过 `POST /api/v1/source-maps` 按 `(appId, release, generatedFile)` 持久化 map；
3. 查询错误详情时，用 issue 的 `appId` + `release` 筛选 map，再按堆栈文件名匹配，将行列还原为源码位置。

「清除所有记录」会删除事件、错误、回放和 Source Map。应用下拉选项来自已有上报的
`envelopes`，清空后需先让 demo 再上报一次，应用列表才会重新出现。

### 3. Platform：上传与错误详情查看

```bash
npm run dev:platform
# http://localhost:4175
```

1. 选择应用 `vue-demo`（需已有上报）。
2. 打开 **Source Map**，填写：
   - 发布版本：`demo@0.1.0`
   - Source Map 文件：`demo/dist/assets/index-xxxxx.js.map`
   - 对应生成文件：`index-xxxxx.js`（与堆栈中的文件名一致；可带或不带 `assets/`）
3. 上传成功后，到 **错误事项** 打开对应 issue；`resolutionStatus` 应为已解析，并显示原始文件/行号。

每次重新 `build:demo` 后，带 hash 的文件名可能变化，需按**新文件名**重新上传 map。

## 文档

- [业务侧使用说明](docs/business-usage.md)：安装、初始化、配置、上传、Vue/React 和 SPA PV 接入
- [Performance 性能监控](docs/performance.md)：FP、FCP、LCP、load、resource、Fetch、XHR
- [Behavior 用户行为监控](docs/behavior.md)：各功能模块的实现、调用链、设计理由、生命周期和边界
- [点击采集设计](docs/click-tracking.md)：属性门控、事件路径、旧版迁移、跨端边界和隐私治理
- [Error 错误监控](docs/error.md)：资源、JavaScript、Promise、Vue、React 错误
- [Replay 会话录屏](docs/replay.md)：rrweb 操作记录、隐私脱敏和错误定位
- [SDK 入口与内部链路](docs/sdk-internals.md)：统一分发、缓存、订阅、传输、History 包装和事件路径
- [Server 服务端文档](docs/server.md)：启动、版本化上报、SQLite、查询 API、SourceMap、错误和回放

## 报告服务

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
