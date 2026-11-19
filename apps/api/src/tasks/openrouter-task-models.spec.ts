import assert from "node:assert/strict";
import { test } from "node:test";
import { openRouterTaskModels } from "./task-ai-execution.service.js";

test("fallback is opt-in and OpenRouter-only", () => {
  assert.equal(openRouterTaskModels("openrouter", "vendor/main:free", ""), null);
  assert.equal(openRouterTaskModels("groq", "vendor/main:free", "vendor/backup:free"), null);
});

test("free fallback is deduplicated, bounded and ordered", () => {
  assert.deepEqual(
    openRouterTaskModels("openrouter", "vendor/main:free", "vendor/backup:free, vendor/backup:free, vendor/paid, vendor/third:free"),
    ["vendor/main:free", "vendor/backup:free", "vendor/third:free"],
  );
});

test("no extra model is added when configured fallbacks are paid or empty", () => {
  assert.equal(openRouterTaskModels("openrouter", "vendor/main:free", "vendor/paid"), null);
  assert.equal(openRouterTaskModels("openrouter", "vendor/main:free", " , "), null);
});
