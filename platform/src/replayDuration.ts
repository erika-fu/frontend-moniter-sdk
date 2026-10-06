export function formatReplayDuration(milliseconds: number): string {
  const duration = Number.isFinite(milliseconds)
    ? Math.max(0, Math.round(milliseconds))
    : 0;
  if (duration < 1000) return `${duration} ms`;

  const seconds = duration / 1000;
  if (seconds < 60) return `${seconds.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")} s`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}m ${String(remainingSeconds).padStart(2, "0")}s`;
}
