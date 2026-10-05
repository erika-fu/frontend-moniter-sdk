<script setup lang="ts">
import { ref } from "vue";
import {
    clearSourceMap,
    loadSourceMap,
    sourceMapError,
    sourceMapFileName,
} from "../sourceMapStore";

const fileInput = ref<HTMLInputElement>();

async function handleFileChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
        await loadSourceMap(file);
    }
}

function resetSourceMap(): void {
    clearSourceMap();
    if (fileInput.value) {
        fileInput.value.value = "";
    }
}
</script>

<template>
    <section class="source-map-tool" aria-label="SourceMap 解析">
        <div>
            <p class="section-kicker">SOURCE MAP</p>
            <strong>本地源码定位</strong>
            <span v-if="sourceMapFileName" class="source-map-status">
                已加载 {{ sourceMapFileName }}
            </span>
            <span v-else class="source-map-status">
                上传构建产物对应的 .map 文件
            </span>
            <span v-if="sourceMapError" class="source-map-error">
                {{ sourceMapError }}
            </span>
        </div>
        <div class="source-map-actions">
            <label class="file-button">
                <span>选择 .map 文件</span>
                <input
                    ref="fileInput"
                    type="file"
                    accept=".map,application/json"
                    @change="handleFileChange"
                />
            </label>
            <button
                v-if="sourceMapFileName"
                class="clear-button"
                type="button"
                @click="resetSourceMap"
            >
                清除
            </button>
        </div>
    </section>
</template>
