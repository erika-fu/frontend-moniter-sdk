import {
    record,
    type eventWithTime,
    type recordOptions,
} from "rrweb";
import { dispatchReport, flushReportQueue } from "../report.js";

const DEFAULT_BUFFER_SIZE = 100;
const DEFAULT_POST_ERROR_DURATION = 2000;
const FULL_SNAPSHOT_EVENT_TYPE = 2;

export interface ReplaySession {
    id: string;
    sessionId: string;
    startTime: number;
    startedAt: number;
}

export interface ReplayEventReportData {
    type: "replay";
    subType: "event";
    replayId: string;
    sessionId?: string;
    event: eventWithTime;
    startTime: number;
    replayOffset: number;
    isCheckout?: boolean;
}

export type ReplayReportHandler = (reportData: ReplayEventReportData) => void;
export type ReplayReportData = ReplayEventReportData;

export interface ReplayMonitoringOptions {
    /** 异常发生时接收缓存的录屏事件，不影响 SDK 自身上报。 */
    onReport?: ReplayReportHandler;
    /** 环形缓存最多保留的 rrweb 事件数，默认 100。 */
    bufferSize?: number;
    /** 异常后继续录制的毫秒数，默认 2000；设为 0 时立即上报。 */
    postErrorDuration?: number;
    /** 是否脱敏全部输入框，默认开启。 */
    maskAllInputs?: boolean;
    /** 需要屏蔽的元素 class，默认是 `monitor-block`。 */
    blockClass?: string;
    /** 需要屏蔽的元素选择器，默认匹配 `data-monitor-mask`。 */
    blockSelector?: string;
}

export interface ReplayErrorContext {
    replayId: string;
    sessionId?: string;
    replayOffset: number;
}

interface BufferedReplayEvent {
    event: eventWithTime;
    isCheckout?: boolean;
}

let session: ReplaySession | undefined;
let stopRecording: (() => void) | undefined;
let reportHandler: ReplayReportHandler | undefined;
let buffer: Array<BufferedReplayEvent | undefined> = [];
let bufferSize = DEFAULT_BUFFER_SIZE;
let bufferStart = 0;
let bufferLength = 0;
let snapshot: BufferedReplayEvent | undefined;
let bootstrapEvents: BufferedReplayEvent[] = [];
let postErrorDuration = DEFAULT_POST_ERROR_DURATION;
let pendingFlushTimer: ReturnType<typeof setTimeout> | undefined;
let replayOptions: ReplayMonitoringOptions = {};

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

function normalizeBufferSize(value: number | undefined): number {
    return Number.isFinite(value)
        ? Math.max(1, Math.floor(value as number))
        : DEFAULT_BUFFER_SIZE;
}

function normalizePostErrorDuration(value: number | undefined): number {
    return Number.isFinite(value)
        ? Math.max(0, Math.floor(value as number))
        : DEFAULT_POST_ERROR_DURATION;
}

function clearPendingFlush(): void {
    if (pendingFlushTimer !== undefined) {
        clearTimeout(pendingFlushTimer);
        pendingFlushTimer = undefined;
    }
}

function resetReplayBuffer(): void {
    buffer = [];
    bufferStart = 0;
    bufferLength = 0;
    snapshot = undefined;
    bootstrapEvents = [];
}

function clearReplayEvents(): void {
    buffer = [];
    bufferStart = 0;
    bufferLength = 0;
}

function addToRingBuffer(value: BufferedReplayEvent): void {
    if (bufferSize <= 0) {
        return;
    }

    if (buffer.length !== bufferSize) {
        buffer = Array.from({ length: bufferSize });
    }

    const index = (bufferStart + bufferLength) % bufferSize;
    buffer[index] = value;
    if (bufferLength < bufferSize) {
        bufferLength += 1;
    } else {
        bufferStart = (bufferStart + 1) % bufferSize;
    }
}

function getBufferedEvents(): BufferedReplayEvent[] {
    const events: BufferedReplayEvent[] = [...bootstrapEvents];
    if (snapshot) {
        events.push(snapshot);
    }
    for (let index = 0; index < bufferLength; index += 1) {
        const event = buffer[(bufferStart + index) % bufferSize];
        if (event) {
            events.push(event);
        }
    }
    return events;
}

function createReplayReport(
    currentSession: ReplaySession,
    bufferedEvent: BufferedReplayEvent,
): ReplayEventReportData {
    return {
        type: "replay",
        subType: "event",
        replayId: currentSession.id,
        sessionId: currentSession.sessionId,
        event: bufferedEvent.event,
        startTime: bufferedEvent.event.timestamp,
        replayOffset: Math.max(
            0,
            bufferedEvent.event.timestamp - currentSession.startedAt,
        ),
        ...(bufferedEvent.isCheckout ? { isCheckout: true } : {}),
    };
}

function startReplaySession(): void {
    const currentSession: ReplaySession = {
        id: createReplayId(),
        sessionId: "",
        startTime: getNow(),
        startedAt: Date.now(),
    };
    currentSession.sessionId = currentSession.id;
    session = currentSession;
    resetReplayBuffer();

    const recordOptions: recordOptions<eventWithTime> = {
        emit: (event, isCheckout) => {
            const bufferedEvent: BufferedReplayEvent = {
                event,
                ...(isCheckout ? { isCheckout: true } : {}),
            };
            if (event.type === FULL_SNAPSHOT_EVENT_TYPE) {
                snapshot = bufferedEvent;
                clearReplayEvents();
                return;
            }
            if (!snapshot) {
                bootstrapEvents.push(bufferedEvent);
                return;
            }
            addToRingBuffer(bufferedEvent);
        },
        maskAllInputs: replayOptions.maskAllInputs ?? true,
        blockClass: replayOptions.blockClass ?? "monitor-block",
        blockSelector: replayOptions.blockSelector ?? "[data-monitor-mask]",
    };

    try {
        stopRecording = record(recordOptions);
    } catch {
        clearPendingFlush();
        session = undefined;
        reportHandler = undefined;
        resetReplayBuffer();
    }
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
        replayOptions = { ...replayOptions, ...options };
        reportHandler = options.onReport;
        postErrorDuration = normalizePostErrorDuration(
            options.postErrorDuration,
        );
        return;
    }

    replayOptions = { ...options };
    reportHandler = options.onReport;
    bufferSize = normalizeBufferSize(options.bufferSize);
    postErrorDuration = normalizePostErrorDuration(
        options.postErrorDuration,
    );
    startReplaySession();
}

/**
 * 停止录制并释放 rrweb 监听器。
 */
export function stopObserveReplay(): void {
    clearPendingFlush();
    stopRecording?.();
    stopRecording = undefined;
    session = undefined;
    reportHandler = undefined;
    replayOptions = {};
    resetReplayBuffer();
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
        sessionId: session.sessionId,
        replayOffset: Math.max(0, getNow() - session.startTime),
    };
}

/**
 * 异常发生时发送环形缓存中的回放事件，并把缓存清空。
 *
 * 错误报告应先取得上下文，再调用本函数，这样错误和回放事件会拥有
 * 同一个 sessionId 与 replayOffset。
 */
function flushReplayBuffer(sessionId: string): void {
    if (!session || session.sessionId !== sessionId) {
        return;
    }

    const finishedSession = session;
    const events = getBufferedEvents();
    for (const bufferedEvent of events) {
        dispatchReport(
            createReplayReport(finishedSession, bufferedEvent),
            reportHandler,
        );
    }
    flushReportQueue();

    // 一个错误片段对应一个独立 session，避免后续片段复用旧 snapshot。
    stopRecording?.();
    stopRecording = undefined;
    session = undefined;
    resetReplayBuffer();
    startReplaySession();
}

/**
 * 异常发生后等待尾部窗口结束，再发送包含错误前后上下文的回放事件。
 *
 * 尾部窗口内再次发生异常时会延后同一次冲刷，避免重复上传相同事件；
 * 每条错误报告仍保留各自的 replayOffset。
 */
export function flushReplayOnError(
    errorContext: ReplayErrorContext | undefined = getReplayErrorContext(),
): void {
    if (!session || !errorContext) {
        return;
    }

    const sessionId = session.sessionId;
    clearPendingFlush();
    if (postErrorDuration === 0) {
        flushReplayBuffer(sessionId);
        return;
    }

    pendingFlushTimer = setTimeout(() => {
        pendingFlushTimer = undefined;
        flushReplayBuffer(sessionId);
    }, postErrorDuration);
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
    if (context.sessionId) {
        url.searchParams.set("sessionId", context.sessionId);
    }
    url.searchParams.set("replayOffset", String(context.replayOffset));
    return url.toString();
}

export default observeReplay;
