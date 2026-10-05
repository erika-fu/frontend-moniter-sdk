# Behavior 用户行为监控

行为模块位于 `src/behavior/`，包含页面访问（PV）、鼠标/触摸交互和地址变化。它实际监听的是 `mousedown` 与 `touchstart`，不是浏览器的 `click` 事件。

## 1. 总入口

```ts
import { observeBehavior, stopObserveBehavior } from "frontend-moniter-sdk";

observeBehavior({
  onReport(data) {
    console.log(data);
  },
});
```

| 参数 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `options` | `BehaviorMonitoringOptions` | `{}` | 启动行为观察 |
| `options.onReport` | `(data: BehaviorReportData) => void` | 无 | 接收 pv、click、hashchange、popstate |

启动顺序是 click、page change、PV。`stopObserveBehavior()` 停止 click 和 page change；PV 是立即采集且没有长期监听器，不需要停止。

## 2. PV 页面访问

入口：`observePV(onReport?)`。调用即采集一次，不注册监听器；SPA 每次业务确认进入新页面时，应再次调用。

步骤：检查浏览器对象；读取 `performance.now()`、`window.location.href`、`document.referrer`；用 `crypto.randomUUID()` 生成 ID（旧环境使用时间戳和随机数降级）；立即分发。

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

`referrer` 来自浏览器，直接打开页面时可能为空。`uuid` 只标识本条行为数据，不是用户 ID 或会话 ID。

## 3. 点击/触摸交互

`observeClick(onReport?)` 在捕获阶段注册 `mousedown` 和 `touchstart`。捕获阶段可以在业务调用 `stopPropagation()` 前完成采集。

每次事件：检查目标是否有 `tagName`；读取标签名、`innerHTML`、`outerHTML`、`offsetWidth`、`offsetHeight` 和事件时间戳；把 `composedPath()`（旧环境回退 `event.path`）转换为字符串；最后分发。

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

`path` 只保存节点名称，不保存 DOM 引用。`innerHtml`、`outerHtml` 可能含用户输入，业务上传前应评估隐私和体积风险；SDK 当前不会脱敏或截断。重复启动只更新最新回调，`stopObserveClick()` 移除两个监听器。

## 4. 地址变化

`observePageChange(onReport?)` 监听捕获阶段的 `hashchange` 和 `popstate`。初始化时保存 `window.location.href`。

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

`pushState` 和 `replaceState` 本身不会触发 `popstate`；业务使用它们时应在路由完成后手动调用 `observePV()`。SDK 不劫持 History API。

## 5. ID 和时间

`generateBehaviorId()` 优先使用 `crypto.randomUUID()`，降级格式为 `behavior-${Date.now()}-${random}`。它不应作为安全凭证。行为 `startTime` 是页面时间轴/事件时间戳，不是 Unix 时间，服务端应另记接收时间。
