export function aiTaskBackoff(attemptsMade: number, error?: { retryAfterSeconds?: number | null }, jitter = Math.random()) {
  const retryAfter = typeof error?.retryAfterSeconds === "number" ? Math.max(0, error.retryAfterSeconds * 1000) : 0;
  return Math.max(120_000 * 2 ** Math.min(Math.max(0, attemptsMade - 1), 2), retryAfter) + Math.floor(Math.max(0, Math.min(1, jitter)) * 15_000);
}
