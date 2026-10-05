import type { ReplayEventReportData } from "frontend-moniter-sdk";

export interface ReplayTimeline {
    id: string;
    events: ReplayEventReportData["event"][];
    firstTimestamp: number;
    lastTimestamp: number;
    firstReplayOffset: number;
}

/**
 * 将同一录制会话的公开 SDK 报告整理成播放器使用的时间轴。
 */
export function createReplayTimeline(
    reports: ReplayEventReportData[],
): ReplayTimeline {
    const firstReport = reports[0];
    if (!firstReport) {
        throw new Error("A replay timeline requires at least one report");
    }

    const timeline: ReplayTimeline = {
        id: firstReport.replayId,
        events: [],
        firstTimestamp: firstReport.startTime,
        lastTimestamp: firstReport.startTime,
        firstReplayOffset: firstReport.replayOffset,
    };

    for (const report of reports) {
        timeline.events.push(report.event);
        timeline.firstTimestamp = Math.min(
            timeline.firstTimestamp,
            report.startTime,
        );
        timeline.lastTimestamp = Math.max(
            timeline.lastTimestamp,
            report.startTime,
        );
        timeline.firstReplayOffset = Math.min(
            timeline.firstReplayOffset,
            report.replayOffset,
        );
    }

    timeline.events.sort((a, b) => a.timestamp - b.timestamp);
    return timeline;
}

/**
 * 把错误报告中的 SDK 相对时间转换为播放器相对第一条事件的偏移。
 */
export function getPlaybackOffset(
    timeline: ReplayTimeline,
    replayOffset: number | undefined,
): number | undefined {
    if (
        replayOffset === undefined ||
        !Number.isFinite(replayOffset) ||
        replayOffset <= timeline.firstReplayOffset
    ) {
        return undefined;
    }

    return replayOffset - timeline.firstReplayOffset;
}
