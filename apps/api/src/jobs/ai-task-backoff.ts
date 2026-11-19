export function aiTaskBackoff(attemptsMade: number, error?: unknown, jitter = Math.random()) {
  const seconds = error && typeof error === "object" && "retryAfterSeconds" in error ? error.retryAfterSeconds : null;
  const retryAfter = typeof seconds === "number" ? Math.max(0, seconds * 1000) : 0;
  return Math.max(120_000 * 2 ** Math.min(Math.max(0, attemptsMade - 1), 2), retryAfter) + Math.floor(Math.max(0, Math.min(1, jitter)) * 15_000);
}
