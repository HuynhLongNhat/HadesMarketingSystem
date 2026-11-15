import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { aiAgents, aiTasks, businessProfiles, ceoPlans, db, organization, pool, user } from "@workspace/db/node";
import { CeoPlanningService } from "./ceo-planning.service.js";
import { CeoPlanningContextBuilder } from "./ceo-planning-context.builder.js";

const organizationId = randomUUID();
const userId = randomUUID();
const otherOrganizationId = randomUUID();
const context = { organizationId, userId, role: "owner" } as never;

async function seedTask(status: "queued" | "failed" | "completed" = "failed", result: string | null = null) {
  const id = randomUUID();
  await db.insert(aiTasks).values({ id, organizationId, createdBy: userId, title: "Kế hoạch CEO: fixture", description: "fixture", status, result, completedAt: status === "queued" ? null : new Date() });
  return id;
}

function structuredPlan() {
  return {
    version: "v3.1", objective: "Tăng trưởng có kiểm soát", businessAnalysis: ["Có dữ liệu nền tảng."], strategy: ["Thử nghiệm nhỏ."], assumptions: [], risks: [],
    phases: [{ name: "Khởi động", milestone: "Chốt mục tiêu", timeframe: "Tuần 1" }],
    resourceAllocation: { summary: "Cần xác nhận nguồn lực.", humanHoursAssumption: null, aiSupportNotes: [] },
    tasks: [{ id: "TASK-01", title: "Phân tích", description: "Phân tích hiện trạng.", deliverable: "Bản tóm tắt", acceptanceCriteria: "Có phát hiện rõ ràng.", priority: "high", estimatedHours: 2, dependencies: [], responsibleType: "HUMAN", agentRef: null }],
    agentRecommendations: [], kpis: [{ metric: "Lead", target: "Mục tiêu cần xác nhận", deadline: "30 ngày", measurementMethod: "Đối chiếu CRM", relatedObjective: "Tăng trưởng" }], feasibilityWarnings: [],
  };
}

async function seedAgent() {
  const id = randomUUID();
  await db.insert(aiAgents).values({ id, organizationId, name: "CEO fixture", role: "CEO", status: "active", systemPrompt: "fixture" });
  return id;
}

before(async () => {
  const identity = await pool.query<{ environment: string }>("select environment from public.environment_identity where id=1");
  if (identity.rows[0]?.environment !== "development") throw new Error("CEO planning integration tests require development database");
  await db.insert(organization).values([{ id: organizationId, name: "CEO plan fixture", slug: `ceo-plan-${organizationId}` }, { id: otherOrganizationId, name: "Other CEO plan fixture", slug: `other-ceo-plan-${otherOrganizationId}` }]);
  await db.insert(user).values({ id: userId, name: "CEO plan fixture", email: `ceo-plan-${userId}@example.invalid` });
});

after(async () => {
  await db.delete(organization).where(eq(organization.id, organizationId));
  await db.delete(organization).where(eq(organization.id, otherOrganizationId));
  await db.delete(user).where(eq(user.id, userId));
  await pool.end();
});

test("CEO retry is atomic, bounded, and retains the failed plan", async () => {
  const taskId = await seedTask();
  const agentId = await seedAgent();
  const planId = randomUUID();
  const snapshot = { profile: { businessName: "Snapshot công ty", marketingBudgetVnd: 0 }, missingFields: ["Thị trường"] };
  const generationSettings = { preset: "deep", maxOutputTokens: 7000, timeoutSeconds: 170, reasoningEffort: null, temperature: null };
  await db.insert(ceoPlans).values({ id: planId, organizationId, createdBy: userId, ceoAgentId: agentId, taskId, title: "fixture", objective: "objective", additionalContext: "Chỉ dùng website", businessProfileSnapshot: snapshot, businessProfileSnapshotAt: new Date(), contextVersion: "business-profile-v1", generationSettings });
  let createOptions: { enqueue?: boolean; webResearchEnabled?: boolean } | undefined;
  const tasks = { create: async (_ctx: unknown, _dto: unknown, options: { enqueue?: boolean; webResearchEnabled?: boolean }) => { createOptions = options; return { id: await seedTask("queued"), connectionId: "connection-fixture", modelId: "model-fixture" }; }, enqueue: async () => undefined, discardUnqueued: async () => undefined };
  const contexts = { formatForPrompt: () => "fixture" };
  const service = new CeoPlanningService(tasks as never, contexts as never);
  const [first, second] = await Promise.allSettled([service.retry(context, planId), service.retry(context, planId)]);
  assert.equal([first, second].filter((result) => result.status === "fulfilled").length, 1);
  const [original] = await db.select().from(ceoPlans).where(and(eq(ceoPlans.id, planId), eq(ceoPlans.organizationId, organizationId)));
  assert.ok(original?.retryPlanId);
  assert.equal(original?.retryCount, 0);
  const [retry] = await db.select().from(ceoPlans).where(eq(ceoPlans.id, original!.retryPlanId!));
  assert.equal(retry?.retryOfPlanId, planId);
  assert.equal(retry?.retryCount, 1);
  assert.deepEqual(retry?.businessProfileSnapshot, snapshot);
  assert.equal(retry?.additionalContext, "Chỉ dùng website");
  assert.deepEqual(retry?.generationSettings, generationSettings);
  assert.deepEqual(retry?.executionSource, { version: "v1", type: "api_provider", organizationId, requestedByUserId: userId, providerConnectionId: "connection-fixture", modelId: "model-fixture" });
  assert.deepEqual(createOptions, { enqueue: false, webResearchEnabled: false });
});

test("Business Profile context is organization-scoped and stays immutable after profile updates", async () => {
  await db.insert(businessProfiles).values({ organizationId, businessName: "Hồ sơ A", marketingBudgetVnd: 0, budgetPeriodDays: 30, availableTools: [], availableChannels: [] });
  await db.insert(businessProfiles).values({ organizationId: otherOrganizationId, businessName: "Hồ sơ B", marketingBudgetVnd: 999, budgetPeriodDays: 30, availableTools: [], availableChannels: [] });
  const builder = new CeoPlanningContextBuilder();
  const planningContext = await builder.build(context, "Tăng trưởng", "Không thay đổi hồ sơ");
  assert.equal(planningContext.businessProfile.profile?.businessName, "Hồ sơ A");
  assert.equal(planningContext.businessProfile.profile?.marketingBudgetVnd, 0);
  await db.update(businessProfiles).set({ businessName: "Hồ sơ A mới", marketingBudgetVnd: 100 }).where(eq(businessProfiles.organizationId, organizationId));
  assert.equal(planningContext.businessProfile.profile?.businessName, "Hồ sơ A");
  assert.equal(planningContext.businessProfile.profile?.marketingBudgetVnd, 0);
  assert.equal(planningContext.additionalContext, "Không thay đổi hồ sơ");
});

test("CEO delete is organization-scoped, soft, and rejects a running task", async () => {
  const taskId = await seedTask("queued");
  const agentId = await seedAgent();
  const planId = randomUUID();
  await db.insert(ceoPlans).values({ id: planId, organizationId, createdBy: userId, ceoAgentId: agentId, taskId, title: "delete fixture", objective: "objective" });
  const service = new CeoPlanningService({} as never, {} as never);
  await assert.rejects(() => service.remove({ organizationId: otherOrganizationId, userId, role: "owner" } as never, planId), /Không tìm thấy/);
  await assert.rejects(() => service.remove(context, planId), /đang được CEO xử lý/);
  await db.update(aiTasks).set({ status: "failed", completedAt: new Date() }).where(eq(aiTasks.id, taskId));
  await service.remove(context, planId);
  await assert.rejects(() => service.get(context, planId), /Không tìm thấy/);
  const [deleted] = await db.select().from(ceoPlans).where(eq(ceoPlans.id, planId));
  assert.ok(deleted?.deletedAt);
});

test("CEO approval accepts a completed valid V3.1 plan and legacy Markdown, but rejects invalid JSON", async () => {
  const service = new CeoPlanningService({} as never, {} as never);
  const agentId = await seedAgent();
  const valid = structuredPlan();
  const structuredTaskId = await seedTask("completed", JSON.stringify(valid));
  const structuredPlanId = randomUUID();
  await db.insert(ceoPlans).values({ id: structuredPlanId, organizationId, createdBy: userId, ceoAgentId: agentId, taskId: structuredTaskId, title: "structured", objective: "objective", structuredPlan: valid, structuredPlanVersion: "v3.1" });
  const approvedStructured = await service.decide(context, structuredPlanId, { decision: "approved" });
  assert.equal(approvedStructured.approvalStatus, "approved");

  const markdown = "# Mục tiêu\nTăng trưởng.\n## Phân tích và bối cảnh\nBối cảnh.\n## Giả định và rủi ro\nRủi ro.\n## Chiến lược đề xuất\nChiến lược.\n## Công việc đề xuất\n| Công việc | Owner |\n| --- | --- |\n| Phân tích | CEO |\n## Nhân viên AI phù hợp và lý do\nCEO phù hợp.\n## Chỉ số theo dõi\nLead.";
  const markdownTaskId = await seedTask("completed", markdown);
  const markdownPlanId = randomUUID();
  await db.insert(ceoPlans).values({ id: markdownPlanId, organizationId, createdBy: userId, ceoAgentId: agentId, taskId: markdownTaskId, title: "markdown", objective: "objective" });
  const approvedMarkdown = await service.decide(context, markdownPlanId, { decision: "approved" });
  assert.equal(approvedMarkdown.approvalStatus, "approved");

  const invalid = structuredPlan();
  delete (invalid.kpis[0] as Record<string, unknown>).measurementMethod;
  const invalidTaskId = await seedTask("completed", JSON.stringify(invalid));
  const invalidPlanId = randomUUID();
  await db.insert(ceoPlans).values({ id: invalidPlanId, organizationId, createdBy: userId, ceoAgentId: agentId, taskId: invalidTaskId, title: "invalid", objective: "objective" });
  await assert.rejects(() => service.decide(context, invalidPlanId, { decision: "approved" }), /JSON kế hoạch không hợp lệ/);
});
