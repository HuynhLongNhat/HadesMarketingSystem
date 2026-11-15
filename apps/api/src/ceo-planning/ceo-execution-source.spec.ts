import assert from "node:assert/strict";
import test from "node:test";
import { assertSupportedExecutionSource, apiProviderExecutionSource, storedExecutionSource } from "./ceo-execution-source.js";

test("API-provider execution snapshots contain only routing metadata", () => {
  const source = apiProviderExecutionSource({ organizationId: "org-a", requestedByUserId: "user-a", providerConnectionId: "connection-a", modelId: "model-a" });
  assert.deepEqual(source, { version: "v1", type: "api_provider", organizationId: "org-a", requestedByUserId: "user-a", providerConnectionId: "connection-a", modelId: "model-a" });
  assert.equal(JSON.stringify(source).includes("token"), false);
  assert.equal(JSON.stringify(source).includes("key"), false);
});

test("ChatGPT Plan is fail-closed until SIWC approval and a compliant runtime exist", () => {
  assert.throws(() => assertSupportedExecutionSource("chatgpt_plan"), /chưa khả dụng/);
});

test("stored execution source validates version and source shape", () => {
  assert.equal(storedExecutionSource({ version: "v1", type: "api_provider", organizationId: "org-a", requestedByUserId: "user-a", providerConnectionId: "connection-a", modelId: "model-a" })?.type, "api_provider");
  assert.equal(storedExecutionSource({ version: "v1", type: "api_provider", organizationId: "org-a" }), null);
});
