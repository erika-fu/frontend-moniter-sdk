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
}
interface Overview {
  summary: { total: number; byType: Array<{ type: string; count: number }> };
  events: { items: EventItem[]; total: number; page: number; pageSize: number };
}

const apiUrl = import.meta.env.VITE_SERVER_URL ?? "http://localhost:9800";
const apps = ref<AppInfo[]>([]);
const selectedAppId = ref("");
const from = ref("");
const to = ref("");
const selectedType = ref("");
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
  if (apps.value.length > 0) void loadOverview();
});

onMounted(() => {
  void initialize();
  refreshTimer = window.setInterval(() => void loadOverview(), 30_000);
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
      <button class="refresh-button" type="button" @click="loadOverview(true)">
        <span aria-hidden="true">↻</span> 刷新事件
      </button>
    </header>

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

    <p v-if="loading" class="state">正在加载监控数据...</p>
    <p v-else-if="error" class="state state-error" role="alert">{{ error }}</p>
    <template v-else-if="overview">
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
    <p v-else class="state">暂无可用的监控数据</p>
    <p v-if="refreshingEvents" class="refresh-note">正在更新事件列表...</p>
  </main>
</template>
