<script setup lang="ts">
import { computed } from "vue";
import type { SDKReportData } from "../../../src/index.js";
import { resolveStack, type ResolvedStackFrame } from "../sourceMapStore";

const props = defineProps<{ report: SDKReportData }>();

const frames = computed(() => {
    if (!("stack" in props.report) || !props.report.stack) {
        return [];
    }
    return resolveStack(props.report.stack);
});

function getSnippet(frame: ResolvedStackFrame): string {
    if (!frame.sourceContent || !frame.originalLineNumber) {
        return "";
    }

    const lines = frame.sourceContent.split("\n");
    const lineIndex = frame.originalLineNumber - 1;
    const start = Math.max(0, lineIndex - 2);
    const end = Math.min(lines.length, lineIndex + 3);

    return lines
        .slice(start, end)
        .map((line, index) => {
            const lineNumber = start + index + 1;
            return `${lineNumber === frame.originalLineNumber ? ">" : " "} ${String(
                lineNumber,
            ).padStart(4, " ")} | ${line}`;
        })
        .join("\n");
}
</script>

<template>
    <section v-if="frames.length > 0" class="source-panel">
        <div class="source-panel-heading">
            <strong>错误源码定位</strong>
            <span>{{ frames.length }} 个调用帧</span>
        </div>
        <div
            v-for="(frame, index) in frames"
            :key="`${frame.raw}-${index}`"
            class="source-frame"
        >
            <div class="source-frame-location">
                <strong>{{ frame.functionName ?? "(anonymous)" }}</strong>
                <code>
                    {{
                        frame.originalFileName
                            ? `${frame.originalFileName}:${frame.originalLineNumber ?? "-"}:${frame.originalColumnNumber ?? "-"}`
                            : `${frame.fileName}:${frame.lineNumber}:${frame.columnNumber}`
                    }}
                </code>
            </div>
            <span v-if="frame.originalName" class="source-frame-name">
                {{ frame.originalName }}
            </span>
            <pre v-if="getSnippet(frame)">{{ getSnippet(frame) }}</pre>
            <span v-else class="source-frame-hint">
                {{
                    frame.originalFileName
                        ? "SourceMap 未内嵌源码内容"
                        : "上传匹配的 SourceMap 后显示源码位置"
                }}
            </span>
        </div>
    </section>
</template>
