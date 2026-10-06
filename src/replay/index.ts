import {
    record,
    type eventWithTime,
    type recordOptions,
} from "rrweb";
import { dispatchReportBatch } from "../report.js";

const DEFAULT_MAX_REPLAY_EVENTS = 1000;
const DEFAULT_PRE_ERROR_DURATION = 30_000;
const DEFAULT_POST_ERROR_DURATION = 2000;
const MAX_REPLAY_BYTES = 5 * 1024 * 1024;
const FULL_SNAPSHOT_EVENT_TYPE = 2;

export interface ReplaySession {
    /** 当前可独立播放片段的兼容 id，等同于 replayId。 */
    id: string;
    replayId: string;
    /** 页面本次录制生命周期的稳定会话 id。 */
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
    /** 兼容旧配置：回放缓冲最多保留的 rrweb 事件数，默认 100。 */
    bufferSize?: number;
    /** 错误前按事件时间保留的毫秒数，默认 30000。 */
    preErrorDuration?: number;
    /** 回放片段最多保留的事件数，默认 1000；提供 bufferSize 时兼容其值。 */
    maxReplayEvents?: number;
    /** 回放片段最多保留的 JSON 字节数，默认 5 MiB。 */
    maxReplayBytes?: number;
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
let activeSessionId: string | undefined;
let stopRecording: (() => void) | undefined;
let reportHandler: ReplayReportHandler | undefined;
let buffer: BufferedReplayEvent[] = [];
let postErrorBuffer: BufferedReplayEvent[] = [];
let maxReplayEvents = DEFAULT_MAX_REPLAY_EVENTS;
let maxReplayBytes = MAX_REPLAY_BYTES;
let preErrorDuration = DEFAULT_PRE_ERROR_DURATION;
let bufferBytes = 0;
let postErrorBufferBytes = 0;
let snapshot: BufferedReplayEvent | undefined;
let bootstrapEvents: BufferedReplayEvent[] = [];
let frozenPreErrorEvents: BufferedReplayEvent[] | undefined;
let postErrorDuration = DEFAULT_POST_ERROR_DURATION;
let pendingFlushTimer: ReturnType<typeof setTimeout> | undefined;
let pendingFlushSessionId: string | undefined;
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

function createSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeLimit(value: number | undefined, fallback: number): number {
    return Number.isFinite(value)
        ? Math.max(1, Math.floor(value as number))
        : fallback;
}

function normalizeDuration(value: number | undefined, fallback: number): number {
    return Number.isFinite(value)
        ? Math.max(0, Math.floor(value as number))
        : fallback;
}

function eventBytes(event: eventWithTime): number {
    const serialized = JSON.stringify(event);
    if (typeof TextEncoder !== "undefined") {
        return new TextEncoder().encode(serialized).byteLength;
    }
    return serialized.length;
}

function normalizePostErrorDuration(value: number | undefined): number {
    return normalizeDuration(value, DEFAULT_POST_ERROR_DURATION);
}

function clearPendingFlush(): void {
    if (pendingFlushTimer !== undefined) {
        clearTimeout(pendingFlushTimer);
        pendingFlushTimer = undefined;
    }
    pendingFlushSessionId = undefined;
}

function schedulePendingFlush(sessionId: string, replayId: string, delay: number): void {
    clearPendingFlush();
    pendingFlushSessionId = sessionId;
    pendingFlushTimer = setTimeout(() => {
        pendingFlushTimer = undefined;
        if (
            !session ||
            session.sessionId !== sessionId ||
            session.replayId !== replayId
        ) {
            pendingFlushSessionId = undefined;
            return;
        }
        if (snapshot) {
            pendingFlushSessionId = undefined;
            flushReplayBuffer(sessionId, replayId);
        }
    }, delay);
}

function resetReplayBuffer(): void {
    buffer = [];
    postErrorBuffer = [];
    bufferBytes = 0;
    postErrorBufferBytes = 0;
    snapshot = undefined;
    bootstrapEvents = [];
    frozenPreErrorEvents = undefined;
}

function clearReplayEvents(): void {
    buffer = [];
    bufferBytes = 0;
}

function clearPostErrorEvents(): void {
    postErrorBuffer = [];
    postErrorBufferBytes = 0;
}

function trimBuffer(values: BufferedReplayEvent[], byteCount: number): number {
    while (
        values.length > maxReplayEvents ||
        byteCount > maxReplayBytes
    ) {
        const removed = values.shift();
        if (!removed) break;
        byteCount -= eventBytes(removed.event);
    }
    return byteCount;
}

function addToRingBuffer(value: BufferedReplayEvent): void {
    buffer.push(value);
    const oldestTimestamp = value.event.timestamp - preErrorDuration;
    buffer = buffer.filter((bufferedEvent) =>
        bufferedEvent.event.timestamp >= oldestTimestamp,
    );
    bufferBytes = buffer.reduce(
        (total, bufferedEvent) => total + eventBytes(bufferedEvent.event),
        0,
    );
    bufferBytes = trimBuffer(buffer, bufferBytes);
}

function addToPostErrorBuffer(value: BufferedReplayEvent): void {
    postErrorBuffer.push(value);
    postErrorBufferBytes = trimBuffer(
        postErrorBuffer,
        postErrorBufferBytes + eventBytes(value.event),
    );
}

function getBufferedEvents(): BufferedReplayEvent[] {
    const events: BufferedReplayEvent[] = [...bootstrapEvents];
    if (snapshot) events.push(snapshot);
    events.push(...(frozenPreErrorEvents ?? buffer));
    events.push(...postErrorBuffer);
    const seen = new Set<eventWithTime>();
    return events
        .filter((bufferedEvent) => {
            if (seen.has(bufferedEvent.event)) return false;
            seen.add(bufferedEvent.event);
            return true;
        })
        .sort((left, right) => left.event.timestamp - right.event.timestamp);
}

function getErrorTimestamp(
    currentSession: ReplaySession,
    errorContext: ReplayErrorContext,
): number {
    // rrweb timestamps are wall-clock timestamps; use the latest observed event
    // when available so sparse event streams do not lose their final pre-error event.
    return buffer.at(-1)?.event.timestamp ??
        currentSession.startedAt + errorContext.replayOffset;
}

function createReplayReport(
    currentSession: ReplaySession,
    bufferedEvent: BufferedReplayEvent,
): ReplayEventReportData {
    return {
        type: "replay",
        subType: "event",
        replayId: currentSession.replayId,
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
    const replayId = createReplayId();
    const currentSession: ReplaySession = {
        id: replayId,
        replayId,
        sessionId: activeSessionId ?? createSessionId(),
        startTime: getNow(),
        startedAt: Date.now(),
    };
    activeSessionId = currentSession.sessionId;
    session = currentSession;
    resetReplayBuffer();

    const recordOptions: recordOptions<eventWithTime> = {
        emit: (event, isCheckout) => {
            if (!session || session.replayId !== currentSession.replayId) {
                return;
            }
            const bufferedEvent: BufferedReplayEvent = {
                event,
                ...(isCheckout ? { isCheckout: true } : {}),
            };
            if (event.type === FULL_SNAPSHOT_EVENT_TYPE) {
                snapshot = bufferedEvent;
                clearReplayEvents();
                if (
                    pendingFlushSessionId === currentSession.sessionId &&
                    pendingFlushTimer === undefined
                ) {
                    schedulePendingFlush(currentSession.sessionId, currentSession.replayId, 0);
                }
                return;
            }
            if (!snapshot) {
                bootstrapEvents.push(bufferedEvent);
                return;
            }
            if (frozenPreErrorEvents) {
                addToPostErrorBuffer(bufferedEvent);
            } else {
                addToRingBuffer(bufferedEvent);
            }
        },
        maskAllInputs: replayOptions.maskAllInputs ?? true,
        blockClass: replayOptions.blockClass ?? "monitor-block",
        blockSelector: replayOptions.blockSelector ?? "[data-monitor-mask]",
        sampling: {
            mouseInteraction: true,
            mousemove: false,
        },
    };

    try {
        stopRecording = record(recordOptions);
    } catch {
        clearPendingFlush();
        session = undefined;
        activeSessionId = undefined;
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
        postErrorDuration = normalizePostErrorDuration(options.postErrorDuration);
        return;
    }

    replayOptions = { ...options };
    reportHandler = options.onReport;
    activeSessionId = createSessionId();
    maxReplayEvents = normalizeLimit(
        options.maxReplayEvents ?? options.bufferSize,
        DEFAULT_MAX_REPLAY_EVENTS,
    );
    maxReplayBytes = normalizeLimit(options.maxReplayBytes, MAX_REPLAY_BYTES);
    preErrorDuration = normalizeDuration(
        options.preErrorDuration,
        DEFAULT_PRE_ERROR_DURATION,
    );
    postErrorDuration = normalizePostErrorDuration(options.postErrorDuration);
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
    activeSessionId = undefined;
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
        replayId: session.replayId,
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
function flushReplayBuffer(sessionId: string, replayId: string): void {
    if (
        !session ||
        session.sessionId !== sessionId ||
        session.replayId !== replayId
    ) {
        return;
    }

    const finishedSession = session;
    clearPendingFlush();
    const events = getBufferedEvents();
    const uniqueEvents = events.filter((bufferedEvent, index) =>
        events.findIndex((candidate) => candidate.event === bufferedEvent.event) === index,
    );
    dispatchReportBatch(
        uniqueEvents.map((bufferedEvent) =>
            createReplayReport(finishedSession, bufferedEvent),
        ),
        reportHandler,
    );

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

    if (
        errorContext.replayId !== session.replayId ||
        (errorContext.sessionId && errorContext.sessionId !== session.sessionId)
    ) {
        return;
    }

    const sessionId = session.sessionId;
    if (!frozenPreErrorEvents) {
        const errorTimestamp = getErrorTimestamp(session, errorContext);
        frozenPreErrorEvents = buffer.filter((bufferedEvent) =>
            bufferedEvent.event.timestamp >= errorTimestamp - preErrorDuration &&
            bufferedEvent.event.timestamp <= errorTimestamp,
        );
        clearReplayEvents();
        clearPostErrorEvents();
    }
    if (postErrorDuration === 0 && snapshot) {
        flushReplayBuffer(sessionId, session.replayId);
        return;
    }
    schedulePendingFlush(sessionId, session.replayId, postErrorDuration);
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
