<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import ReplayPlayer from "./ReplayPlayer.vue";
import type { eventWithTime } from "@rrweb/types";

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
type MetricName = "first-paint" | "first-contentful-paint" | "largest-contentful-paint" | "load";
interface PerformanceMetric {
  metric: MetricName;
  sampleCount: number;
  p50: number | null;
  p75: number | null;
  p95: number | null;
  trend: Array<{ bucket: number; sampleCount: number; p50: number | null }>;
  pages: Array<{ pageUrl: string; sampleCount: number; p50: number | null; p75: number | null; p95: number | null }>;
}
interface PerformanceRequest {
  id: number; timestamp: number; pageUrl: string; url: string; method: string;
  status: number; duration: number; success: boolean; subType: "fetch" | "xhr";
}
interface PerformanceResource {
  id: number; timestamp: number; pageUrl: string; url: string; resourceType: string;
  duration: number; transferSize: number; resourceSize: number;
}
interface PerformanceState {
  metrics: PerformanceMetric[];
  requests: { items: PerformanceRequest[]; total: number; page: number; pageSize: number };
  resources: { items: PerformanceResource[]; total: number; page: number; pageSize: number };
}
interface ResolvedFrame {
  functionName?: string;
  fileName?: string;
  lineNumber?: number;
  columnNumber?: number;
  originalFileName?: string;
  originalLineNumber?: number;
  originalColumnNumber?: number;
  sourceContext?: Array<{ lineNumber: number; content: string }>;
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
  rawStack: string;
  stackFrames: ResolvedFrame[];
  resolutionStatus:
    | "resolved"
    | "version_not_found"
    | "file_not_found"
    | "parse_failed"
    | "unmapped";
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
interface ReplaySession {
  appId: string;
  projectName: string;
  replayId: string;
  sessionId: string;
  userId: string;
  pageUrl: string;
  startedAt: number;
  lastSeen: number;
  duration: number;
  eventCount: number;
  errorCount: number;
  status: "ready" | "incomplete" | "unplayable";
}
interface ReplayEvent {
  timestamp: number;
  replayOffset: number;
  event: eventWithTime;
  isCheckout: boolean;
}
interface ReplayResult {
  items: ReplaySession[];
  total: number;
  page: number;
  pageSize: number;
}
interface ReplayDetail {
  session: ReplaySession;
  events: ReplayEvent[];
}
interface SourceMapRecord {
  appId: string;
  release: string;
  generatedFile: string;
}
type SourceMapUploadState = "idle" | "uploading" | "success" | "error";

// Explicit URL wins. Otherwise: dev → localhost server; prod → same-origin.
const configuredServerUrl = import.meta.env.VITE_SERVER_URL as string | undefined;
const apiUrl =
  configuredServerUrl !== undefined && configuredServerUrl !== ""
    ? configuredServerUrl
    : import.meta.env.DEV
      ? "http://localhost:9800"
      : "";
const apps = ref<AppInfo[]>([]);
const selectedAppId = ref("");
const from = ref("");
const to = ref("");
const selectedType = ref("");
const view = ref<"overview" | "performance" | "errors" | "replay" | "sourceMaps">("overview");
const sourceMapRelease = ref("");
const sourceMapGeneratedFile = ref("");
const sourceMaps = ref<SourceMapRecord[]>([]);
const sourceMapFile = ref<File | null>(null);
const sourceMapInput = ref<HTMLInputElement | null>(null);
const sourceMapUploadState = ref<SourceMapUploadState>("idle");
const sourceMapMessage = ref("");
const sourceMapLoading = ref(false);
const sourceMapLoaded = ref(false);
const errorStatus = ref("");
const errorSubType = ref("");
const errorSearch = ref("");
const errorResult = ref<ErrorResult | null>(null);
const selectedError = ref<ErrorDetail | null>(null);
const errorDetailPanel = ref<HTMLElement | null>(null);
const replayResult = ref<ReplayResult | null>(null);
const selectedReplay = ref<ReplayDetail | null>(null);
const selectedReplayId = ref("");
const replayOffset = ref<number>();
const replayFilterId = ref("");
const replayUserId = ref("");
const replayPage = ref(1);
const replayLoading = ref(false);
const errorPage = ref(1);
const errorLoading = ref(false);
const overview = ref<Overview | null>(null);
const performance = ref<PerformanceState | null>(null);
const performanceKeyword = ref("");
const performanceResourceType = ref("");
const performancePageUrl = ref("");
const performanceStatus = ref("");
const performanceSort = ref<"duration" | "status" | "url">("duration");
const performanceOrder = ref<"asc" | "desc">("desc");
const performanceMinDuration = ref("");
const performanceMaxDuration = ref("");
const performancePage = ref(1);
const performanceLoading = ref(false);
const loading = ref(true);
const error = ref("");
const refreshingEvents = ref(false);
const clearingRecords = ref(false);
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

function sourceMapQueryString(): string {
  const params = new URLSearchParams();
  if (selectedAppId.value) params.set("appId", selectedAppId.value);
  if (sourceMapRelease.value.trim()) {
    params.set("release", sourceMapRelease.value.trim());
  }
  return params.toString();
}

function replayQueryString(): string {
  const params = new URLSearchParams();
  if (selectedAppId.value) params.set("appId", selectedAppId.value);
  if (from.value) params.set("from", String(new Date(`${from.value}T00:00:00`).getTime()));
  if (to.value) params.set("to", String(new Date(`${to.value}T23:59:59.999`).getTime()));
  if (replayFilterId.value.trim()) params.set("replayId", replayFilterId.value.trim());
  if (replayUserId.value.trim()) params.set("userId", replayUserId.value.trim());
  params.set("page", String(replayPage.value));
  params.set("pageSize", "20");
  return params.toString();
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function resolutionLabel(status: ErrorIssue["resolutionStatus"]): string {
  return {
    resolved: "已还原",
    version_not_found: "未找到对应版本",
    file_not_found: "未找到对应生成文件",
    parse_failed: "Source Map 解析失败",
    unmapped: "文件存在但位置未映射",
  }[status];
}

function resolutionReason(status: ErrorIssue["resolutionStatus"]): string {
  return {
    resolved: "服务端已按错误事件的应用、发布版本和生成文件完成还原。",
    version_not_found: "这个错误事件的发布版本还没有保存 Source Map。请上传该版本的 map 文件。",
    file_not_found: "该版本已有 Source Map，但没有匹配堆栈中生成文件的文件名。请确认 generated file 填写正确。",
    parse_failed: "匹配的 Source Map 无法解析。请检查文件格式后重新上传，或替换当前文件。",
    unmapped: "Source Map 文件匹配成功，但该行列没有对应的源码映射。请确认构建产物和 map 来自同一版本。",
  }[status];
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

function performanceQueryString(): string {
  const params = new URLSearchParams();
  if (selectedAppId.value) params.set("appId", selectedAppId.value);
  if (from.value) params.set("from", String(new Date(`${from.value}T00:00:00`).getTime()));
  if (to.value) params.set("to", String(new Date(`${to.value}T23:59:59.999`).getTime()));
  if (performancePageUrl.value.trim()) params.set("pageUrl", performancePageUrl.value.trim());
  return params.toString();
}

async function loadPerformance(): Promise<void> {
  performanceLoading.value = true;
  loading.value = true;
  error.value = "";
  const query = performanceQueryString();
  const listQuery = new URLSearchParams(query);
  listQuery.set("keyword", performanceKeyword.value);
  listQuery.set("resourceType", performanceResourceType.value);
  if (performanceStatus.value) listQuery.set("status", performanceStatus.value);
  listQuery.set("sort", performanceSort.value);
  listQuery.set("order", performanceOrder.value);
  if (performanceMinDuration.value) listQuery.set("minDuration", performanceMinDuration.value);
  if (performanceMaxDuration.value) listQuery.set("maxDuration", performanceMaxDuration.value);
  listQuery.set("page", String(performancePage.value));
  listQuery.set("pageSize", "10");
  try {
    const [metricsResponse, requestsResponse, resourcesResponse] = await Promise.all([
      fetch(`${apiUrl}/api/v1/performance/metrics?${query}`),
      fetch(`${apiUrl}/api/v1/performance/requests?${listQuery}`),
      fetch(`${apiUrl}/api/v1/performance/resources?${listQuery}`),
    ]);
    if (!metricsResponse.ok || !requestsResponse.ok || !resourcesResponse.ok) {
      throw new Error("性能数据加载失败");
    }
    performance.value = {
      metrics: ((await metricsResponse.json()) as { metrics: PerformanceMetric[] }).metrics,
      requests: await requestsResponse.json() as PerformanceState["requests"],
      resources: await resourcesResponse.json() as PerformanceState["resources"],
    };
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "性能数据加载失败";
  } finally {
    loading.value = false;
    performanceLoading.value = false;
  }
}

function metricLabel(metric: MetricName): string {
  return { "first-paint": "FP", "first-contentful-paint": "FCP", "largest-contentful-paint": "LCP", load: "Load" }[metric];
}

function duration(value: number | null): string {
  return value === null ? "-" : `${Math.round(value)} ms`;
}

async function loadSourceMaps(): Promise<void> {
  sourceMapLoading.value = true;
  sourceMapMessage.value = "";
  try {
    const response = await fetch(`${apiUrl}/api/v1/source-maps?${sourceMapQueryString()}`);
    if (!response.ok) throw new Error("Source Map 列表加载失败");
    sourceMaps.value = (await response.json()) as SourceMapRecord[];
    sourceMapLoaded.value = true;
  } catch (cause) {
    sourceMapMessage.value = cause instanceof Error ? cause.message : "Source Map 列表加载失败";
    sourceMapLoaded.value = false;
  } finally {
    sourceMapLoading.value = false;
  }
}

async function loadReplayDetail(id: string): Promise<void> {
  selectedReplayId.value = id;
  const response = await fetch(
    `${apiUrl}/api/v1/replays/${encodeURIComponent(id)}?appId=${encodeURIComponent(selectedAppId.value)}`,
  );
  if (!response.ok) {
    selectedReplay.value = null;
    throw new Error("回放会话不可用");
  }
  selectedReplay.value = (await response.json()) as ReplayDetail;
}

async function loadReplays(): Promise<void> {
  replayLoading.value = true;
  error.value = "";
  try {
    const response = await fetch(`${apiUrl}/api/v1/replays?${replayQueryString()}`);
    if (!response.ok) throw new Error("回放列表加载失败");
    replayResult.value = (await response.json()) as ReplayResult;
    const current = replayResult.value.items.find((item) => item.replayId === selectedReplayId.value);
    if (current) await loadReplayDetail(current.replayId);
    else if (replayResult.value.items[0]) await loadReplayDetail(replayResult.value.items[0].replayId);
    else selectedReplay.value = null;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "回放列表加载失败";
  } finally {
    replayLoading.value = false;
    loading.value = false;
  }
}

async function openReplay(
  replayId: string,
  offset?: number,
  filter = false,
): Promise<void> {
  view.value = "replay";
  selectedReplayId.value = replayId;
  if (filter) {
    replayFilterId.value = replayId;
    replayUserId.value = "";
  }
  replayOffset.value = offset;
  try {
    await loadReplays();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "回放会话不可用";
  }
}

function selectSourceMapFile(event: Event): void {
  sourceMapFile.value = (event.target as HTMLInputElement).files?.[0] ?? null;
  sourceMapGeneratedFile.value = sourceMapFile.value?.name.replace(/\.map$/, "") ?? "";
  sourceMapUploadState.value = "idle";
  sourceMapMessage.value = "";
}

async function uploadSourceMap(replace = false): Promise<void> {
  if (!selectedAppId.value || !sourceMapRelease.value.trim() ||
    !sourceMapGeneratedFile.value.trim() || !sourceMapFile.value) {
    sourceMapUploadState.value = "error";
    sourceMapMessage.value = "请选择应用、填写发布版本和对应生成文件，并选择 Source Map 文件。";
    return;
  }
  sourceMapUploadState.value = "uploading";
  sourceMapMessage.value = "";
  const form = new FormData();
  form.set("appId", selectedAppId.value);
  form.set("release", sourceMapRelease.value.trim());
  form.set("generatedFile", sourceMapGeneratedFile.value.trim());
  form.set("sourceMap", sourceMapFile.value);
  if (replace) form.set("replace", "true");
  try {
    const response = await fetch(`${apiUrl}/api/v1/source-maps`, {
      method: "POST",
      body: form,
    });
    const body = (await response.json()) as { message?: string; status?: "created" | "replaced" };
    if (response.status === 409) {
      const confirmed = window.confirm(
        `${sourceMapFile.value.name} 已存在于 ${sourceMapRelease.value.trim()}。确认替换已保存文件吗？`,
      );
      if (confirmed) {
        await uploadSourceMap(true);
        return;
      }
      sourceMapUploadState.value = "idle";
      sourceMapMessage.value = "已取消替换，原文件未变更。";
      return;
    }
    if (!response.ok) {
      throw new Error(body.message ?? "Source Map 上传失败");
    }
    sourceMapUploadState.value = "success";
    sourceMapMessage.value = body.status === "replaced" ? "Source Map 已替换。" : "Source Map 上传成功。";
    await loadSourceMaps();
  } catch (cause) {
    sourceMapUploadState.value = "error";
    sourceMapMessage.value = cause instanceof Error ? cause.message : "Source Map 上传失败";
  }
}

function openSourceMapManager(issue?: ErrorIssue): void {
  view.value = "sourceMaps";
  if (issue?.releases[0]) sourceMapRelease.value = issue.releases[0];
  void loadSourceMaps();
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
  await nextTick();
  errorDetailPanel.value?.scrollIntoView({ behavior: "smooth", block: "start" });
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

async function reloadCurrentView(manual = false): Promise<void> {
  if (view.value === "errors") await loadErrors();
  else if (view.value === "performance") await loadPerformance();
  else if (view.value === "replay") await loadReplays();
  else if (view.value === "sourceMaps") await loadSourceMaps();
  else await loadOverview(manual);
}

async function clearAllRecords(): Promise<void> {
  const confirmed = window.confirm(
    "确认清除所有监控记录吗？这将删除事件、错误、回放和 Source Map，且无法恢复。",
  );
  if (!confirmed) return;
  clearingRecords.value = true;
  error.value = "";
  try {
    const response = await fetch(`${apiUrl}/api/v1/records`, { method: "DELETE" });
    if (!response.ok) throw new Error("清除监控记录失败");
    selectedError.value = null;
    selectedReplay.value = null;
    selectedReplayId.value = "";
    selectedAppId.value = "";
    overview.value = null;
    performance.value = null;
    errorResult.value = null;
    replayResult.value = null;
    sourceMaps.value = [];
    sourceMapLoaded.value = false;
    await loadApps();
    await reloadCurrentView();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "清除监控记录失败";
  } finally {
    clearingRecords.value = false;
  }
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
watch([selectedAppId, from, to, performanceKeyword, performanceResourceType, performancePageUrl,
  performanceStatus, performanceSort, performanceOrder, performanceMinDuration, performanceMaxDuration,
  performancePage], () => {
  if (apps.value.length > 0 && view.value === "performance") void loadPerformance();
});
watch([selectedAppId, from, to, errorStatus, errorSubType, errorSearch, errorPage], () => {
  if (apps.value.length > 0 && view.value === "errors") void loadErrors();
});
watch([selectedAppId, from, to, replayFilterId, replayUserId, replayPage], () => {
  if (apps.value.length > 0 && view.value === "replay") void loadReplays();
});
watch([selectedAppId, sourceMapRelease], () => {
  if (view.value === "sourceMaps" && apps.value.length > 0) void loadSourceMaps();
});

onMounted(() => {
  void initialize();
  refreshTimer = window.setInterval(() => {
    if (view.value === "errors") void loadErrors();
    else if (view.value === "performance") void loadPerformance();
    else if (view.value === "replay") void loadReplays();
    else if (view.value === "sourceMaps") void loadSourceMaps();
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
      <div class="header-actions">
        <button
          class="danger-button"
          type="button"
          :disabled="clearingRecords"
          @click="clearAllRecords"
        >
          {{ clearingRecords ? "清除中..." : "清除所有记录" }}
        </button>
        <button class="refresh-button" type="button" @click="reloadCurrentView(true)">
          <span aria-hidden="true">↻</span> 刷新事件
        </button>
      </div>
    </header>

    <nav class="view-tabs" aria-label="监控模块">
      <button type="button" :class="{ active: view === 'overview' }" @click="view = 'overview'; void loadOverview()">总览</button>
      <button type="button" :class="{ active: view === 'performance' }" @click="view = 'performance'; void loadPerformance()">性能分析</button>
      <button type="button" :class="{ active: view === 'errors' }" @click="view = 'errors'; void loadErrors()">错误事项</button>
      <button type="button" :class="{ active: view === 'replay' }" @click="view = 'replay'; void loadReplays()">会话回放</button>
      <button type="button" :class="{ active: view === 'sourceMaps' }" @click="view = 'sourceMaps'; void loadSourceMaps()">Source Map</button>
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

    <p v-if="loading || errorLoading || performanceLoading || replayLoading" class="state">正在加载监控数据...</p>
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
    <template v-else-if="view === 'performance' && performance">
      <section class="performance-section" aria-labelledby="performance-title">
        <div class="section-heading"><div><p class="eyebrow">Web vitals</p><h2 id="performance-title">页面加载性能</h2></div></div>
        <div class="summary-grid">
          <article v-for="metric in performance.metrics" :key="metric.metric" class="metric">
            <span>{{ metricLabel(metric.metric) }} · {{ metric.sampleCount }} 个样本</span>
            <strong>{{ duration(metric.p50) }}</strong>
            <small>P75 {{ duration(metric.p75) }} · P95 {{ duration(metric.p95) }}</small>
          </article>
        </div>
        <div class="performance-grid">
          <article v-for="metric in performance.metrics" :key="`${metric.metric}-detail`" class="performance-panel">
            <div class="section-heading"><h3>{{ metricLabel(metric.metric) }} 趋势</h3><span>{{ metric.sampleCount }} 个样本</span></div>
            <p v-if="!metric.trend.length" class="state">当前筛选条件下没有数据</p>
            <table v-else><thead><tr><th>时间</th><th>样本</th><th>P50</th></tr></thead>
              <tbody><tr v-for="point in metric.trend" :key="point.bucket"><td>{{ formatTime(point.bucket) }}</td><td>{{ point.sampleCount }}</td><td>{{ duration(point.p50) }}</td></tr></tbody>
            </table>
            <h4>页面排行</h4>
            <p v-if="!metric.pages.length" class="result-count">暂无页面数据</p>
            <ol v-else class="rank-list"><li v-for="page in metric.pages.slice(0, 5)" :key="page.pageUrl"><span :title="page.pageUrl">{{ page.pageUrl }}</span><strong>{{ duration(page.p50) }}</strong></li></ol>
          </article>
        </div>
      </section>
      <section class="performance-section">
        <div class="section-heading"><div><p class="eyebrow">Network</p><h2>慢请求与慢资源</h2></div></div>
        <div class="filters performance-filters">
          <label>页面 URL <input v-model="performancePageUrl" type="search" placeholder="精确匹配页面"></label>
          <label>URL 关键词 <input v-model="performanceKeyword" type="search" placeholder="筛选请求或资源"></label>
          <label>请求状态 <input v-model="performanceStatus" inputmode="numeric" placeholder="例如 500"></label>
          <label>资源类型 <input v-model="performanceResourceType" placeholder="例如 script"></label>
          <label>最短耗时 <input v-model="performanceMinDuration" type="number" min="0" placeholder="毫秒"></label>
          <label>最长耗时 <input v-model="performanceMaxDuration" type="number" min="0" placeholder="毫秒"></label>
          <label>排序
            <select v-model="performanceSort">
              <option value="duration">按耗时</option><option value="status">按状态</option><option value="url">按 URL</option>
            </select>
          </label>
          <label>顺序
            <select v-model="performanceOrder"><option value="desc">降序</option><option value="asc">升序</option></select>
          </label>
        </div>
        <div class="performance-grid">
          <article class="performance-panel"><h3>Fetch / XHR <span class="result-count">{{ performance.requests.total }} 条</span></h3>
            <p v-if="!performance.requests.items.length" class="state">当前筛选条件下没有请求</p>
            <div v-else class="table-wrap"><table><thead><tr><th>URL</th><th>状态</th><th>耗时</th></tr></thead><tbody><tr v-for="request in performance.requests.items" :key="request.id"><td class="truncate" :title="request.url">{{ request.url }}</td><td>{{ request.status }}</td><td>{{ duration(request.duration) }}</td></tr></tbody></table></div>
          </article>
          <article class="performance-panel"><h3>资源 <span class="result-count">{{ performance.resources.total }} 条</span></h3>
            <p v-if="!performance.resources.items.length" class="state">当前筛选条件下没有资源</p>
            <div v-else class="table-wrap"><table><thead><tr><th>URL</th><th>类型</th><th>耗时</th></tr></thead><tbody><tr v-for="resource in performance.resources.items" :key="resource.id"><td class="truncate" :title="resource.url">{{ resource.url }}</td><td>{{ resource.resourceType }}</td><td>{{ duration(resource.duration) }}</td></tr></tbody></table></div>
          </article>
        </div>
        <div v-if="performance.requests.total > performance.requests.pageSize || performance.resources.total > performance.resources.pageSize" class="pagination">
          <button type="button" :disabled="performancePage <= 1" @click="performancePage--">上一页</button>
          <span>第 {{ performancePage }} 页</span>
          <button type="button" :disabled="performancePage * Math.max(performance.requests.pageSize, performance.resources.pageSize) >= Math.max(performance.requests.total, performance.resources.total)" @click="performancePage++">下一页</button>
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
      <aside v-if="selectedError" ref="errorDetailPanel" class="detail-panel" aria-label="错误详情">
        <div class="section-heading"><div><p class="eyebrow">Issue detail</p><h2>{{ selectedError.issue.message || "(无消息)" }}</h2></div><button class="close-button" type="button" aria-label="关闭详情" title="关闭详情" @click="selectedError = null">×</button></div>
        <div class="detail-actions">
          <button type="button" :class="{ selected: selectedError.issue.status === 'unresolved' }" @click="setErrorStatus('unresolved')">未解决</button>
          <button type="button" :class="{ selected: selectedError.issue.status === 'resolved' }" @click="setErrorStatus('resolved')">已解决</button>
          <button type="button" :class="{ selected: selectedError.issue.status === 'ignored' }" @click="setErrorStatus('ignored')">已忽略</button>
        </div>
        <p class="detail-meta">{{ selectedError.issue.subType }} · {{ selectedError.issue.count }} 次 · {{ selectedError.issue.userCount }} 位用户 · {{ formatTime(selectedError.issue.firstSeen) }} 至 {{ formatTime(selectedError.issue.lastSeen) }}</p>
        <section class="resolution-panel" :class="{ 'resolution-success': selectedError.issue.resolutionStatus === 'resolved' }">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Source Map resolution</p>
              <h3>{{ resolutionLabel(selectedError.issue.resolutionStatus) }}</h3>
            </div>
            <button v-if="selectedError.issue.resolutionStatus !== 'resolved'" type="button" class="text-button" @click="openSourceMapManager(selectedError.issue)">
              管理该版本 Source Map
            </button>
          </div>
          <p class="resolution-reason">{{ resolutionReason(selectedError.issue.resolutionStatus) }}</p>
          <div v-if="selectedError.issue.stackFrames.length" class="frame-list">
            <article v-for="(frame, index) in selectedError.issue.stackFrames" :key="`${index}-${String(frame.fileName)}`" class="frame">
              <strong>{{ frame.functionName || "(匿名函数)" }}</strong>
              <code>{{ frame.originalFileName || frame.fileName }}:{{ frame.originalLineNumber || frame.lineNumber }}:{{ frame.originalColumnNumber || frame.columnNumber }}</code>
              <small v-if="frame.originalFileName">生成文件：{{ frame.fileName }}:{{ frame.lineNumber }}:{{ frame.columnNumber }}</small>
              <pre v-if="frame.sourceContext?.length" class="source-context"><span v-for="line in frame.sourceContext" :key="line.lineNumber" :class="{ 'source-context-line': line.lineNumber === frame.originalLineNumber }">{{ line.lineNumber }} | {{ line.content }}
</span></pre>
            </article>
          </div>
        </section>
        <details class="raw-stack">
          <summary>查看原始堆栈</summary>
          <pre class="stack">{{ selectedError.issue.rawStack || selectedError.issue.stack || "无有效堆栈" }}</pre>
        </details>
        <h3>发生记录</h3>
        <div class="table-wrap"><table><thead><tr><th>时间</th><th>页面</th><th>用户</th><th>版本</th><th>原始上报</th></tr></thead><tbody>
          <tr v-for="event in selectedError.events.items" :key="event.id"><td>{{ formatTime(event.timestamp) }}</td><td>{{ event.pageUrl || "-" }}</td><td>{{ event.userId || "-" }}</td><td>{{ event.release || "-" }}</td><td><button v-if="typeof event.data.replayId === 'string'" class="text-button" type="button" @click="openReplay(event.data.replayId, typeof event.data.replayOffset === 'number' ? event.data.replayOffset : undefined, true)">跳到回放</button><code>{{ JSON.stringify(event.raw) }}</code></td></tr>
        </tbody></table></div>
      </aside>
    </template>
    <template v-else-if="view === 'replay' && replayResult">
      <section class="replay-section" aria-labelledby="replay-title">
        <div class="section-heading">
          <div><p class="eyebrow">Session replay</p><h2 id="replay-title">会话回放</h2></div>
          <span class="result-count">{{ replayResult.total }} 个会话</span>
        </div>
        <div class="filters replay-filters" aria-label="回放筛选">
          <label>回放 ID <input v-model="replayFilterId" type="search" placeholder="精确匹配回放 ID"></label>
          <label>用户 ID <input v-model="replayUserId" type="search" placeholder="精确匹配用户"></label>
        </div>
        <div v-if="replayResult.items.length === 0" class="state">当前筛选条件下没有可用回放</div>
        <div v-else class="replay-layout">
          <aside class="replay-sessions" aria-label="回放会话列表">
            <button v-for="session in replayResult.items" :key="session.replayId" type="button" class="replay-session" :class="{ active: selectedReplayId === session.replayId }" @click="void openReplay(session.replayId)">
              <strong>{{ session.replayId }}</strong>
              <span>{{ session.eventCount }} 个事件 · {{ duration(session.duration) }}</span>
              <small>{{ session.userId || "匿名用户" }} · {{ session.errorCount }} 个关联错误</small>
              <small v-if="session.status !== 'ready'" class="replay-warning">状态：{{ session.status === "incomplete" ? "数据不完整" : "无法播放" }}</small>
            </button>
          </aside>
          <section v-if="selectedReplay" class="replay-stage">
            <div class="section-heading">
              <div><p class="eyebrow">Playback</p><h3>{{ selectedReplay.session.replayId }}</h3></div>
              <span>{{ selectedReplay.session.eventCount }} 个事件 · {{ selectedReplay.session.userId || "匿名用户" }}</span>
            </div>
            <p v-if="selectedReplay.session.status !== 'ready'" class="state state-error">{{ selectedReplay.session.status === "incomplete" ? "该会话缺少完整快照，播放器无法可靠播放。" : "该会话事件数据损坏，无法播放。" }}其他会话查询不受影响。</p>
            <ReplayPlayer v-else :key="`${selectedReplay.session.replayId}-${selectedReplay.events.length}`" :events="selectedReplay.events.map((item) => item.event)" :duration="selectedReplay.session.duration" :initial-offset="replayOffset" />
          </section>
          <section v-else class="replay-stage state-error">当前回放会话缺失或无法加载。</section>
        </div>
        <div v-if="replayResult.total > replayResult.pageSize" class="pagination">
          <button type="button" :disabled="replayPage <= 1" @click="replayPage--">上一页</button>
          <span>第 {{ replayPage }} 页</span>
          <button type="button" :disabled="replayPage * replayResult.pageSize >= replayResult.total" @click="replayPage++">下一页</button>
        </div>
      </section>
    </template>
    <template v-else-if="view === 'sourceMaps'">
      <section class="source-map-section" aria-labelledby="source-maps-title">
        <div class="section-heading">
          <div><p class="eyebrow">Release artifacts</p><h2 id="source-maps-title">Source Map 管理</h2></div>
          <span class="result-count">{{ sourceMaps.length }} 个文件</span>
        </div>
        <div class="source-map-target">
          <p>当前目标</p>
          <strong>{{ selectedApp?.projectName || "未选择应用" }}</strong>
          <code>{{ selectedAppId || "请先选择应用" }}</code>
        </div>
        <form class="source-map-upload" @submit.prevent="uploadSourceMap()">
          <label>发布版本
            <input v-model="sourceMapRelease" required placeholder="例如 web@1.4.0">
          </label>
          <label>Source Map 文件
            <input ref="sourceMapInput" type="file" accept=".map,application/json" required @change="selectSourceMapFile">
          </label>
          <label>对应生成文件
            <input v-model="sourceMapGeneratedFile" required placeholder="例如 assets/app.js">
          </label>
          <div v-if="sourceMapFile" class="file-summary">
            <strong>{{ sourceMapFile.name }}</strong><span>{{ formatFileSize(sourceMapFile.size) }}</span>
          </div>
          <button class="primary-button" type="submit" :disabled="sourceMapUploadState === 'uploading'">
            {{ sourceMapUploadState === "uploading" ? "上传中..." : "上传 Source Map" }}
          </button>
        </form>
        <p v-if="sourceMapMessage" :class="['source-map-message', `message-${sourceMapUploadState}`]" role="status">{{ sourceMapMessage }}</p>
        <p v-if="sourceMapLoading" class="state">正在加载已保存的 Source Map...</p>
        <p v-else-if="sourceMapLoaded && sourceMaps.length === 0" class="state">该应用版本还没有保存 Source Map。上传与生成文件同名的 map 后，错误详情会自动使用它。</p>
        <div v-else-if="sourceMaps.length" class="table-wrap">
          <table class="source-map-table"><thead><tr><th>应用</th><th>发布版本</th><th>生成文件</th></tr></thead><tbody>
            <tr v-for="map in sourceMaps" :key="`${map.appId}-${map.release}-${map.generatedFile}`">
              <td>{{ map.appId }}</td><td>{{ map.release }}</td><td><code>{{ map.generatedFile }}</code></td>
            </tr>
          </tbody></table>
        </div>
      </section>
    </template>
    <p v-else class="state">暂无可用的监控数据</p>
    <p v-if="refreshingEvents" class="refresh-note">正在更新事件列表...</p>
  </main>
</template>
