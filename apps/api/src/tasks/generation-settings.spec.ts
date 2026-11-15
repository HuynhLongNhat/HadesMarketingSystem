import assert from "node:assert/strict";
import test from "node:test";
import { resolveGenerationSettings } from "./generation-settings.js";

test("generation presets resolve to their effective token and timeout values", () => {
  assert.deepEqual(resolveGenerationSettings({ preset: "fast" }), { preset: "fast", maxOutputTokens: 2000, timeoutSeconds: 60, temperature: null, reasoningEffort: null });
  assert.deepEqual(resolveGenerationSettings({ preset: "balanced" }), { preset: "balanced", maxOutputTokens: 4000, timeoutSeconds: 120, temperature: null, reasoningEffort: null });
  assert.deepEqual(resolveGenerationSettings({ preset: "deep" }), { preset: "deep", maxOutputTokens: 8000, timeoutSeconds: 180, temperature: null, reasoningEffort: null });
});

test("generation settings preserve explicit token and timeout overrides", () => {
  const settings = resolveGenerationSettings({ preset: "fast", maxOutputTokens: 6123, timeoutSeconds: 177, reasoningEffort: "high" });
  assert.equal(settings.maxOutputTokens, 6123);
  assert.equal(settings.timeoutSeconds, 177);
  assert.equal(settings.reasoningEffort, "high");
});

test("generation settings reject invalid values", () => {
  assert.throws(() => resolveGenerationSettings({ preset: "balanced", maxOutputTokens: 8001 }));
  assert.throws(() => resolveGenerationSettings({ preset: "balanced", timeoutSeconds: 9 }));
});
