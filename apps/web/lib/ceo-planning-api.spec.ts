import assert from "node:assert/strict";
import test from "node:test";
import { createCeoPlanPayload } from "./ceo-planning-api.js";

test("CEO plan payload only contains fields accepted by CreateCeoPlanDto", () => {
  const payload = createCeoPlanPayload({ ceoAgentId: "ce8e281d-9a5b-4a42-a957-36d9c0e4855b", title: "Kế hoạch quý", objective: "Tăng khách hàng SME", preset: "deep", maxOutputTokens: 8000, timeoutSeconds: 180, executionSource: "api_provider" });
  assert.deepEqual(payload, { ceoAgentId: "ce8e281d-9a5b-4a42-a957-36d9c0e4855b", title: "Kế hoạch quý", objective: "Tăng khách hàng SME", preset: "deep", maxOutputTokens: 8000, timeoutSeconds: 180, executionSource: "api_provider" });
  assert.equal("reasoningEffort" in payload, false);
  assert.equal("generationSettings" in payload, false);
});
