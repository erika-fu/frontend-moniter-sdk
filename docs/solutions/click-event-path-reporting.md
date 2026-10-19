# 点击后错误不上报及页面卡顿解决方案

## 当前约束

点击采集现在是捕获阶段的浏览器 `click`，并且只有配置了 `clickAttributes` 才会上报。报告字段见 [Behavior 用户行为监控](../behavior.md)。当前点击报告不包含 `innerHtml` 或 `outerHtml`。

下面记录的是一次历史故障：点击路径上的浏览器对象被放进上报队列，序列化失败后阻塞了后续错误报告。这条约束仍然有效：

> 进入 `dispatchReport` 和上报队列之前，必须把 `Window`、`Document`、DOM 节点和其他宿主对象转换成可序列化的领域数据。

`getSerializableEventPath()` 负责把传播路径变成节点名称字符串。不要把转换推迟到 `JSON.stringify`。

## 问题现象

Vue demo 启动行为监控和错误监控后，真实点击“Vue 异常”等按钮会出现以下现象：

1. 点击按钮时有明显卡顿，并且连续点击后可能越来越慢。
2. Vue 已经抛出异常，但 Network 面板中没有对应的 `reportData` 请求。
3. 后端没有收到 `subType: "vue"` 的错误报告。
4. 通过脚本直接调用 `button.click()` 时，错误有时又可以正常上报。

这里需要注意，SDK 优先使用 `navigator.sendBeacon` 上报。在 Chrome Network 面板中，这类请求的类型是 `Ping`，需要在 `All` 或 `Other` 分类下查看，而不是只查看 `Fetch/XHR`。

本次问题并不只是 Network 面板的过滤方式造成的。真实鼠标点击确实会使上报缓存进入无法序列化的状态。

## 产生原因

### 1. 点击报告保存了原始 DOM 对象

当时的行为监控在捕获阶段监听 `mousedown` 和 `touchstart`。当前版本改为捕获阶段的 `click`，并按属性允许列表过滤；历史故障本身来自路径上的宿主对象，不取决于事件名。

历史监听方式：

```ts
window.addEventListener("mousedown", mouseDownHandler, true);
window.addEventListener("touchstart", touchStartHandler, true);
```

旧实现通过 `event.composedPath()` 获取事件传播路径，并将返回值直接放入报告：

```ts
const legacyEvent = event as Event & { path?: EventTarget[] };
const path =
    typeof event.composedPath === "function"
        ? event.composedPath()
        : legacyEvent.path;

dispatchReport(
    {
        type: "behavior",
        subType: "click",
        // ...
        ...(path ? { path } : {}),
    },
    reportHandler,
);
```

`composedPath()` 返回的不是普通 JSON 数据，而是实际的浏览器对象，例如：

```text
HTMLButtonElement
HTMLDivElement
HTMLBodyElement
HTMLHtmlElement
Document
Window
```

这些对象包含大量属性和循环引用。特别是 `Window`、`Document` 和 DOM 节点不能作为普通业务数据直接交给 `JSON.stringify`。

### 2. 批量上报无法序列化点击报告

采集数据经过以下链路：

```text
dispatchReport()
    -> lazyReportBatch()
    -> addCache()
    -> flushQueue()
    -> report()
    -> JSON.stringify()
```

上报函数需要把统一信封转换为 JSON：

```ts
reportData = JSON.stringify(createEnvelope(data));
```

当批次中包含原始 DOM 传播路径时，序列化会因为循环引用失败。`report()` 返回 `false`，请求不会发出。

### 3. 失败数据保留在缓存中

缓存的设计原则是：只有传输被接受后才能清空，防止网络失败时丢数据：

```ts
if (!report(batch)) {
    return false;
}

clearCache();
```

这个策略对网络失败是正确的，但无法序列化的数据永远不可能发送成功。因此：

1. 第一次真实点击把包含 DOM 对象的数据加入缓存。
2. 序列化失败，缓存没有清空。
3. Vue 错误随后加入同一缓存。
4. SDK 再次序列化整个批次，仍被第一条点击数据阻塞。
5. 后续每次点击都会扩大缓存，并重复遍历无法序列化的数据。

最终同时表现为：

- 点击报告没有请求；
- Vue 错误报告也没有请求；
- 主线程不断处理越来越大的失败批次，页面产生明显卡顿。

### 4. 为什么脚本 `button.click()` 可能正常

直接执行：

```ts
button.click();
```

通常只派发 `click` 事件，不会完整模拟真实指针产生的 `mousedown`。SDK 的点击监控监听的是 `mousedown` 和 `touchstart`，因此脚本调用可能绕过问题数据，只触发 Vue 错误处理器。

真实鼠标点击会先产生 `mousedown`，所以会稳定触发该问题。

## 修复方案

修复原则是：

> 采集边界只保留可序列化的数据，不把浏览器宿主对象放入上报缓存。

新增统一的事件路径转换函数：

```ts
function describeEventTarget(target: EventTarget): string {
    if (typeof window !== "undefined" && target === window) {
        return "Window";
    }
    if (typeof document !== "undefined" && target === document) {
        return "Document";
    }

    const node = target as EventTarget & {
        tagName?: unknown;
        nodeName?: unknown;
    };
    if (typeof node.tagName === "string") {
        return node.tagName;
    }
    if (typeof node.nodeName === "string") {
        return node.nodeName;
    }

    return target.constructor?.name || "EventTarget";
}

export function getSerializableEventPath(
    event: Event,
): string[] | undefined {
    const legacyEvent = event as Event & { path?: EventTarget[] };
    const eventPath =
        typeof event.composedPath === "function"
            ? event.composedPath()
            : legacyEvent.path;

    return eventPath?.map(describeEventTarget);
}
```

点击采集在调用 `dispatchReport` 之前保存节点名称。当前报告只包含允许的属性和可序列化元数据，不包含 `innerHtml` 或 `outerHtml`：

```ts
const path = getSerializableEventPath(event);

dispatchReport(
    {
        type: "behavior",
        subType: "click",
        target: target.tagName,
        startTime: event.timeStamp,
        width: target.offsetWidth ?? 0,
        height: target.offsetHeight ?? 0,
        eventType: "click",
        attributes,
        ...(path ? { path } : {}),
    },
    reportHandler,
);
```

报告中的路径现在是普通字符串数组：

```json
{
    "type": "behavior",
    "subType": "click",
    "path": ["BUTTON", "DIV", "BODY", "HTML", "Document", "Window"]
}
```

资源加载错误同样会携带事件路径，因此也复用 `getSerializableEventPath()`，避免另一条采集链路产生相同问题。

对应类型从：

```ts
path?: EventTarget[];
paths?: EventTarget[];
```

修改为：

```ts
path?: string[];
paths?: string[];
```

## 为什么在采集阶段转换

也可以在 `JSON.stringify` 时使用循环引用 replacer，但这不是首选方案：

1. replacer 仍可能遍历体积很大的 DOM 对象，不能彻底解决卡顿。
2. `Window` 和 DOM 节点的序列化结果没有稳定业务语义。
3. 缓存中继续持有 DOM 对象会延长对象生命周期，增加内存占用。
4. 不同传输方式都需要可序列化数据，在采集边界统一转换更可靠。

因此，SDK 应在创建报告时就把浏览器对象转换为稳定的领域数据。

## 回归测试

回归测试构造一个带循环引用的点击传播路径，并在进入队列前断言路径已被转换成字符串。当前监听器是 `click`：

```ts
const windowTarget: { self?: unknown } = {};
windowTarget.self = windowTarget;

eventHandlers.get("click")?.({
    target,
    timeStamp: 24,
    composedPath: () => [target, windowTarget],
} as unknown as MouseEvent);
```

随后立即触发 Vue 错误，并断言两条数据都成功发出：

```ts
expect(reports).toEqual([
    expect.objectContaining({
        type: "behavior",
        subType: "click",
    }),
    expect.objectContaining({
        type: "error",
        subType: "vue",
    }),
]);
```

这个测试同时验证：

- 循环点击路径不会阻塞序列化；
- 点击数据能够正常上报；
- 点击数据不会污染批量缓存；
- 后续 Vue 错误仍能正常上报。

## 浏览器验证结果

下面是修复路径序列化时的验证记录。当前点击监听器只注册捕获阶段的 `click`，不再监听 `mousedown`。

当时使用的真实事件顺序：

```text
mousedown -> click -> Vue errorHandler
```

结果：

- 同步点击处理耗时约 `6.8ms`；
- 产生一条 click 报告；
- 产生一条 Vue error 报告；
- 两条请求均为 `POST reportData`；
- 使用 `sendBeacon` 时，Chrome 中的请求类型为 `Ping`；
- 连续点击不再积累无法序列化的缓存。

## 排查清单

以后遇到“采集到了但没有上报”或“上报后页面卡顿”时，应依次检查：

1. 报告对象是否包含 DOM、Window、Document、Event、Request、Response 等宿主对象。
2. 报告对象是否包含循环引用。
3. `JSON.stringify` 是否成功。
4. 失败批次是否一直留在缓存中。
5. `batchSize` 是否符合预期。
6. Network 面板是否选择了 `All` 或 `Other`。
7. 上报请求是否以 `Ping` 类型出现。
8. demo 配置的上报端口是否与当前后端服务一致。

## 相关代码

- `src/eventPath.ts`
- `src/behavior/click.ts`
- `src/error/index.ts`
- `src/report.ts`
- `test/initReporting.test.ts`

