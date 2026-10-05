import {
    record,
    type eventWithTime,
    type recordOptions,
} from "rrweb";
import { dispatchReport } from "../report.js";

export interface ReplaySession {
    id: string;
    startTime: number;
    startedAt: number;
}

export interface ReplayEventReportData {
    type: "replay";
    subType: "event";
    replayId: string;
    event: eventWithTime;
    startTime: number;
    replayOffset: number;
    isCheckout?: boolean;
}

export type ReplayReportHandler = (reportData: ReplayEventReportData) => void;
export type ReplayReportData = ReplayEventReportData;

export interface ReplayMonitoringOptions {
    /** 接收录屏事件，不影响 SDK 自身上报。 */
    onReport?: ReplayReportHandler;
    /** 是否脱敏全部输入框，默认开启。 */
    maskAllInputs?: boolean;
    /** 需要屏蔽的元素 class，默认是 `monitor-block`。 */
    blockClass?: string;
    /** 需要屏蔽的元素选择器，默认匹配 `data-monitor-mask`。 */
    blockSelector?: string;
}

export interface ReplayErrorContext {
    replayId: string;
    replayOffset: number;
}

let session: ReplaySession | undefined;
let stopRecording: (() => void) | undefined;
let reportHandler: ReplayReportHandler | undefined;

function getNow(): number {
    if (
        typeof window !== "undefined" &&
        typeof window.performance?.now === "function"
    ) {
        return window.performance.now();
    }
    return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function createReplayId(): string {
    return `replay-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 启动当前页面的 rrweb 录制。重复调用只更新回调和配置，不会重复录制。
 */
export function observeReplay(
    options: ReplayMonitoringOptions = {},
): void {
    if (typeof window === "undefined") {
        return;
    }

    if (session) {
        reportHandler = options.onReport;
        return;
    }

    const currentSession: ReplaySession = {
        id: createReplayId(),
        startTime: getNow(),
        startedAt: Date.now(),
    };
    session = currentSession;
    reportHandler = options.onReport;

    const recordOptions: recordOptions<eventWithTime> = {
        emit: (event, isCheckout) => {
            dispatchReport(
                {
                    type: "replay",
                    subType: "event",
                    replayId: currentSession.id,
                    event,
                    startTime: event.timestamp,
                    replayOffset: Math.max(
                        0,
                        event.timestamp - currentSession.startedAt,
                    ),
                    ...(isCheckout ? { isCheckout: true } : {}),
                },
                reportHandler,
            );
        },
        maskAllInputs: options.maskAllInputs ?? true,
        blockClass: options.blockClass ?? "monitor-block",
        blockSelector: options.blockSelector ?? "[data-monitor-mask]",
    };

    try {
        stopRecording = record(recordOptions);
    } catch {
        session = undefined;
        reportHandler = undefined;
    }
}

/**
 * 停止录制并释放 rrweb 监听器。
 */
export function stopObserveReplay(): void {
    stopRecording?.();
    stopRecording = undefined;
    session = undefined;
    reportHandler = undefined;
}

/**
 * 返回当前录制会话，调用方只能得到副本。
 */
export function getReplaySession(): ReplaySession | undefined {
    return session ? { ...session } : undefined;
}

/**
 * 获取错误发生时对应的回放会话和相对时间，可供错误报告直接定位。
 */
export function getReplayErrorContext(): ReplayErrorContext | undefined {
    if (!session) {
        return undefined;
    }

    return {
        replayId: session.id,
        replayOffset: Math.max(0, getNow() - session.startTime),
    };
}

/**
 * 根据错误报告中的回放上下文生成可直接打开的回放地址。
 */
export function createReplayUrl(
    baseUrl: string,
    context: ReplayErrorContext,
): string {
    const pageUrl =
        typeof window !== "undefined" ? window.location.href : undefined;
    const url = new URL(baseUrl, pageUrl ?? "http://localhost");
    url.searchParams.set("replayId", context.replayId);
    url.searchParams.set("replayOffset", String(context.replayOffset));
    return url.toString();
}

export default observeReplay;
