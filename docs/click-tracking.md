# 点击采集设计

本文深入说明点击采集的设计、迁移、隐私与运行边界。完整且规范的 Behavior API、配置和字段定义以 [Behavior 用户行为监控](behavior.md) 为准。

## 1. 核心模型

点击采集由三部分组成：**显式元素标记、属性名允许列表、一个捕获阶段的委托监听器**。

```ts
monitor.behavior({ clickAttributes: ["clstag"] });
```

```html
<button type="button" clstag="checkout-submit">提交订单</button>
```

应用决定哪些交互值得统计，并用属性表达稳定的业务动作；SDK 只从允许的属性名中取值。省略 `clickAttributes`，或列表规范化后为空时，不安装点击监听器；PV 和地址变化采集不受影响。

这套设计不为每个元素单独注册监听器。每个 SDK 模块实例同一时刻只在其当前观察的 `window` 上保留一个 `window.addEventListener("click", handler, true)`。如果页面重复打包了多份 SDK，它们拥有各自的模块状态，仍可能在同一个 `window` 上各装一个监听器。

## 2. 精确采集链路

```text
浏览器派发 click
  -> window 捕获阶段监听器
  -> 第一次读取 composedPath()，不支持时读取 event.path
  -> 从内向外找到最近的已标记元素
  -> 从该元素复制所有命中的允许属性
  -> getSerializableEventPath() 第二次读取事件路径并转成 string[]
  -> 构造 ClickReportData
  -> dispatchReport()
       -> lazyReportBatch()：网络批处理/缓存
       -> notifyReportListeners()：全局订阅者
       -> onReport()：本次观察回调
```

具体步骤如下：

1. **规范化允许列表。** SDK 复制传入数组，忽略非字符串，修剪属性名首尾空白，移除空名称并去重。调用方之后修改原数组，不会改变当前配置。
2. **注册一个捕获监听器。** 捕获阶段通常早于目标阶段和冒泡阶段的 `stopPropagation()`；SDK 不调用 `preventDefault()`，不改变控件默认行为。
3. **解析业务目标。** SDK 沿事件传播路径从内向外检查元素，第一个带有任一允许属性的元素即为目标。因此点击已标记按钮内部的图标时，报告按钮；存在嵌套标记时，只取最近的一层，不合并祖先，也不生成多条报告。
4. **最小化采集。** SDK 只复制目标元素上实际存在的允许属性。同一元素命中多个允许属性时全部保留；显式空值（如 `clstag=""`）仍是有效标记。未允许的 `id`、`class`、任意 `data-*`、`innerHTML` 和 `outerHTML` 均不采集。
5. **在采集边界序列化路径。** `getSerializableEventPath()` 把 DOM 节点、`Document`、`Window` 等宿主对象转换为节点名称字符串，再进入 `dispatchReport()` 和缓存。

当前实现会读取事件路径两次：第一次用于寻找目标，第二次由 `getSerializableEventPath()` 生成报告中的 `path`。正常浏览器事件会返回一致路径；若页面改写了 `composedPath()`，两次调用可能返回不同结果或抛错。

## 3. 最近的已标记祖先与事件路径

SDK 优先使用标准的 `event.composedPath()`，不支持时读取旧版 Chromium 的 `event.path`。两者都不可用时，路径视为空，本次点击被忽略。实现**不会**从 `event.target` 沿 `parentElement` 或 `parentNode` 向上补走祖先链；这避免自行模拟 Shadow DOM 的重定向与封装规则。

典型路径为：

```text
HTMLSpanElement -> HTMLButtonElement -> HTMLBodyElement
-> HTMLHtmlElement -> Document -> Window
```

若 `SPAN` 位于带 `clstag` 的 `BUTTON` 内，SDK 跳过未标记的 `SPAN`，选择最近的已标记 `BUTTON`。`event.currentTarget` 则是安装监听器的 `window`，不是业务目标。

报告中的可选 `path` 不保存上述原始对象，而是类似：

```ts
["SPAN", "BUTTON", "BODY", "HTML", "Document", "Window"]
```

原始宿主对象体积大、可能保留 DOM 引用并包含循环结构，进入批处理后可导致 `JSON.stringify()` 失败，继而阻塞同一缓存中的后续报告。相关历史故障、修复和回归验证见 [点击后错误不上报及页面卡顿解决方案](solutions/click-event-path-reporting.md)。

## 4. 为什么使用语义化 `click`

当前 SDK 监听浏览器 `click`，而不是分别监听 `mousedown` 与 `touchstart`。一次完成的鼠标、触摸或键盘激活通常归一为一个语义事件，更接近“控件已激活”这一业务事实，并避免按设备事件重复计数。按下后变成拖动、滚动或取消且最终未产生 `click` 的交互不会上报。

这也意味着以下交互需要独立的行为类型，不能由本点击采集覆盖：

- swipe、drag、pinch、long press；
- 转为滚动的触摸；
- Canvas 内部命中区域；
- 抑制或从不派发原生 `click` 的自定义手势。

SDK 不检查 `event.isTrusted`。真实指针点击、键盘激活以及 `element.click()` 等程序化点击都可能上报。因此这些数据适合产品分析，不可作为真人证明或反滥用依据。

点击没有 throttle 或 debounce。每次命中标记的真实或程序化 `click` 都会单独生成报告；高频触发时，调用方应自行控制事件产生频率。单次匹配成本大致为传播路径长度乘以允许列表长度。

## 5. 报告与传输语义

点击报告的概要形状如下；字段的规范定义以 [Behavior 用户行为监控 §9.2](behavior.md#92-报告结构) 为准。

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

`target` 是命中元素的标签名，`startTime` 是 `event.timeStamp`，布局宽高缺失时为 `0`。`path` 仅包含节点名称。

`dispatchReport()` 按顺序把同一份领域数据交给网络批处理、全局订阅者和本次 `onReport`。报告达到 `batchSize`，或页面在 `pagehide` / `visibilitychange` 时触发 flush 后，网络层才创建统一 envelope。因此 envelope 的 `environment.url` 是 **flush 时**读取的当前 URL，不保证是点击发生时的 URL；点击自身目前没有独立的点击时 URL 字段。

传输返回“接受”也不等于服务端已确认持久化：

- `sendBeacon()` 的 `true` 只表示浏览器接受排队；
- XHR 路径在本地安排空闲回调后即可返回 `true`；
- Image 路径在本地创建请求并设置 `src` 后即可返回 `true`。

SDK 当前不根据 XHR 响应或图片加载结果确认服务端接收。队列在某个传输方式返回接受后清空。

## 6. 异常隔离的准确边界

强异常隔离从 `dispatchReport()` 开始：网络批处理和 `onReport` 由 `invokeSafely()` 包裹；每个全局订阅者单独隔离；envelope 序列化失败返回 `false`；Beacon、XHR 调度等传输路径也有相应保护。一个订阅者抛错不会阻止后续订阅者。

点击采集器本身没有覆盖整个监听函数的外层 `try/catch`。在调用 `dispatchReport()` **之前**，以下页面可影响或被改写的 API 都可能抛错：

- `event.composedPath()` 或 `event.path` 访问；
- 元素的 `hasAttribute()`、`getAttribute()`；
- `tagName`、`offsetWidth`、`offsetHeight` 等属性读取；
- `getSerializableEventPath()` 内第二次路径读取和节点描述。

原生浏览器对象通常不会这样做，但 hostile 或 monkey-patched API 的异常可能逃出监听器。不能把分发阶段的隔离理解为“整个 collector 永不抛错”。

## 7. 生命周期与作用域

对同一 SDK 模块实例：

- 在同一个 `window` 上重复调用 `observeClick()`，只更新最新的允许列表和回调，不重复注册监听器；
- 新列表规范化后为空时，移除已有监听器；
- 切换到另一个 `window` 时，先移除旧 `window` 的监听器，再安装新监听器；
- `stopObserveClick()` 可重复调用，并清空监听器、回调和允许列表；
- 缺少 `window.addEventListener` 时安全返回。

这里的幂等性是“每个 SDK 模块实例”内的保证，不是跨 bundle、跨 iframe 或跨 JavaScript realm 的全局单例保证。

监听只看到**开始监听之后**派发的事件，不会补采历史点击。应用应在获得所需用户同意且确定采集策略后再调用 `behavior()` / `observeClick()`；撤回同意时应停止观察，并按业务要求处理尚未发送的共享队列。晚启动不会追溯之前的交互，早启动则可能在同意前就采集并进入本地回调或网络缓存。

## 8. iframe、WebView 与小程序边界

### iframe

DOM 事件不会跨 iframe 的 `Window` 边界冒泡或进入父页面的传播路径。父页面安装的监听器不能采集 iframe 文档内部的点击；iframe 内的监听器也不能采集父页面。

如需采集 iframe 内容，必须在对应 frame 的 JavaScript 环境中单独初始化 SDK。跨源 iframe 仍受同源策略和各自的部署、同意及数据治理约束，不能依靠父页面直接读取其 DOM。每个 frame 中的 SDK 模块实例都有独立监听器与模块状态。

### H5 与 WebView

普通 H5 按钮、链接、标签页和键盘可激活控件适合语义化 `click`。SDK 只能观察其代码实际运行的 WebView 文档；不同 WebView 是不同环境。小程序 `<web-view>` 中的 H5 可以使用本 SDK，但采集范围仅限该 WebView 内的网页内容。

### 原生小程序页面

原生小程序页面不是 DOM 环境。其 `tap`、`longpress` 没有标准 `window.addEventListener`、DOM 属性或 `composedPath()`，本 Web SDK 无法直接采集。跨平台分析应共享稳定业务标记，但使用平台适配器并保留原生事件类型：

```text
Web/H5       -> eventType: "click"
Mini-program -> eventType: "tap"
Shared key   -> clstag: "checkout-submit"
```

不要把原生 `tap` 伪装成 DOM `click`；消费侧应按业务标记聚合。

## 9. 隐私与数据治理

`clickAttributes` 只允许**属性名**，不证明属性值安全。SDK 会逐字复制值，不校验、不脱敏、不截断，也不限制长度或基数。应使用稳定、有限、低基数的动作名，例如：

```text
checkout-submit
cart-remove
settings-save
```

不要写入密钥、令牌、邮箱、手机号、用户输入、自由文本、动态按钮文案，或用户 ID、订单 ID、会话 ID 等无边界高基数标识。超长值同样会原样进入报告并增加缓存、序列化和传输成本。

报告仍包含标签名、布局尺寸和节点名称路径；共享 envelope 还包含 flush 时 URL、用户标识、User-Agent 和语言。显式标记与属性允许列表减少了 DOM 内容采集，但不能替代用户同意、数据分类、保留期限、服务端清洗及访问控制。

## 10. 从旧版自动采集迁移

旧实现自动监听捕获阶段的 `mousedown` 和 `touchstart`，无需业务标记。当前实现改为显式配置后的捕获阶段 `click`：

| | 旧实现 | 当前实现 |
| --- | --- | --- |
| 触发事件 | `mousedown`、`touchstart` | `click` |
| 开启方式 | 默认采集 | 配置非空 `clickAttributes` |
| 上报范围 | 每次指针按下 | 最近祖先命中允许属性的点击 |
| 目标 | 原始事件目标 | 最近的已标记祖先 |
| `eventType` | `"mousedown"` / `"touchstart"` | `"click"` |
| DOM 内容 | 曾包含 `innerHtml`、`outerHtml` | 不采集 |
| 业务标记 | 无 | `attributes`，仅含允许属性 |

迁移步骤：

1. 选择一个或少量稳定属性名，并配置 `clickAttributes`；
2. 只给需要统计的控件添加低基数动作值；
3. 将消费逻辑从按下时点改为控件激活语义，并使用 `eventType: "click"`；
4. 停止依赖 `innerHtml`、`outerHtml`、展示文案或原始事件目标；
5. 验证嵌套控件、键盘激活、程序化点击、iframe 和同意时序；
6. 按 [Behavior 用户行为监控](behavior.md) 的规范字段更新数据处理与看板。

未标记的点击在迁移后会被有意忽略。这是降低隐私风险和噪声的设计结果，而不是采集遗漏。
