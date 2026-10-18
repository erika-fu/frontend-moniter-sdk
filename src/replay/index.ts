import {
    record,
    type eventWithTime,
    type recordOptions,
} from "rrweb";
import { dispatchReportBatch } from "../report.js";

const DEFAULT_MAX_REPLAY_EVENTS = 1000;
const DEFAULT_PRE_ERROR_DURATION = 60_000;
const DEFAULT_POST_ERROR_DURATION = 5 * 60 * 1000;
const DEFAULT_POST_ERROR_IDLE_TIMEOUT = 30_000;
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
    /** 错误前按事件时间保留的毫秒数，默认 60000。 */
    preErrorDuration?: number;
    /** 回放片段最多保留的事件数，默认 1000；提供 bufferSize 时兼容其值。 */
    maxReplayEvents?: number;
    /** 回放片段最多保留的 JSON 字节数，默认 5 MiB。 */
    maxReplayBytes?: number;
    /**
     * 异常后最长继续录制的毫秒数，默认 5 分钟。
     * 设为 0 时立即上报当前片段并开始下一段缓冲。
     */
    postErrorDuration?: number;
    /**
     * 异常后无新事件时结束继续录制的空闲毫秒数，默认 30 秒。
     * 仅在 `postErrorDuration > 0` 时生效。
     */
    postErrorIdleTimeout?: number;
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
let pendingTailEvents: BufferedReplayEvent[] = [];
let maxReplayEvents = DEFAULT_MAX_REPLAY_EVENTS;
let maxReplayBytes = MAX_REPLAY_BYTES;
let preErrorDuration = DEFAULT_PRE_ERROR_DURATION;
let bufferBytes = 0;
let snapshot: BufferedReplayEvent | undefined;
let bootstrapEvents: BufferedReplayEvent[] = [];
let frozenPreErrorEvents: BufferedReplayEvent[] | undefined;
let postErrorDuration = DEFAULT_POST_ERROR_DURATION;
let postErrorIdleTimeout = DEFAULT_POST_ERROR_IDLE_TIMEOUT;
let continuationActive = false;
let initialSegmentFlushed = false;
let pendingSnapshotFlush = false;
let immediateRotatePending = false;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let maxTimer: ReturnType<typeof setTimeout> | undefined;
let replayOptions: ReplayMonitoringOptions = {};
let emittedEventCount = 0;
let emittedBytes = 0;

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

function normalizePostErrorIdleTimeout(value: number | undefined): number {
    return normalizeDuration(value, DEFAULT_POST_ERROR_IDLE_TIMEOUT);
}

function clearContinuationTimers(): void {
    if (idleTimer !== undefined) {
        clearTimeout(idleTimer);
        idleTimer = undefined;
    }
    if (maxTimer !== undefined) {
        clearTimeout(maxTimer);
        maxTimer = undefined;
    }
}

function resetReplayBuffer(): void {
    buffer = [];
    pendingTailEvents = [];
    bufferBytes = 0;
    snapshot = undefined;
    bootstrapEvents = [];
    frozenPreErrorEvents = undefined;
    continuationActive = false;
    initialSegmentFlushed = false;
    pendingSnapshotFlush = false;
    immediateRotatePending = false;
    emittedEventCount = 0;
    emittedBytes = 0;
}

function clearReplayEvents(): void {
    buffer = [];
    bufferBytes = 0;
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

function uniqueSortedEvents(
    events: BufferedReplayEvent[],
): BufferedReplayEvent[] {
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

function trackEmitted(events: BufferedReplayEvent[]): void {
    for (const bufferedEvent of events) {
        emittedEventCount += 1;
        emittedBytes += eventBytes(bufferedEvent.event);
    }
}

function dispatchEvents(
    currentSession: ReplaySession,
    events: BufferedReplayEvent[],
): void {
    const uniqueEvents = uniqueSortedEvents(events);
    if (uniqueEvents.length === 0) {
        return;
    }
    trackEmitted(uniqueEvents);
    dispatchReportBatch(
        uniqueEvents.map((bufferedEvent) =>
            createReplayReport(currentSession, bufferedEvent),
        ),
        reportHandler,
    );
}

function hasExceededReplayBudget(): boolean {
    return emittedEventCount >= maxReplayEvents || emittedBytes >= maxReplayBytes;
}

function rotateSession(): void {
    stopRecording?.();
    stopRecording = undefined;
    session = undefined;
    resetReplayBuffer();
    startReplaySession();
}

function endContinuation(sessionId: string, replayId: string): void {
    if (
        !session ||
        session.sessionId !== sessionId ||
        session.replayId !== replayId
    ) {
        return;
    }

    clearContinuationTimers();
    if (pendingTailEvents.length > 0) {
        dispatchEvents(session, pendingTailEvents);
        pendingTailEvents = [];
    }
    rotateSession();
}

function scheduleIdleEnd(sessionId: string, replayId: string): void {
    if (idleTimer !== undefined) {
        clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(() => {
        idleTimer = undefined;
        endContinuation(sessionId, replayId);
    }, postErrorIdleTimeout);
}

function scheduleContinuationTimers(sessionId: string, replayId: string): void {
    clearContinuationTimers();
    maxTimer = setTimeout(() => {
        maxTimer = undefined;
        endContinuation(sessionId, replayId);
    }, postErrorDuration);
    scheduleIdleEnd(sessionId, replayId);
}

function flushInitialSegment(
    sessionId: string,
    replayId: string,
): boolean {
    if (
        !session ||
        !snapshot ||
        initialSegmentFlushed ||
        session.sessionId !== sessionId ||
        session.replayId !== replayId
    ) {
        return false;
    }

    const events: BufferedReplayEvent[] = [...bootstrapEvents, snapshot];
    if (frozenPreErrorEvents) {
        events.push(...frozenPreErrorEvents);
    }
    dispatchEvents(session, events);
    initialSegmentFlushed = true;
    frozenPreErrorEvents = undefined;
    return true;
}

function flushFullSegmentAndRotate(
    sessionId: string,
    replayId: string,
): void {
    if (
        !session ||
        session.sessionId !== sessionId ||
        session.replayId !== replayId
    ) {
        return;
    }

    clearContinuationTimers();
    immediateRotatePending = false;
    const events: BufferedReplayEvent[] = [...bootstrapEvents];
    if (snapshot) events.push(snapshot);
    events.push(...(frozenPreErrorEvents ?? buffer));
    events.push(...pendingTailEvents);
    dispatchEvents(session, events);
    rotateSession();
}

function scheduleImmediateRotate(sessionId: string, replayId: string): void {
    if (immediateRotatePending) {
        return;
    }
    continuationActive = true;
    immediateRotatePending = true;
    maxTimer = setTimeout(() => {
        maxTimer = undefined;
        flushFullSegmentAndRotate(sessionId, replayId);
    }, 0);
}

function beginContinuation(sessionId: string, replayId: string): void {
    continuationActive = true;
    pendingSnapshotFlush = false;
    if (!flushInitialSegment(sessionId, replayId)) {
        pendingSnapshotFlush = true;
        return;
    }
    if (pendingTailEvents.length > 0 && session) {
        const tail = pendingTailEvents;
        pendingTailEvents = [];
        dispatchEvents(session, tail);
    }
    if (hasExceededReplayBudget()) {
        endContinuation(sessionId, replayId);
        return;
    }
    scheduleContinuationTimers(sessionId, replayId);
}

function handleSnapshotReady(
    sessionId: string,
    replayId: string,
): void {
    if (postErrorDuration === 0) {
        pendingSnapshotFlush = false;
        scheduleImmediateRotate(sessionId, replayId);
        return;
    }
    beginContinuation(sessionId, replayId);
}

function emitPostErrorEvent(
    currentSession: ReplaySession,
    bufferedEvent: BufferedReplayEvent,
): void {
    if (postErrorDuration === 0 || immediateRotatePending) {
        pendingTailEvents.push(bufferedEvent);
        return;
    }

    if (!initialSegmentFlushed) {
        if (snapshot) {
            beginContinuation(currentSession.sessionId, currentSession.replayId);
        } else {
            pendingTailEvents.push(bufferedEvent);
            return;
        }
    }

    if (!initialSegmentFlushed || !session) {
        pendingTailEvents.push(bufferedEvent);
        return;
    }

    dispatchEvents(currentSession, [bufferedEvent]);
    if (hasExceededReplayBudget()) {
        endContinuation(currentSession.sessionId, currentSession.replayId);
        return;
    }
    scheduleIdleEnd(currentSession.sessionId, currentSession.replayId);
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
                    pendingSnapshotFlush ||
                    (continuationActive && !initialSegmentFlushed && !immediateRotatePending)
                ) {
                    handleSnapshotReady(
                        currentSession.sessionId,
                        currentSession.replayId,
                    );
                }
                return;
            }
            if (!snapshot) {
                bootstrapEvents.push(bufferedEvent);
                return;
            }
            if (
                continuationActive ||
                frozenPreErrorEvents ||
                immediateRotatePending
            ) {
                emitPostErrorEvent(currentSession, bufferedEvent);
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
        clearContinuationTimers();
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
        postErrorIdleTimeout = normalizePostErrorIdleTimeout(
            options.postErrorIdleTimeout,
        );
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
    postErrorIdleTimeout = normalizePostErrorIdleTimeout(
        options.postErrorIdleTimeout,
    );
    startReplaySession();
}

/**
 * 停止录制并释放 rrweb 监听器。
 */
export function stopObserveReplay(): void {
    clearContinuationTimers();
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
 * 异常发生后立即上报错误前片段，并在同一 replayId 下继续录制，
 * 直到空闲超时、达到最长继续时长，或触达事件/体积上限。
 *
 * 继续录制期间再次异常只会延长空闲窗口；每条错误报告仍保留各自的
 * replayOffset。`postErrorDuration: 0` 保持立即冲刷并轮换片段。
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
    const replayId = session.replayId;

    if (continuationActive || initialSegmentFlushed || immediateRotatePending) {
        if (
            continuationActive &&
            initialSegmentFlushed &&
            postErrorDuration > 0
        ) {
            scheduleIdleEnd(sessionId, replayId);
        }
        return;
    }

    if (!frozenPreErrorEvents) {
        const errorTimestamp = getErrorTimestamp(session, errorContext);
        frozenPreErrorEvents = buffer.filter((bufferedEvent) =>
            bufferedEvent.event.timestamp >= errorTimestamp - preErrorDuration &&
            bufferedEvent.event.timestamp <= errorTimestamp,
        );
        clearReplayEvents();
    }

    if (postErrorDuration === 0) {
        if (snapshot) {
            // 已有 snapshot 时同步冲刷；无 snapshot 时等其到达后再以 0ms 定时器收尾，
            // 以便同一轮同步 emit 的尾段事件仍能并入本片段。
            flushFullSegmentAndRotate(sessionId, replayId);
            return;
        }
        pendingSnapshotFlush = true;
        continuationActive = true;
        return;
    }

    beginContinuation(sessionId, replayId);
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
