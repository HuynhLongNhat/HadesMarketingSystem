import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Native Node TypeScript runner loads this source directly.
import { assistantTaskPayload } from "./assistant-task-payload.ts";

test("Assistant Task payload whitelists DTO fields and retains idempotency key", () => {
  const request = { requestId: "request-1", title: " Work ", description: " Research ", agentId: "agent-1", organizationId: "not-client-controlled", userId: "not-client-controlled", status: "completed", executionToken: "never-send", modelId: "chat-model" };
  const payload = assistantTaskPayload(request);
  assert.deepEqual(payload, { requestId: "request-1", title: "Work", description: "Research", agentId: "agent-1" });
  assert.deepEqual(assistantTaskPayload(request), payload);
  assert.equal(payload.requestId, request.requestId);
});
