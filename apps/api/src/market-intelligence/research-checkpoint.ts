import { createHash } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { aiTasks, db, marketIntelligenceJobSteps } from "@workspace/db/node";
import type { MarketIntelligenceStepStatus } from "./market-intelligence-progress.js";

export const RESEARCH_CHECKPOINT_VERSION = 1;
export function researchInputHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function reusableCheckpoint(step: { status: string; checkpointVersion: number | null; inputHash: string | null; output: Record<string, unknown> | null } | undefined, hash: string) {
  return step?.status === "completed" && step.checkpointVersion === RESEARCH_CHECKPOINT_VERSION && step.inputHash === hash && step.output !== null;
}
export class ResearchLeaseLostError extends Error {}
type Identity = { taskId: string; organizationId: string; projectId: string; executionToken: string };

/** All mutations lock the authoritative task row. A stale worker/cancellation
 * cannot commit output, even when an external request has already completed. */
export async function checkpointMutation<T>(identity: Identity, work: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) {
  return db.transaction(async (tx) => {
    const [owner] = await tx.select({ id: aiTasks.id }).from(aiTasks).where(and(
      eq(aiTasks.id, identity.taskId), eq(aiTasks.organizationId, identity.organizationId),
      eq(aiTasks.status, "running"), eq(aiTasks.executionToken, identity.executionToken), gt(aiTasks.leaseExpiresAt, new Date()),
    )).for("update");
    if (!owner) throw new ResearchLeaseLostError("Research execution no longer owns the task lease");
    return work(tx);
  });
}

export async function researchCheckpoint<T extends Record<string, unknown>>(
  identity: Identity, stepKey: MarketIntelligenceStepStatus, input: unknown,
  validate: (output: Record<string, unknown>) => output is T,
  execute: () => Promise<T>,
): Promise<{ output: T; reused: boolean }> {
  const hash = researchInputHash(input);
  const condition = and(eq(marketIntelligenceJobSteps.projectId, identity.projectId), eq(marketIntelligenceJobSteps.organizationId, identity.organizationId), eq(marketIntelligenceJobSteps.stepKey, stepKey));
  const cached = await checkpointMutation(identity, async (tx) => {
    const [step] = await tx.select().from(marketIntelligenceJobSteps).where(condition);
    if (reusableCheckpoint(step, hash) && step?.output && validate(step.output)) {
      await tx.update(marketIntelligenceJobSteps).set({ reusedCount: sql`${marketIntelligenceJobSteps.reusedCount} + 1`, updatedAt: new Date() }).where(condition);
      return step.output;
    }
    await tx.update(marketIntelligenceJobSteps).set({ status: "running", checkpointVersion: RESEARCH_CHECKPOINT_VERSION, inputHash: hash, output: null, attemptCount: sql`${marketIntelligenceJobSteps.attemptCount} + 1`, startedAt: new Date(), completedAt: null, safeError: null, safeErrorCode: null, updatedAt: new Date() }).where(condition);
    return null;
  });
  if (cached) return { output: cached, reused: true };
  const output = await execute();
  if (!validate(output)) throw new Error("Research checkpoint output validation failed");
  await checkpointMutation(identity, async (tx) => {
    await tx.update(marketIntelligenceJobSteps).set({ status: "completed", output, completedAt: new Date(), updatedAt: new Date() }).where(condition);
  });
  return { output, reused: false };
}
