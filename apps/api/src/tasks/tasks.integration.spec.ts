import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { aiAgents, aiProviderConnections, aiTasks, db, departmentTaskRuns, departmentTaskSteps, departments, organization, pool, user } from "@workspace/db/node";
import { departmentWorkflowWaitingToken } from "../departments/department-workflow-state.js";
import { AiUsageQuotaService } from "../conversations/ai-usage-quota.service.js";
import { AiUsageRecorder } from "../conversations/ai-usage-recorder.js";
import { TaskAiExecutionService } from "./task-ai-execution.service.js";
import { TasksService } from "./tasks.service.js";

const organizationId = randomUUID();
const userId = randomUUID();
const otherOrganizationId = randomUUID();
const otherUserId = randomUUID();
const createdTaskIds: string[] = [];

async function createTask(status: "queued" | "running" = "queued") {
  const id = randomUUID();
  createdTaskIds.push(id);
  await db.insert(aiTasks).values({
    id, organizationId, createdBy: userId, title: "integration task",
    description: "test", status,
    leaseExpiresAt: status === "running" ? new Date(Date.now() - 1_000) : new Date(Date.now() + 60_000),
    executionToken: status === "running" ? "expired-token" : null,
  });
  return id;
}

function executor(request: () => Promise<{ text: string; usage: Record<string, never> }>) {
  const service = new TaskAiExecutionService(
    { record: async () => true } as unknown as AiUsageRecorder,
    { reserve: async () => ({ limited: false, reservationId: null }) } as unknown as AiUsageQuotaService,
  );
  Reflect.set(service, "runtime", async () => ({ provider: "test", protocol: "openai", endpoint: "https://example.invalid", apiKey: "test", modelId: "test" }));
  Reflect.set(service, "request", request);
  return service;
}

before(async () => {
  const identity = await pool.query<{ environment: string }>("select environment from public.environment_identity where id=1");
  if (identity.rows[0]?.environment !== "development") throw new Error("Task integration tests require development database");
  await db.insert(organization).values({ id: organizationId, name: "Task integration fixture", slug: `task-it-${organizationId}` });
  await db.insert(user).values({ id: userId, name: "Task integration fixture", email: `task-it-${userId}@example.invalid` });
  await db.insert(organization).values({ id: otherOrganizationId, name: "Other task integration fixture", slug: `other-task-it-${otherOrganizationId}` });
  await db.insert(user).values({ id: otherUserId, name: "Other task integration fixture", email: `other-task-it-${otherUserId}@example.invalid` });
});

after(async () => {
  // department_task_steps intentionally restricts task deletion, so remove
  // workflow runs first; the run cascade removes only this fixture's steps.
  await db.delete(departmentTaskRuns).where(eq(departmentTaskRuns.organizationId, organizationId));
  // The organization cascade then removes only this test's tasks/events.
  await db.delete(organization).where(eq(organization.id, organizationId));
  await db.delete(organization).where(eq(organization.id, otherOrganizationId));
  await db.delete(user).where(eq(user.id, userId));
  await db.delete(user).where(eq(user.id, otherUserId));
  await pool.end();
});

describe("AI task database integration", { concurrency: false }, () => {
  it("atomically allows only one concurrent worker claim", async () => {
    const taskId = await createTask();
    let requests = 0;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const service = executor(async () => { requests += 1; await pending; return { text: "report", usage: {} }; });
    let firstError: unknown;
    const first = service.execute({ taskId, organizationId, createdAt: new Date().toISOString() }, 1, false).catch((error) => { firstError = error; throw error; });
    for (let wait = 0; requests === 0 && !firstError && wait < 200; wait++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(firstError, undefined, `first Worker failed before provider request: ${firstError instanceof Error ? firstError.message : String(firstError)}`);
    assert.equal(requests, 1, "first Worker did not reach the provider request");
    const second = service.execute({ taskId, organizationId, createdAt: new Date().toISOString() }, 1, false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(requests, 1);
    release();
    await Promise.all([first, second]);
    const [task] = await db.select().from(aiTasks).where(and(eq(aiTasks.id, taskId), eq(aiTasks.organizationId, organizationId)));
    assert.equal(task?.status, "completed");
    assert.equal(task?.attemptCount, 1);
  });

  it("preserves cancellation when provider response arrives after it", async () => {
    const taskId = await createTask();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const service = executor(async () => { await pending; return { text: "late report", usage: {} }; });
    let executionError: unknown;
    const run = service.execute({ taskId, organizationId, createdAt: new Date().toISOString() }, 1, false).catch((error) => { executionError = error; throw error; });
    for (let wait = 0; wait < 200; wait++) {
      const [task] = await db.select().from(aiTasks).where(eq(aiTasks.id, taskId));
      if (task?.status === "running") break;
      if (executionError) assert.fail(`Worker failed before cancellation: ${executionError instanceof Error ? executionError.message : String(executionError)}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const tasks = new TasksService({} as never);
    await tasks.cancel({ organizationId, userId, role: "owner" } as never, taskId);
    release();
    await run;
    const [task] = await db.select().from(aiTasks).where(eq(aiTasks.id, taskId));
    assert.equal(task?.status, "cancelled");
    assert.equal(task?.result, null);
  });

  it("renews a matching worker lease and recovers an expired lease", async () => {
    const taskId = await createTask("running");
    const service = executor(async () => ({ text: "unused", usage: {} }));
    await (Reflect.get(service, "renewLease") as (id: string, org: string, token: string) => Promise<unknown>)(taskId, organizationId, "expired-token");
    const [renewed] = await db.select().from(aiTasks).where(eq(aiTasks.id, taskId));
    assert.ok((renewed?.leaseExpiresAt?.getTime() ?? 0) > Date.now());
    await db.update(aiTasks).set({ leaseExpiresAt: new Date(Date.now() - 1_000) }).where(eq(aiTasks.id, taskId));
    const queued: Array<{ taskId: string; recovery?: boolean }> = [];
    const tasks = new TasksService({ enqueueAiTask: async (input: { taskId: string; recovery?: boolean }) => { queued.push(input); return { jobId: "test" }; } } as never);
    await tasks.list({ organizationId, userId, role: "owner" } as never);
    const [recovered] = await db.select().from(aiTasks).where(eq(aiTasks.id, taskId));
    assert.equal(recovered?.status, "queued");
    assert.equal(recovered?.executionToken, null);
    assert.deepEqual(queued, [{ taskId, organizationId, recovery: true }]);
  });

  it("does not recover or enqueue Department steps that are waiting for a predecessor", async () => {
    const departmentId = randomUUID(), runId = randomUUID();
    const firstTaskId = await createTask();
    const heldTaskId = await createTask();
    await db.insert(departments).values({ id: departmentId, organizationId, name: "Workflow fixture", slug: `workflow-${departmentId}` });
    await db.insert(departmentTaskRuns).values({ id: runId, organizationId, departmentId, createdBy: userId, title: "fixture", input: "fixture" });
    await db.insert(departmentTaskSteps).values([
      { id: randomUUID(), organizationId, runId, sequence: 1, taskId: firstTaskId, role: "Manager", input: "fixture" },
      { id: randomUUID(), organizationId, runId, sequence: 2, taskId: heldTaskId, role: "Research", input: "fixture" },
    ]);
    await db.update(aiTasks).set({ executionToken: departmentWorkflowWaitingToken(runId, 2), leaseExpiresAt: new Date(Date.now() - 1_000) }).where(eq(aiTasks.id, heldTaskId));
    const queued: Array<{ taskId: string; recovery?: boolean }> = [];
    const tasks = new TasksService({ enqueueAiTask: async (input: { taskId: string; recovery?: boolean }) => { queued.push(input); return { jobId: "test" }; } } as never);
    await tasks.list({ organizationId, userId, role: "owner" } as never);
    const [held] = await db.select().from(aiTasks).where(eq(aiTasks.id, heldTaskId));
    assert.equal(held?.status, "queued");
    assert.equal(held?.executionToken, departmentWorkflowWaitingToken(runId, 2));
    assert.deepEqual(queued, []);
  });

  it("rejects non-active and cross-organization agents", async () => {
    const inactiveId = randomUUID(), invalidId = randomUUID(), foreignId = randomUUID();
    await db.insert(aiAgents).values([
      { id: inactiveId, organizationId, name: "Inactive", role: "Research", status: "paused", systemPrompt: "Do not run" },
      { id: invalidId, organizationId, name: "Invalid", role: "Research", status: "active", systemPrompt: "Do not run" },
      { id: foreignId, organizationId: otherOrganizationId, name: "Foreign", role: "Research", status: "active", systemPrompt: "Do not run" },
    ]);
    const tasks = new TasksService({ enqueueAiTask: async () => ({ jobId: "test" }) } as never);
    const context = { organizationId, userId, role: "owner" } as never;
    await assert.rejects(() => tasks.create(context, { title: "t", description: "d", agentId: inactiveId }), /not active/);
    await assert.rejects(() => tasks.create(context, { title: "t", description: "d", agentId: invalidId }), /own provider connection and model/);
    await assert.rejects(() => tasks.create(context, { title: "t", description: "d", agentId: foreignId }), /does not belong/);
  });

  it("snapshots an active Agent configuration and uses that snapshot in the worker prompt", async () => {
    const connectionId = randomUUID(), agentId = randomUUID();
    await db.insert(aiProviderConnections).values({ id: connectionId, organizationId, provider: "openai", name: `task-it-${connectionId}`, encryptedApiKey: "unused", keyIv: "unused", keyAuthTag: "unused", enabled: true });
    await db.insert(aiAgents).values({ id: agentId, organizationId, name: "Research Agent", role: "Market Analyst", status: "active", systemPrompt: "Ưu tiên phân khúc B2B.", connectionId, modelId: "agent-model" });
    const queued: string[] = [];
    const tasks = new TasksService({ enqueueAiTask: async (input: { taskId: string }) => { queued.push(input.taskId); return { jobId: "test" }; } } as never);
    const created = await tasks.create({ organizationId, userId, role: "owner" } as never, { title: "Agent task", description: "Nghiên cứu SaaS", agentId });
    await db.update(aiAgents).set({ name: "Changed", role: "Changed", systemPrompt: "Changed", modelId: "changed-model" }).where(eq(aiAgents.id, agentId));
    const [snapshot] = await db.select().from(aiTasks).where(eq(aiTasks.id, created.id));
    assert.deepEqual(queued, [created.id]);
    assert.equal(snapshot?.agentName, "Research Agent");
    assert.equal(snapshot?.agentSystemPrompt, "Ưu tiên phân khúc B2B.");
    assert.equal(snapshot?.connectionId, connectionId);
    assert.equal(snapshot?.modelId, "agent-model");
    const service = executor(async () => ({ text: "report", usage: {} }));
    const prompt = (Reflect.get(service, "prompt") as (task: NonNullable<typeof snapshot>) => string)(snapshot!);
    assert.match(prompt, /Research Agent/);
    assert.match(prompt, /Ưu tiên phân khúc B2B/);
  });
});
