<script setup lang="ts">
import { onMounted, ref } from "vue";

const apiUrl = import.meta.env.VITE_SERVER_URL ?? "http://localhost:9800";
const status = ref("检查服务中...");

onMounted(async () => {
  try {
    const response = await fetch(`${apiUrl}/api/v1/health`);
    const body = (await response.json()) as { status?: string };
    status.value = response.ok && body.status === "ok" ? "服务正常" : "服务异常";
  } catch {
    status.value = "无法连接服务";
  }
});
</script>

<template>
  <main>
    <header>
      <p class="eyebrow">Frontend Monitor</p>
      <h1>监控平台</h1>
      <p class="status" :data-state="status === '服务正常' ? 'ok' : 'error'">
        {{ status }}
      </p>
    </header>
    <section aria-labelledby="boundary-title">
      <h2 id="boundary-title">数据服务</h2>
      <dl>
        <div>
          <dt>API 地址</dt>
          <dd>{{ apiUrl }}/api/v1</dd>
        </div>
        <div>
          <dt>应用查询</dt>
          <dd>GET /api/v1/reports</dd>
        </div>
      </dl>
    </section>
  </main>
</template>
