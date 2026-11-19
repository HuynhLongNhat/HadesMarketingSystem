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
import type { Request } from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  aiModelDefaults,
  aiProviderConnections,
  assistantConversations,
  assistantTurns,
  db,
  pool,
} from "@workspace/db/node";
import {
  AssistantController,
  AssistantOriginGuard,
} from "./assistant.controller.js";
import { AssistantService } from "./assistant.service.js";
import {
  AssistantChatRuntimeService,
  AssistantProviderError,
} from "../ai-providers/assistant-chat-runtime.service.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { PermissionsGuard } from "../common/permissions/permissions.guard.js";
import type { RequestContext } from "../auth/request-context.js";

// The real migration is executed only inside a rollback transaction and an
// isolated schema. No application tables or production database are modified.
test(
  "Assistant PostgreSQL + HTTP integration (rollback-only fixtures)",
  { timeout: 120_000 },
  async (t) => {
    const { rows } = await pool.query<{ environment: string }>(
      "select environment from public.environment_identity where id=1",
    );
    assert.equal(
      rows[0]?.environment,
      "development",
      "Assistant integration requires verified development DB",
    );
    const schema = `assistant_test_${randomUUID().replaceAll("-", "")}`;
    const rollback = new Error("rollback fixtures");
    const org = randomUUID(),
      secondOrg = randomUUID(),
      owner = randomUUID(),
      other = randomUUID();
    const ctx: RequestContext = {
      organizationId: org,
      userId: owner,
      sessionId: "fixture",
      role: "member",
    };
    const secondUser = { ...ctx, userId: other },
      secondTenant = { ...ctx, organizationId: secondOrg };
    const migration = await readFile(
      new URL(
        "../../../../packages/db/drizzle/0054_personal_assistant.sql",
        import.meta.url,
      ),
      "utf8",
    );
    try {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql.raw(
            `CREATE SCHEMA "${schema}"; SET LOCAL search_path TO "${schema}", public; CREATE TABLE organization (id text PRIMARY KEY); CREATE TABLE "user" (id text PRIMARY KEY);`,
          ),
        );
        await tx.execute(sql.raw(migration));
        await tx.execute(
          sql.raw(
            "CREATE TABLE ai_provider_connections (LIKE public.ai_provider_connections INCLUDING ALL)",
          ),
        );
        await tx.execute(
          sql.raw(
            "CREATE TABLE ai_model_defaults (LIKE public.ai_model_defaults INCLUDING ALL); CREATE TABLE ai_agents (LIKE public.ai_agents INCLUDING ALL)",
          ),
        );
        await tx.execute(
          sql`insert into organization (id) values (${org}), (${secondOrg})`,
        );
        await tx.execute(
          sql`insert into "user" (id) values (${owner}), (${other})`,
        );
        const connectionId = randomUUID();
        await tx
          .insert(aiProviderConnections)
          .values({
            id: connectionId,
            organizationId: org,
            name: "Assistant fixture only",
            provider: "openrouter",
            encryptedApiKey: "fixture-encrypted",
            keyIv: "fixture-iv",
            keyAuthTag: "fixture-tag",
            enabled: true,
          });
        await tx
          .insert(aiModelDefaults)
          .values({
            id: randomUUID(),
            organizationId: org,
            connectionId,
            modelId: "fixture-model",
            purpose: "general",
          });
        await tx
          .insert(aiModelDefaults)
          .values({
            id: randomUUID(),
            organizationId: org,
            connectionId,
            modelId: "embedding-only",
            purpose: "embedding",
          });
        const patches = [
          mock.method(db, "select", tx.select.bind(tx)),
          mock.method(db, "insert", tx.insert.bind(tx)),
          mock.method(db, "update", tx.update.bind(tx)),
          mock.method(db, "delete", tx.delete.bind(tx)),
          mock.method(db, "transaction", tx.transaction.bind(tx)),
        ];
        let calls = 0,
          sawContext = false;
        const runtime = {
          connection: async () => ({ connection: { provider: "openrouter" } }),
          generate: async (input: {
            messages: Array<{ content: string }>;
            onDelta: (text: string) => Promise<void>;
            signal: AbortSignal;
          }) => {
            calls++;
            sawContext ||= input.messages.some(
              (m) => m.content === "Tôi tên An",
            );
            await input.onDelta("Xin chào An");
            return { inputTokens: 5, outputTokens: 3, totalTokens: 8 };
          },
        };
        const quota = {
          reserve: async () => ({ limited: false }),
          release: async () => {},
          retainUntilPeriodEnd: async () => {},
        };
        const usage: unknown[] = [];
        const service = new AssistantService(
          runtime as never,
          quota as never,
          {
            record: async (entry: unknown) => {
              usage.push(entry);
              return true;
            },
          } as never,
        );
        const authPatch = mock.method(
          AuthGuard.prototype,
          "canActivate",
          async (context: ExecutionContext) => {
            const req = context
              .switchToHttp()
              .getRequest<Request & { requestContext: RequestContext }>();
            if (!req.headers["x-fixture-user"])
              throw new UnauthorizedException();
            req.requestContext =
              req.headers["x-fixture-user"] === "other"
                ? secondUser
                : req.headers["x-fixture-user"] === "tenant"
                  ? secondTenant
                  : ctx;
            return true;
          },
        );
        @Module({
          controllers: [AssistantController],
          providers: [
            { provide: AssistantService, useValue: service },
            AssistantOriginGuard,
            AuthGuard,
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
          customOrigin = origin,
        ) =>
          fetch(`${base}${path}`, {
            method,
            headers: {
              "Content-Type": "application/json",
              "x-fixture-user": actor,
              Origin: customOrigin,
            },
            ...(data === undefined ? {} : { body: JSON.stringify(data) }),
            signal: AbortSignal.timeout(10_000),
          });
        let conversationId = "";
        const input = {
          requestId: randomUUID(),
          connectionId,
          modelId: "fixture-model",
          content: "Tôi tên An",
        };
        try {
          await t.test(
            "HTTP authentication and origin protection run before mutations",
            async () => {
              assert.equal((await fetch(`${base}/conversations`)).status, 401);
              assert.equal(
                (
                  await request(
                    "/conversations",
                    "POST",
                    {},
                    "owner",
                    "https://evil.invalid",
                  )
                ).status,
                403,
              );
              assert.equal((await service.list(ctx)).length, 0);
            },
          );
          await t.test(
            "creates, streams, persists, reads and renames a private conversation",
            async () => {
              const created = await request("/conversations", "POST", {});
              assert.equal(created.status, 201);
              conversationId = ((await created.json()) as { id: string }).id;
              const response = await request(
                `/conversations/${conversationId}/messages`,
                "POST",
                input,
              );
              assert.equal(response.status, 200);
              const stream = await response.text();
              assert.match(stream, /Xin chào An/);
              assert.match(stream, /"type":"done"/);
              const saved = await service.get(ctx, conversationId);
              assert.equal(saved.turns.length, 1);
              assert.equal(saved.turns[0]?.status, "completed");
              assert.equal(saved.turns[0]?.totalTokens, 8);
              assert.equal(
                JSON.stringify(saved).includes("executionToken"),
                false,
              );
              assert.equal(
                (
                  await request(`/conversations/${conversationId}`, "PATCH", {
                    title: "Tư vấn công việc",
                  })
                ).status,
                200,
              );
              assert.equal(
                (await service.get(ctx, conversationId)).title,
                "Tư vấn công việc",
              );
            },
          );
          await t.test(
            "replayed requests do not generate duplicate messages or provider usage",
            async () => {
              const beforeCalls = calls,
                beforeUsage = usage.length;
              await (
                await request(
                  `/conversations/${conversationId}/messages`,
                  "POST",
                  input,
                )
              ).text();
              assert.equal(calls, beforeCalls);
              assert.equal(usage.length, beforeUsage);
              assert.equal(
                (await service.get(ctx, conversationId)).turns.length,
                1,
              );
            },
          );
          await t.test(
            "user and organization IDOR is denied across read, rename, delete and send",
            async () => {
              for (const actor of ["other", "tenant"]) {
                for (const [path, method, body] of [
                  [`/conversations/${conversationId}`, "GET", undefined],
                  [
                    `/conversations/${conversationId}`,
                    "PATCH",
                    { title: "hijack" },
                  ],
                  [`/conversations/${conversationId}`, "DELETE", undefined],
                  [`/conversations/${conversationId}/messages`, "POST", input],
                ] as const)
                  assert.equal(
                    (await request(path, method, body, actor)).status,
                    404,
                  );
              }
              assert.equal((await service.list(secondUser)).length, 0);
            },
          );
          await t.test(
            "real connection lookup rejects other organizations and disabled connections",
            async () => {
              const resolver = new AssistantChatRuntimeService();
              assert.equal(
                (await resolver.connection(org, connectionId)).connection.id,
                connectionId,
              );
              await assert.rejects(
                resolver.connection(secondOrg, connectionId),
                /không khả dụng/,
              );
              await tx
                .update(aiProviderConnections)
                .set({ enabled: false })
                .where(eq(aiProviderConnections.id, connectionId));
              await assert.rejects(
                resolver.connection(org, connectionId),
                /không khả dụng/,
              );
              await tx
                .update(aiProviderConnections)
                .set({ enabled: true })
                .where(eq(aiProviderConnections.id, connectionId));
              const options = await service.options(ctx);
              assert.deepEqual(options[0]?.models, ["fixture-model"]);
              assert.equal(
                JSON.stringify(options).includes("fixture-encrypted"),
                false,
              );
              await assert.rejects(
                service.claim(ctx, conversationId, {
                  ...input,
                  requestId: randomUUID(),
                  modelId: "unconfigured-model",
                }),
                /chưa được cấu hình/,
              );
            },
          );
          await t.test(
            "follow-up sends persisted conversation context",
            async () => {
              await (
                await request(
                  `/conversations/${conversationId}/messages`,
                  "POST",
                  { ...input, requestId: randomUUID(), content: "Tôi tên gì?" },
                )
              ).text();
              assert.equal(sawContext, true);
            },
          );
          await t.test(
            "provider failure is saved and explicit retry reuses the same turn",
            async () => {
              const broken = {
                ...input,
                requestId: randomUUID(),
                content: "quota test",
              };
              const original = runtime.generate;
              runtime.generate = async () => {
                throw new AssistantProviderError(
                  "RATE_LIMITED",
                  "Nhà cung cấp đang giới hạn lượt gọi.",
                );
              };
              await (
                await request(
                  `/conversations/${conversationId}/messages`,
                  "POST",
                  broken,
                )
              ).text();
              const failed = (await service.get(ctx, conversationId)).turns.at(
                -1,
              )!;
              assert.equal(failed.status, "failed");
              assert.equal(failed.errorCode, "RATE_LIMITED");
              runtime.generate = original;
              await (
                await request(
                  `/conversations/${conversationId}/messages`,
                  "POST",
                  { ...broken, retry: true },
                )
              ).text();
              const saved = (await service.get(ctx, conversationId)).turns.at(
                -1,
              )!;
              assert.equal(saved.id, failed.id);
              assert.equal(saved.attemptCount, 2);
              assert.equal(saved.status, "completed");
            },
          );
          await t.test(
            "organization quota refusal persists an error without calling the provider",
            async () => {
              const reserve = quota.reserve;
              quota.reserve = async () =>
                ({ limited: true, allowed: false }) as never;
              const beforeCalls = calls;
              await (
                await request(
                  `/conversations/${conversationId}/messages`,
                  "POST",
                  {
                    ...input,
                    requestId: randomUUID(),
                    content: "quota refusal",
                  },
                )
              ).text();
              const saved = (await service.get(ctx, conversationId)).turns.at(
                -1,
              )!;
              assert.equal(saved.status, "failed");
              assert.equal(saved.errorCode, "QUOTA_EXCEEDED");
              assert.equal(calls, beforeCalls);
              quota.reserve = reserve;
            },
          );
          await t.test(
            "cancel and duplicate submission preserve one active generation",
            async () => {
              const cancelInput = {
                ...input,
                requestId: randomUUID(),
                content: "cancel test",
              };
              const claimed = await service.claim(
                ctx,
                conversationId,
                cancelInput,
              );
              await assert.rejects(
                service.claim(ctx, conversationId, {
                  ...cancelInput,
                  requestId: randomUUID(),
                }),
                /vẫn đang xử lý/,
              );
              assert.equal(
                (await request(`/conversations/${conversationId}`, "DELETE"))
                  .status,
                409,
              );
              await service.cancel(ctx, conversationId, cancelInput.requestId);
              assert.equal(
                (await service.get(ctx, conversationId)).turns.at(-1)?.status,
                "cancelled",
              );
              const lateCondition = and(
                eq(assistantTurns.id, claimed.turn.id),
                eq(assistantTurns.executionToken, claimed.turn.executionToken!),
              );
              assert.equal(
                (
                  await tx
                    .update(assistantTurns)
                    .set({ status: "completed" })
                    .where(lateCondition)
                    .returning()
                ).length,
                0,
              );
            },
          );
          await t.test(
            "HTTP cancel aborts an active provider signal and cannot become completed",
            async () => {
              const original = runtime.generate;
              let start!: () => void;
              const started = new Promise<void>((resolve) => {
                start = resolve;
              });
              let wasAborted = false;
              runtime.generate = async (input) => {
                await input.onDelta("partial");
                start();
                await new Promise<void>((_resolve, reject) =>
                  input.signal.addEventListener(
                    "abort",
                    () => {
                      wasAborted = true;
                      reject(
                        new AssistantProviderError("CANCELLED", "Đã dừng."),
                      );
                    },
                    { once: true },
                  ),
                );
                return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
              };
              const cancelInput = {
                ...input,
                requestId: randomUUID(),
                content: "stop while streaming",
              };
              const claim = await service.claim(
                ctx,
                conversationId,
                cancelInput,
              );
              const processing = service.generate(
                ctx,
                claim.turn,
                new AbortController().signal,
                async () => {},
              );
              await started;
              assert.equal(
                (
                  await request(
                    `/conversations/${conversationId}/messages/${cancelInput.requestId}/cancel`,
                    "POST",
                    {},
                  )
                ).status,
                201,
              );
              await processing;
              assert.equal(wasAborted, true);
              assert.equal(
                (await service.get(ctx, conversationId)).turns.at(-1)?.status,
                "cancelled",
              );
              runtime.generate = original;
            },
          );
          await t.test(
            "expired leases become recoverable errors, without automatic provider calls",
            async () => {
              const row = await service.claim(ctx, conversationId, {
                ...input,
                requestId: randomUUID(),
                content: "stale",
              });
              await tx
                .update(assistantTurns)
                .set({ leaseExpiresAt: new Date(Date.now() - 5000) })
                .where(eq(assistantTurns.id, row.turn.id));
              const beforeCalls = calls;
              assert.equal(
                (await service.get(ctx, conversationId)).turns.at(-1)
                  ?.errorCode,
                "EXECUTION_INTERRUPTED",
              );
              assert.equal(calls, beforeCalls);
            },
          );
          await t.test(
            "composite FK prevents wrong-user and wrong-organization message ownership",
            async () => {
              for (const mismatch of [secondUser, secondTenant])
                await assert.rejects(
                  tx.transaction(async (nested) => {
                    await nested
                      .insert(assistantTurns)
                      .values({
                        id: randomUUID(),
                        organizationId: mismatch.organizationId,
                        userId: mismatch.userId,
                        conversationId,
                        requestId: randomUUID(),
                        sequence: 99,
                        userContent: "forbidden",
                        connectionId: "fixture",
                        provider: "fixture",
                        modelId: "fixture",
                        status: "failed",
                      });
                  }),
                );
            },
          );
          await t.test(
            "deletion cascades only the owned personal history",
            async () => {
              assert.equal(
                (await request(`/conversations/${conversationId}`, "DELETE"))
                  .status,
                200,
              );
              assert.equal(
                (
                  await tx
                    .select()
                    .from(assistantTurns)
                    .where(eq(assistantTurns.conversationId, conversationId))
                ).length,
                0,
              );
              assert.equal(
                (await tx.select().from(assistantConversations)).length,
                0,
              );
            },
          );
        } finally {
          await app.close();
          authPatch.mock.restore();
          for (const patch of patches) patch.mock.restore();
        }
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      const check = await pool.query<{ count: string }>(
        "select count(*)::text from pg_namespace where nspname=$1",
        [schema],
      );
      assert.equal(
        check.rows[0]?.count,
        "0",
        "Fixture schema and all test data must be rolled back",
      );
      await pool.end();
    }
  },
);
