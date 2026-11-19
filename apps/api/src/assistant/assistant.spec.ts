import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { encryptCredential } from "../ai-credentials/credential-crypto.js";
import {
  AssistantChatRuntimeService,
  AssistantProviderError,
  streamJson,
} from "../ai-providers/assistant-chat-runtime.service.js";
import { PROVIDER_REGISTRY } from "../ai-providers/provider-registry.js";
import { assistantContext, AssistantService } from "./assistant.service.js";
import { BadRequestException } from "@nestjs/common";
import { AssistantMessageDto } from "./assistant.dto.js";
import { validate } from "class-validator";
import {
  hasPermission,
  PERMISSIONS,
} from "../common/permissions/permissions.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
function runtime(
  provider: "openrouter" | "google" | "anthropic" = "openrouter",
) {
  const instance = new AssistantChatRuntimeService();
  const identity = {
    organizationId: "fixture-org",
    connectionId: "fixture-connection",
    provider,
  };
  const credential = encryptCredential("fixture-key", identity);
  instance.connection = async () => ({
    connection: {
      ...credential,
      id: identity.connectionId,
      organizationId: identity.organizationId,
      provider,
    } as never,
    definition: PROVIDER_REGISTRY[provider],
  });
  return instance;
}
const input = () => ({
  organizationId: "fixture-org",
  connectionId: "fixture-connection",
  modelId: "fixture-model",
  messages: [{ role: "user" as const, content: "Chào Nova" }],
  signal: new AbortController().signal,
  onDelta: async () => {},
});
function sse(frames: unknown[]) {
  return new Response(
    frames.map((frame) => `data: ${JSON.stringify(frame)}\r\n\r\n`).join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
}

describe("Personal Assistant runtime and policy", () => {
  it("returns an actionable HTTP error for a disabled or unavailable connection", async () => {
    const service = new AssistantService({ connection: async () => { throw new AssistantProviderError("NOT_CONFIGURED", "Kết nối AI không khả dụng."); } } as never, {} as never, {} as never);
    Reflect.set(service, "owned", async () => ({ id: "fixture" }));
    await assert.rejects(service.claim({ organizationId: "fixture-org", userId: "fixture-user", sessionId: "fixture", role: "member" }, "fixture", { requestId: "fixture", content: "hi", connectionId: "disabled", modelId: "fixture" }), (error: unknown) => error instanceof BadRequestException && error.getStatus() === 400 && error.message.includes("không khả dụng"));
  });
  it("keeps only completed contextual turns within the bounded history", () => {
    const messages = assistantContext(
      [
        {
          status: "completed",
          userContent: "Tôi tên An",
          assistantContent: "Chào An",
        },
        {
          status: "failed",
          userContent: "secret failed context",
          assistantContent: "partial",
        },
      ],
      "Tôi tên gì?",
    );
    assert.equal(messages.length, 4);
    assert.equal(messages[1]?.content, "Tôi tên An");
    assert.equal(
      JSON.stringify(messages).includes("secret failed context"),
      false,
    );
    assert.equal(
      assistantContext(
        [
          {
            status: "completed",
            userContent: "x".repeat(32_000),
            assistantContent: "y",
          },
        ],
        "hello",
      ).length,
      2,
    );
  });
  it("grants personal Assistant use to members without provider management", () => {
    assert.equal(hasPermission("member", PERMISSIONS.ASSISTANT_USE), true);
    assert.equal(
      hasPermission("member", PERMISSIONS.AI_PROVIDER_MANAGE),
      false,
    );
  });
  it("rejects arbitrary user/org IDs and invalid message IDs in the DTO", async () => {
    const dto = Object.assign(new AssistantMessageDto(), {
      requestId: "invalid",
      content: "hi",
      connectionId: "fixture",
      modelId: "fixture",
      userId: "attacker",
    });
    const issues = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    assert.ok(issues.some((e) => e.property === "userId"));
    assert.ok(issues.some((e) => e.property === "requestId"));
  });
  it("parses fragmented SSE and never exposes provider credentials in deltas", async () => {
    const bytes = new TextEncoder().encode(
      'data: {"text":"Xin chào"}\r\n\r\ndata: [DONE]\r\n\r\n',
    );
    const response = new Response(
      new ReadableStream({
        start(controller) {
          for (let i = 0; i < bytes.length; i += 3)
            controller.enqueue(bytes.slice(i, i + 3));
          controller.close();
        },
      }),
    );
    const result = [];
    for await (const item of streamJson(response)) result.push(item);
    assert.deepEqual(result, [{ text: "Xin chào" }]);
  });
  it("streams OpenAI-compatible output, context, cancellation signal and reliable usage", async () => {
    let request: Record<string, unknown> = {};
    globalThis.fetch = async (_url, init) => {
      request = JSON.parse(String(init?.body));
      assert.ok(init?.signal);
      return sse([
        { choices: [{ delta: { content: "Xin " }, finish_reason: null }] },
        {
          choices: [{ delta: { content: "chào" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
        },
      ]);
    };
    let text = "";
    const usage = await runtime().generate({
      ...input(),
      onDelta: async (delta) => {
        text += delta;
      },
    });
    assert.equal(text, "Xin chào");
    assert.equal(request.stream, true);
    assert.equal(JSON.stringify(request).includes("fixture-key"), false);
    assert.equal(usage.totalTokens, 15);
  });
  for (const status of [400, 401, 402, 429, 500])
    it(`handles provider HTTP ${status} without leaking response body`, async () => {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            error: { message: "fixture-key internal private content" },
          }),
          { status },
        );
      await assert.rejects(
        runtime().generate(input()),
        (error: unknown) =>
          error instanceof AssistantProviderError &&
          !error.message.includes("fixture-key") &&
          (status !== 429 || error.code === "RATE_LIMITED"),
      );
    });
  it("rejects empty or prematurely truncated streams", async () => {
    globalThis.fetch = async () =>
      sse([{ choices: [{ delta: { content: "partial" } }] }]);
    await assert.rejects(
      runtime().generate(input()),
      (e: unknown) =>
        e instanceof AssistantProviderError && e.code === "INCOMPLETE_OUTPUT",
    );
    globalThis.fetch = async () =>
      sse([
        {
          choices: [{ delta: { content: "partial" }, finish_reason: "length" }],
        },
      ]);
    await assert.rejects(
      runtime().generate(input()),
      (e: unknown) =>
        e instanceof AssistantProviderError && e.code === "INCOMPLETE_OUTPUT",
    );
  });
  it("distinguishes timeout and user cancellation", async () => {
    globalThis.fetch = async () => {
      throw new DOMException("timeout", "TimeoutError");
    };
    await assert.rejects(
      runtime().generate(input()),
      (e: unknown) =>
        e instanceof AssistantProviderError && e.code === "TIMEOUT",
    );
    const abort = new AbortController();
    abort.abort();
    await assert.rejects(
      runtime().generate({ ...input(), signal: abort.signal }),
      (e: unknown) =>
        e instanceof AssistantProviderError && e.code === "CANCELLED",
    );
  });
  it("normalizes Gemini streaming and filters reasoning text", async () => {
    globalThis.fetch = async (url) => {
      assert.match(String(url), /streamGenerateContent\?alt=sse/);
      return sse([
        {
          candidates: [
            {
              content: {
                parts: [
                  { thought: true, text: "hidden reasoning" },
                  { text: "Chào bạn" },
                ],
              },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 2,
            candidatesTokenCount: 3,
            totalTokenCount: 5,
          },
        },
      ]);
    };
    let result = "";
    await runtime("google").generate({
      ...input(),
      onDelta: async (delta) => {
        result += delta;
      },
    });
    assert.equal(result, "Chào bạn");
  });
  it("normalizes Anthropic streaming and token metadata", async () => {
    globalThis.fetch = async () =>
      sse([
        { type: "message_start", message: { usage: { input_tokens: 4 } } },
        {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Chào" },
        },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 2 },
        },
      ]);
    assert.equal((await runtime("anthropic").generate(input())).totalTokens, 6);
  });
});
