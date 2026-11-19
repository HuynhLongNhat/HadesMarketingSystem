import "reflect-metadata";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  Module,
  UnauthorizedException,
  ValidationPipe,
  type ExecutionContext,
} from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import type { AddressInfo } from "node:net";
import { eq, sql } from "drizzle-orm";
import {
  aiAgents,
  aiProviderConnections,
  aiTasks,
  assistantConversations,
  assistantTaskLinks,
  db,
  pool,
} from "@workspace/db/node";
import { AssistantTasksController } from "./assistant-tasks.controller.js";
import { AssistantTasksService } from "./assistant-tasks.service.js";
import { AssistantOriginGuard } from "./assistant.controller.js";
import { AssistantService } from "./assistant.service.js";
import { TasksService } from "../tasks/tasks.service.js";
import { AuthGuard } from "../auth/auth.guard.js";
import type {
  AuthenticatedRequest,
  RequestContext,
} from "../auth/request-context.js";
import { PermissionsGuard } from "../common/permissions/permissions.guard.js";

test(
  "Assistant command center: PostgreSQL + HTTP, rollback-only fixtures",
  { timeout: 120_000 },
  async (t) => {
    const identity = await pool.query<{ environment: string }>(
      "select environment from public.environment_identity where id=1",
    );
    assert.equal(
      identity.rows[0]?.environment,
      "development",
      "Refuse non-development database",
    );
    const schema = `assistant_tasks_${randomUUID().replaceAll("-", "")}`;
    const rollback = new Error("rollback command center fixtures");
    const org = randomUUID(),
      orgB = randomUUID(),
      user = randomUUID(),
      userB = randomUUID();
    const ctx: RequestContext = {
      organizationId: org,
      userId: user,
      role: "owner",
      sessionId: "fixture",
    };
    try {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql.raw(
            `CREATE SCHEMA "${schema}"; SET LOCAL search_path TO "${schema}", public; CREATE TABLE organization (id text PRIMARY KEY); CREATE TABLE "user" (id text PRIMARY KEY)`,
          ),
        );
        for (const table of [
          "ai_tasks",
          "ai_task_events",
          "ai_task_research_runs",
          "ai_task_research_sources",
          "ai_task_report_citations",
          "ai_provider_connections",
          "ai_agents",
          "ai_model_defaults",
          "department_task_steps",
        ]) {
          await tx.execute(
            sql.raw(
              `CREATE TABLE "${table}" (LIKE public."${table}" INCLUDING ALL)`,
            ),
          );
        }
        for (const name of [
          "0054_personal_assistant.sql",
          "0055_assistant_task_links.sql",
        ]) {
          const migration = await readFile(
            new URL(`../../../../packages/db/drizzle/${name}`, import.meta.url),
            "utf8",
          );
          await tx.execute(sql.raw(migration));
        }
        await tx.execute(
          sql`insert into organization values (${org}), (${orgB})`,
        );
        await tx.execute(sql`insert into "user" values (${user}), (${userB})`);
        const connectionId = randomUUID(),
          agentId = randomUUID(),
          otherAgent = randomUUID(),
          pausedAgent = randomUUID();
        await tx
          .insert(aiProviderConnections)
          .values({
            id: connectionId,
            organizationId: org,
            name: "fixture",
            provider: "groq",
            encryptedApiKey: "not-a-real-secret",
            keyIv: "fixture",
            keyAuthTag: "fixture",
            enabled: true,
          });
        for (const agent of [
          { id: agentId, organizationId: org, status: "active" as const },
          { id: otherAgent, organizationId: orgB, status: "active" as const },
          { id: pausedAgent, organizationId: org, status: "paused" as const },
        ]) {
          await tx
            .insert(aiAgents)
            .values({
              ...agent,
              name: "Fixture Research Agent",
              role: "research",
              systemPrompt: "Fixture instructions",
              connectionId,
              modelId: "fixture-model",
            });
        }
        const patches = [
          mock.method(db, "select", tx.select.bind(tx)),
          mock.method(db, "insert", tx.insert.bind(tx)),
          mock.method(db, "update", tx.update.bind(tx)),
          mock.method(db, "delete", tx.delete.bind(tx)),
          mock.method(db, "transaction", tx.transaction.bind(tx)),
        ];
        let queued = 0;
        const deliveries: Array<{ taskId: string; organizationId: string }> = [];
        const tasks = new TasksService({
          enqueueAiTask: async (delivery: { taskId: string; organizationId: string }) => {
            queued++;
            deliveries.push(delivery);
          },
        } as never);
        const assistant = new AssistantService(
          {} as never,
          {} as never,
          {} as never,
        );
        const service = new AssistantTasksService(assistant, tasks);
        const conversation = await assistant.create(ctx);
        const auth = mock.method(
          AuthGuard.prototype,
          "canActivate",
          async (context: ExecutionContext) => {
            const req = context
              .switchToHttp()
              .getRequest<AuthenticatedRequest>();
            const actor = req.headers["x-fixture-user"];
            if (!actor) throw new UnauthorizedException();
            req.requestContext =
              actor === "other"
                ? { ...ctx, userId: userB }
                : actor === "tenant"
                  ? { ...ctx, organizationId: orgB }
                  : actor === "member"
                    ? { ...ctx, role: "member" }
                    : ctx;
            return true;
          },
        );
        @Module({
          controllers: [AssistantTasksController],
          providers: [
            { provide: AssistantTasksService, useValue: service },
            AuthGuard,
            AssistantOriginGuard,
            {
              provide: PermissionsGuard,
              useValue: new PermissionsGuard(new Reflector()),
            },
          ],
        })
        class FixtureModule {}
        const app = await NestFactory.create(FixtureModule, { logger: false });
        app.setGlobalPrefix("v1");
        app.useGlobalPipes(
          new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
          }),
        );
        await app.listen(0, "127.0.0.1");
        const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/v1/assistant`;
        const origin = (process.env.WEB_URL ?? "http://localhost:3000")
          .split(",")[0]!
          .trim();
        const request = (
          path: string,
          method = "GET",
          data?: unknown,
          actor = "owner",
          site = origin,
        ) =>
          fetch(`${base}${path}`, {
            method,
            headers: {
              Origin: site,
              "Content-Type": "application/json",
              "x-fixture-user": actor,
            },
            ...(data === undefined ? {} : { body: JSON.stringify(data) }),
            signal: AbortSignal.timeout(15_000),
          });
        const path = `/conversations/${conversation.id}/tasks`;
        const input = {
          requestId: randomUUID(),
          title: "Fixture research",
          description: "Analyze only fixture data",
          agentId,
        };
        let taskId = "";
        try {
          await t.test(
            "Chat conversation creation does not create or enqueue Tasks",
            async () => {
              assert.equal((await tx.select().from(aiTasks)).length, 0);
              assert.equal(queued, 0);
            },
          );
          await t.test(
            "Authentication, permission, origin and DTO rejected before queue",
            async () => {
              assert.equal((await fetch(`${base}/tasks`)).status, 401);
              assert.equal(
                (await request(path, "POST", input, "member")).status,
                403,
              );
              assert.equal(
                (
                  await request(
                    path,
                    "POST",
                    input,
                    "owner",
                    "https://evil.invalid",
                  )
                ).status,
                403,
              );
              assert.equal(
                (
                  await request(path, "POST", {
                    ...input,
                    organizationId: orgB,
                  })
                ).status,
                400,
              );
              assert.equal(queued, 0);
            },
          );
          await t.test(
            "Cross-organization and paused Agent rejected without orphan task/link/job",
            async () => {
              for (const id of [otherAgent, pausedAgent])
                assert.equal(
                  (await request(path, "POST", { ...input, agentId: id }))
                    .status,
                  400,
                );
              assert.equal((await tx.select().from(aiTasks)).length, 0);
              assert.equal(
                (await tx.select().from(assistantTaskLinks)).length,
                0,
              );
              assert.equal(queued, 0);
            },
          );
          await t.test(
            "Creates one linked Task and replay of identical request never enqueues twice",
            async () => {
              const first = await request(path, "POST", input);
              assert.equal(first.status, 201);
              taskId = ((await first.json()) as { taskId: string }).taskId;
              const replay = await request(path, "POST", input);
              assert.equal(replay.status, 201);
              assert.equal(
                ((await replay.json()) as { taskId: string }).taskId,
                taskId,
              );
              assert.equal(queued, 1);
              assert.deepEqual(deliveries, [{ taskId, organizationId: org }]);
              assert.equal((await tx.select().from(aiTasks)).length, 1);
              assert.equal(
                (await tx.select().from(assistantTaskLinks)).length,
                1,
              );
              assert.equal(
                (
                  await request(path, "POST", {
                    ...input,
                    description: "changed",
                  })
                ).status,
                409,
              );
              const [task] = await tx.select().from(aiTasks);
              assert.equal(task?.agentId, agentId);
              assert.equal(task?.status, "queued");
            },
          );
          await t.test(
            "Fresh service instances restore conversation links and safe real Task state",
            async () => {
              const restored = new AssistantTasksService(assistant, tasks);
              assert.equal(
                (await restored.list(ctx, conversation.id))[0]?.id,
                taskId,
              );
              const response = await request(`/tasks/${taskId}`);
              assert.equal(response.status, 200);
              const body = await response.text();
              assert.match(body, /queued/);
              assert.equal(body.includes("executionToken"), false);
              assert.equal(body.includes("Fixture instructions"), false);
            },
          );
          await t.test(
            "User and organization IDOR rejected for list, detail, create and cancel",
            async () => {
              for (const actor of ["other", "tenant"]) {
                assert.deepEqual(
                  await (
                    await request("/tasks", "GET", undefined, actor)
                  ).json(),
                  [],
                );
                assert.equal(
                  (await request(path, "GET", undefined, actor)).status,
                  404,
                );
                assert.equal(
                  (await request(`/tasks/${taskId}`, "GET", undefined, actor))
                    .status,
                  404,
                );
                assert.equal(
                  (await request(`/tasks/${taskId}/cancel`, "POST", {}, actor))
                    .status,
                  404,
                );
                assert.equal(
                  (
                    await request(
                      path,
                      "POST",
                      { ...input, requestId: randomUUID() },
                      actor,
                    )
                  ).status,
                  404,
                );
              }
              assert.equal(queued, 1);
            },
          );
          await t.test(
            "Fixture result/error/events and sources are returned, not fabricated by Assistant",
            async () => {
              await tx
                .update(aiTasks)
                .set({ status: "failed", error: "Fixture quota exceeded" })
                .where(eq(aiTasks.id, taskId));
              assert.equal(
                (await service.get(ctx, taskId)).error,
                "Fixture quota exceeded",
              );
              await tx
                .update(aiTasks)
                .set({
                  status: "completed",
                  error: null,
                  result: "# Fixture report",
                  completedAt: new Date(),
                })
                .where(eq(aiTasks.id, taskId));
              const detail = await service.get(ctx, taskId);
              assert.equal(detail.result, "# Fixture report");
              assert.equal(detail.status, "completed");
              assert.equal(detail.events[0]?.type, "queued");
            },
          );
          await t.test(
            "Cancel uses existing Task lifecycle and keeps private association",
            async () => {
              await tx
                .update(aiTasks)
                .set({ status: "queued", completedAt: null })
                .where(eq(aiTasks.id, taskId));
              assert.equal(
                (await request(`/tasks/${taskId}/cancel`, "POST", {})).status,
                201,
              );
              assert.equal(
                (await service.get(ctx, taskId)).status,
                "cancelled",
              );
              assert.equal((await service.list(ctx)).length, 1);
            },
          );
          await t.test(
            "Database rejects wrong owner/tenant links; deletion keeps Task, removes link",
            async () => {
              for (const values of [
                { organizationId: org, userId: userB },
                { organizationId: orgB, userId: user },
              ]) {
                await assert.rejects(
                  tx.transaction(async (save) => {
                    // Remove the existing unique link only in this savepoint so
                    // rejection proves the owner FK, not an unrelated unique FK.
                    await save.delete(assistantTaskLinks).where(eq(assistantTaskLinks.taskId, taskId));
                    await save
                      .insert(assistantTaskLinks)
                      .values({
                        id: randomUUID(),
                        ...values,
                        conversationId: conversation.id,
                        requestId: randomUUID(),
                        requestHash: "fixture",
                        taskId,
                      });
                  }),
                  (error: unknown) => (error as { cause?: { code?: string } }).cause?.code === "23503",
                );
              }
              await assert.rejects(tx.transaction(async (save) => {
                const foreignTask = randomUUID();
                await save.insert(aiTasks).values({ id: foreignTask, organizationId: orgB, createdBy: user, title: "Foreign fixture", description: "fixture" });
                await save.insert(assistantTaskLinks).values({ id: randomUUID(), organizationId: org, userId: user, conversationId: conversation.id, requestId: randomUUID(), requestHash: "fixture", taskId: foreignTask });
              }), (error: unknown) => (error as { cause?: { code?: string } }).cause?.code === "23503");
              await assistant.remove(ctx, conversation.id);
              assert.equal(
                (await tx.select().from(assistantTaskLinks)).length,
                0,
              );
              assert.equal((await tx.select().from(aiTasks)).length, 1);
              assert.equal(
                (await tx.select().from(assistantConversations)).length,
                0,
              );
            },
          );
        } finally {
          await app.close();
          auth.mock.restore();
          for (const patch of patches) patch.mock.restore();
        }
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      const cleaned = await pool.query(
        "select 1 from pg_namespace where nspname=$1",
        [schema],
      );
      assert.equal(cleaned.rowCount, 0, "All fixture DDL/data rolled back");
      await pool.end();
    }
  },
);
