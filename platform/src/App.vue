<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";

interface AppInfo {
  appId: string;
  projectName: string;
}
interface EventItem {
  id: number;
  timestamp: number;
  type: string;
  subType: string;
  release: string;
  userId: string;
  pageUrl: string;
  data: Record<string, unknown>;
  raw?: unknown;
}
interface Overview {
  summary: { total: number; byType: Array<{ type: string; count: number }> };
  events: { items: EventItem[]; total: number; page: number; pageSize: number };
}
interface ErrorIssue {
  fingerprint: string;
  appId: string;
  subType: string;
  message: string;
  stack: string;
  status: "unresolved" | "resolved" | "ignored";
  firstSeen: number;
  lastSeen: number;
  count: number;
  userCount: number;
  pages: string[];
  releases: string[];
}
interface ErrorResult {
  items: ErrorIssue[];
  total: number;
  page: number;
  pageSize: number;
}
interface ErrorDetail {
  issue: ErrorIssue;
  events: { items: EventItem[]; total: number; page: number; pageSize: number };
}

const apiUrl = import.meta.env.VITE_SERVER_URL ?? "http://localhost:9800";
const apps = ref<AppInfo[]>([]);
const selectedAppId = ref("");
const from = ref("");
const to = ref("");
const selectedType = ref("");
const view = ref<"overview" | "errors">("overview");
const errorStatus = ref("");
const errorSubType = ref("");
const errorSearch = ref("");
const errorResult = ref<ErrorResult | null>(null);
const selectedError = ref<ErrorDetail | null>(null);
const errorPage = ref(1);
const errorLoading = ref(false);
const overview = ref<Overview | null>(null);
const loading = ref(true);
const error = ref("");
const refreshingEvents = ref(false);
let refreshTimer: number | undefined;

const selectedApp = computed(() =>
  apps.value.find((app) => app.appId === selectedAppId.value),
);

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("zh-CN", { hour12: false });
}

function queryString(): string {
  const params = new URLSearchParams();
  if (selectedAppId.value) params.set("appId", selectedAppId.value);
  if (from.value) params.set("from", String(new Date(`${from.value}T00:00:00`).getTime()));
  if (to.value) params.set("to", String(new Date(`${to.value}T23:59:59.999`).getTime()));
  if (selectedType.value) params.set("type", selectedType.value);
  return params.toString();
}

function errorQueryString(): string {
  const params = new URLSearchParams();
  if (selectedAppId.value) params.set("appId", selectedAppId.value);
  if (from.value) params.set("from", String(new Date(`${from.value}T00:00:00`).getTime()));
  if (to.value) params.set("to", String(new Date(`${to.value}T23:59:59.999`).getTime()));
  if (errorStatus.value) params.set("status", errorStatus.value);
  if (errorSubType.value) params.set("subType", errorSubType.value);
  if (errorSearch.value) params.set("search", errorSearch.value);
  params.set("page", String(errorPage.value));
  params.set("pageSize", "20");
  return params.toString();
}

async function loadApps(): Promise<void> {
  const response = await fetch(`${apiUrl}/api/v1/apps`);
  if (!response.ok) throw new Error("应用列表加载失败");
  apps.value = (await response.json()) as AppInfo[];
  if (!selectedAppId.value && apps.value[0]) selectedAppId.value = apps.value[0].appId;
}

async function loadOverview(manual = false): Promise<void> {
  if (manual) refreshingEvents.value = true;
  else loading.value = true;
  error.value = "";
  try {
    const response = await fetch(`${apiUrl}/api/v1/overview?${queryString()}`);
    if (!response.ok) throw new Error("监控数据加载失败");
    overview.value = (await response.json()) as Overview;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "监控数据加载失败";
  } finally {
    loading.value = false;
    refreshingEvents.value = false;
  }
}

async function loadErrors(): Promise<void> {
  errorLoading.value = true;
  error.value = "";
  try {
    const response = await fetch(`${apiUrl}/api/v1/errors?${errorQueryString()}`);
    if (!response.ok) throw new Error("错误列表加载失败");
    errorResult.value = (await response.json()) as ErrorResult;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "错误列表加载失败";
  } finally {
    errorLoading.value = false;
    loading.value = false;
  }
}

async function openError(issue: ErrorIssue): Promise<void> {
  const response = await fetch(
    `${apiUrl}/api/v1/errors/${encodeURIComponent(issue.fingerprint)}?pageSize=10`,
  );
  if (!response.ok) {
    error.value = "错误详情加载失败";
    return;
  }
  selectedError.value = (await response.json()) as ErrorDetail;
}

async function setErrorStatus(status: ErrorIssue["status"]): Promise<void> {
  if (!selectedError.value) return;
  const response = await fetch(
    `${apiUrl}/api/v1/errors/${encodeURIComponent(selectedError.value.issue.fingerprint)}`,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) },
  );
  if (!response.ok) {
    error.value = "错误状态更新失败";
    return;
  }
  selectedError.value.issue.status = status;
  await loadErrors();
}

async function initialize(): Promise<void> {
  try {
    await loadApps();
    await loadOverview();
  } catch (cause) {
    loading.value = false;
    error.value = cause instanceof Error ? cause.message : "服务不可用";
  }
}

watch([selectedAppId, from, to, selectedType], () => {
  if (apps.value.length > 0 && view.value === "overview") void loadOverview();
});
watch([selectedAppId, from, to, errorStatus, errorSubType, errorSearch, errorPage], () => {
  if (apps.value.length > 0 && view.value === "errors") void loadErrors();
});

onMounted(() => {
  void initialize();
  refreshTimer = window.setInterval(() => {
    if (view.value === "errors") void loadErrors();
    else void loadOverview();
  }, 30_000);
});
onUnmounted(() => {
  if (refreshTimer !== undefined) window.clearInterval(refreshTimer);
});
</script>

<template>
  <main>
    <header class="page-header">
      <div>
        <p class="eyebrow">Frontend Monitor</p>
        <h1>监控总览</h1>
        <p class="subtitle">{{ selectedApp?.projectName || "选择一个应用查看上报事件" }}</p>
      </div>
      <button class="refresh-button" type="button" @click="view === 'errors' ? loadErrors() : loadOverview(true)">
        <span aria-hidden="true">↻</span> 刷新事件
      </button>
    </header>

    <nav class="view-tabs" aria-label="监控模块">
      <button type="button" :class="{ active: view === 'overview' }" @click="view = 'overview'; void loadOverview()">总览</button>
      <button type="button" :class="{ active: view === 'errors' }" @click="view = 'errors'; void loadErrors()">错误事项</button>
    </nav>

    <section class="filters" aria-label="查询筛选">
      <label>应用
        <select v-model="selectedAppId">
          <option value="" disabled>选择应用</option>
          <option v-for="app in apps" :key="app.appId" :value="app.appId">
            {{ app.projectName }} ({{ app.appId }})
          </option>
        </select>
      </label>
      <label>开始日期 <input v-model="from" type="date"></label>
      <label>结束日期 <input v-model="to" type="date"></label>
      <label>事件类型
        <select v-model="selectedType">
          <option value="">全部类型</option>
          <option v-for="item in overview?.summary.byType || []" :key="item.type" :value="item.type">
            {{ item.type }}
          </option>
        </select>
      </label>
    </section>

    <p v-if="loading || errorLoading" class="state">正在加载监控数据...</p>
    <p v-else-if="error" class="state state-error" role="alert">{{ error }}</p>
    <template v-else-if="view === 'overview' && overview">
      <section class="summary-grid" aria-label="统计摘要">
        <article class="metric"><span>事件总量</span><strong>{{ overview.summary.total }}</strong></article>
        <article v-for="item in overview.summary.byType" :key="item.type" class="metric">
          <span>{{ item.type }}</span><strong>{{ item.count }}</strong>
        </article>
      </section>

      <section class="events-section" aria-labelledby="events-title">
        <div class="section-heading">
          <div><p class="eyebrow">Event stream</p><h2 id="events-title">原始事件</h2></div>
          <span class="result-count">{{ overview.events.total }} 条</span>
        </div>
        <p v-if="overview.events.items.length === 0" class="state">当前筛选条件下没有数据</p>
        <div v-else class="table-wrap">
          <table>
            <thead><tr><th>时间</th><th>类型</th><th>页面</th><th>用户</th><th>版本</th><th>数据</th></tr></thead>
            <tbody>
              <tr v-for="event in overview.events.items" :key="event.id">
                <td>{{ formatTime(event.timestamp) }}</td>
                <td><strong>{{ event.type }}</strong><small>{{ event.subType }}</small></td>
                <td class="truncate" :title="event.pageUrl">{{ event.pageUrl || "-" }}</td>
                <td>{{ event.userId || "-" }}</td>
                <td>{{ event.release || "-" }}</td>
                <td><code>{{ JSON.stringify(event.data) }}</code></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
    <template v-else-if="view === 'errors' && errorResult">
      <section class="filters error-filters" aria-label="错误筛选">
        <label>关键词 <input v-model="errorSearch" type="search" placeholder="消息或堆栈"></label>
        <label>子类型
          <select v-model="errorSubType">
            <option value="">全部子类型</option>
            <option value="js">JavaScript</option><option value="promise">Promise</option>
            <option value="resource">资源</option><option value="vue">Vue</option><option value="react">React</option>
          </select>
        </label>
        <label>状态
          <select v-model="errorStatus">
            <option value="">全部状态</option><option value="unresolved">未解决</option>
            <option value="resolved">已解决</option><option value="ignored">已忽略</option>
          </select>
        </label>
      </section>
      <section class="events-section" aria-labelledby="errors-title">
        <div class="section-heading"><div><p class="eyebrow">Error tracking</p><h2 id="errors-title">错误事项</h2></div><span class="result-count">{{ errorResult.total }} 条</span></div>
        <p v-if="errorResult.items.length === 0" class="state">当前筛选条件下没有错误</p>
        <div v-else class="table-wrap">
          <table>
            <thead><tr><th>错误</th><th>状态</th><th>首次发生</th><th>最近发生</th><th>次数</th><th>用户</th><th>版本</th></tr></thead>
            <tbody><tr v-for="issue in errorResult.items" :key="issue.fingerprint" class="clickable-row" @click="openError(issue)">
              <td><strong>{{ issue.message || "(无消息)" }}</strong><small>{{ issue.subType }} · {{ issue.stack || "无堆栈" }}</small></td>
              <td><span :class="['status-badge', `status-${issue.status}`]">{{ issue.status === "resolved" ? "已解决" : issue.status === "ignored" ? "已忽略" : "未解决" }}</span></td>
              <td>{{ formatTime(issue.firstSeen) }}</td><td>{{ formatTime(issue.lastSeen) }}</td><td>{{ issue.count }}</td><td>{{ issue.userCount }}</td><td>{{ issue.releases.filter(Boolean).join(", ") || "-" }}</td>
            </tr></tbody>
          </table>
        </div>
        <div v-if="errorResult.total > errorResult.pageSize" class="pagination">
          <button type="button" :disabled="errorPage <= 1" @click="errorPage--">上一页</button>
          <span>第 {{ errorPage }} 页</span>
          <button type="button" :disabled="errorPage * errorResult.pageSize >= errorResult.total" @click="errorPage++">下一页</button>
        </div>
      </section>
      <aside v-if="selectedError" class="detail-panel" aria-label="错误详情">
        <div class="section-heading"><div><p class="eyebrow">Issue detail</p><h2>{{ selectedError.issue.message || "(无消息)" }}</h2></div><button class="close-button" type="button" aria-label="关闭详情" title="关闭详情" @click="selectedError = null">×</button></div>
        <div class="detail-actions">
          <button type="button" :class="{ selected: selectedError.issue.status === 'unresolved' }" @click="setErrorStatus('unresolved')">未解决</button>
          <button type="button" :class="{ selected: selectedError.issue.status === 'resolved' }" @click="setErrorStatus('resolved')">已解决</button>
          <button type="button" :class="{ selected: selectedError.issue.status === 'ignored' }" @click="setErrorStatus('ignored')">已忽略</button>
        </div>
        <p class="detail-meta">{{ selectedError.issue.subType }} · {{ selectedError.issue.count }} 次 · {{ selectedError.issue.userCount }} 位用户 · {{ formatTime(selectedError.issue.firstSeen) }} 至 {{ formatTime(selectedError.issue.lastSeen) }}</p>
        <pre class="stack">{{ selectedError.issue.stack || "无有效堆栈" }}</pre>
        <h3>发生记录</h3>
        <div class="table-wrap"><table><thead><tr><th>时间</th><th>页面</th><th>用户</th><th>版本</th><th>原始上报</th></tr></thead><tbody>
          <tr v-for="event in selectedError.events.items" :key="event.id"><td>{{ formatTime(event.timestamp) }}</td><td>{{ event.pageUrl || "-" }}</td><td>{{ event.userId || "-" }}</td><td>{{ event.release || "-" }}</td><td><code>{{ JSON.stringify(event.raw) }}</code></td></tr>
        </tbody></table></div>
      </aside>
    </template>
    <p v-else class="state">暂无可用的监控数据</p>
    <p v-if="refreshingEvents" class="refresh-note">正在更新事件列表...</p>
  </main>
</template>
