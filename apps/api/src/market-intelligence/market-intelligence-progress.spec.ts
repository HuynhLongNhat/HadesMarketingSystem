import assert from "node:assert/strict";
import test from "node:test";
import { calculateMarketIntelligenceProgress, MARKET_INTELLIGENCE_STEPS } from "./market-intelligence-progress.js";

test("Market Intelligence progress is derived from persisted completed steps, never a timer", () => {
  const steps = MARKET_INTELLIGENCE_STEPS.map((step, index) => ({ ...step, status: index < 2 ? "completed" : index === 2 ? "running" : "pending" }));
  assert.deepEqual(calculateMarketIntelligenceProgress(steps), { completedSteps: 2, progressPercent: 20 });
});

test("Market Intelligence cannot publish 100 percent before terminal completion", () => {
  const allSavedButTerminal = MARKET_INTELLIGENCE_STEPS.map((step) => ({ ...step, status: step.key === "saving_report" ? "running" : "completed" }));
  assert.deepEqual(calculateMarketIntelligenceProgress(allSavedButTerminal), { completedSteps: 5, progressPercent: 90 });
  const persistedReport = MARKET_INTELLIGENCE_STEPS.map((step) => ({ ...step, status: "completed" }));
  // The database transition to 100 is deliberately owned by completeMarketIntelligenceRun.
  assert.deepEqual(calculateMarketIntelligenceProgress(persistedReport), { completedSteps: 6, progressPercent: 99 });
});

test("failed and retrying steps do not make a project look complete", () => {
  const steps = MARKET_INTELLIGENCE_STEPS.map((step, index) => ({ ...step, status: index === 0 ? "completed" : index === 1 ? "failed" : "pending" }));
  assert.deepEqual(calculateMarketIntelligenceProgress(steps), { completedSteps: 1, progressPercent: 10 });
});
