import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, marketIntelligenceJobSteps, marketIntelligenceProjects } from "@workspace/db/node";

export const MARKET_INTELLIGENCE_STEPS = [
  { key: "preparing", title: "Chuẩn bị nhiệm vụ", weight: 10 },
  { key: "building_queries", title: "Tạo truy vấn nghiên cứu", weight: 10 },
  { key: "searching_sources", title: "Tìm kiếm nguồn", weight: 25 },
  { key: "collecting_evidence", title: "Thu thập bằng chứng", weight: 25 },
  { key: "analyzing_evidence", title: "Phân tích dữ liệu", weight: 20 },
  { key: "saving_report", title: "Tạo và lưu báo cáo", weight: 10 },
] as const;

export type MarketIntelligenceStepStatus = typeof MARKET_INTELLIGENCE_STEPS[number]["key"];

/** Pure, deterministic calculation used by the database updater and regression tests. */
export function calculateMarketIntelligenceProgress(steps: Array<{ status: string; weight: number }>) {
  const totalWeight = steps.reduce((sum, step) => sum + step.weight, 0);
  const completed = steps.filter((step) => step.status === "completed" || step.status === "skipped");
  return {
    completedSteps: completed.length,
    // A non-terminal project must never advertise a report that has not been persisted.
    progressPercent: totalWeight ? Math.min(99, Math.floor((completed.reduce((sum, step) => sum + step.weight, 0) / totalWeight) * 100)) : 0,
  };
}

export async function createMarketIntelligenceSteps(input: { projectId: string; organizationId: string; agentName: string | null }) {
  await db.insert(marketIntelligenceJobSteps).values(MARKET_INTELLIGENCE_STEPS.map((step, index) => ({
    id: randomUUID(), organizationId: input.organizationId, projectId: input.projectId, stepKey: step.key, title: step.title, weight: step.weight, sequence: index + 1, agentName: input.agentName,
  })));
  await db.update(marketIntelligenceProjects).set({ totalSteps: MARKET_INTELLIGENCE_STEPS.length, completedSteps: 0, progressPercent: 0, updatedAt: new Date() }).where(and(eq(marketIntelligenceProjects.id, input.projectId), eq(marketIntelligenceProjects.organizationId, input.organizationId)));
}

export async function updateMarketIntelligenceStep(input: { projectId: string; organizationId: string; stepKey: MarketIntelligenceStepStatus; status: "running" | "completed" | "failed" | "skipped"; resultCount?: number | null; safeError?: string | null }) {
  const now = new Date();
  const terminal = input.status === "completed" || input.status === "failed" || input.status === "skipped";
  await db.update(marketIntelligenceJobSteps).set({ status: input.status, startedAt: input.status === "running" ? now : undefined, completedAt: terminal ? now : undefined, resultCount: input.resultCount, safeError: input.safeError, updatedAt: now }).where(and(eq(marketIntelligenceJobSteps.projectId, input.projectId), eq(marketIntelligenceJobSteps.organizationId, input.organizationId), eq(marketIntelligenceJobSteps.stepKey, input.stepKey)));
  const steps = await db.select({ status: marketIntelligenceJobSteps.status, weight: marketIntelligenceJobSteps.weight }).from(marketIntelligenceJobSteps).where(and(eq(marketIntelligenceJobSteps.projectId, input.projectId), eq(marketIntelligenceJobSteps.organizationId, input.organizationId)));
  const progress = calculateMarketIntelligenceProgress(steps);
  await db.update(marketIntelligenceProjects).set({ ...progress, currentStep: input.stepKey, lastHeartbeatAt: now, updatedAt: now }).where(and(eq(marketIntelligenceProjects.id, input.projectId), eq(marketIntelligenceProjects.organizationId, input.organizationId), inArray(marketIntelligenceProjects.status, ["queued", "running"])));
}

export async function startMarketIntelligenceRun(input: { projectId: string; organizationId: string; attemptCount: number; maxAttempts: number; executionTimeoutAt: Date }) {
  const now = new Date();
  await db.update(marketIntelligenceProjects).set({ status: "running", startedAt: now, lastHeartbeatAt: now, attemptCount: input.attemptCount, maxAttempts: input.maxAttempts, executionTimeoutAt: input.executionTimeoutAt, lastError: null, updatedAt: now }).where(and(eq(marketIntelligenceProjects.id, input.projectId), eq(marketIntelligenceProjects.organizationId, input.organizationId)));
  await updateMarketIntelligenceStep({ projectId: input.projectId, organizationId: input.organizationId, stepKey: "preparing", status: "completed" });
  await updateMarketIntelligenceStep({ projectId: input.projectId, organizationId: input.organizationId, stepKey: "building_queries", status: "running" });
}

export async function completeMarketIntelligenceRun(input: { projectId: string; organizationId: string }) {
  const now = new Date();
  const steps = await db.select({ id: marketIntelligenceJobSteps.id }).from(marketIntelligenceJobSteps).where(and(eq(marketIntelligenceJobSteps.projectId, input.projectId), eq(marketIntelligenceJobSteps.organizationId, input.organizationId)));
  await db.update(marketIntelligenceJobSteps).set({ status: "completed", completedAt: now, updatedAt: now }).where(and(eq(marketIntelligenceJobSteps.projectId, input.projectId), eq(marketIntelligenceJobSteps.organizationId, input.organizationId), eq(marketIntelligenceJobSteps.stepKey, "saving_report")));
  await db.update(marketIntelligenceProjects).set({ status: "completed", progressPercent: 100, completedSteps: steps.length, currentStep: "saving_report", completedAt: now, lastHeartbeatAt: now, lastError: null, updatedAt: now }).where(and(eq(marketIntelligenceProjects.id, input.projectId), eq(marketIntelligenceProjects.organizationId, input.organizationId)));
}

export async function failMarketIntelligenceRun(input: { projectId: string; organizationId: string; stepKey?: MarketIntelligenceStepStatus; error: string; terminal: boolean }) {
  const now = new Date();
  // A retryable provider fault is not a failed workflow step. Its persisted
  // error explains the pause while the next BullMQ attempt keeps the step open.
  if (input.stepKey && input.terminal) await updateMarketIntelligenceStep({ projectId: input.projectId, organizationId: input.organizationId, stepKey: input.stepKey, status: "failed", safeError: input.error });
  await db.update(marketIntelligenceProjects).set({ status: input.terminal ? "failed" : "running", lastError: input.error, lastHeartbeatAt: now, updatedAt: now, completedAt: input.terminal ? now : undefined }).where(and(eq(marketIntelligenceProjects.id, input.projectId), eq(marketIntelligenceProjects.organizationId, input.organizationId)));
}
