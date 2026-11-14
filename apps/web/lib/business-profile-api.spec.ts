import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's native TypeScript test runner intentionally loads this source file directly.
import { toBusinessProfileInput, toBusinessProfileUpdatePayload, type BusinessProfile } from "./business-profile-payload.ts";

test("Business Profile PUT payload contains only UpdateBusinessProfileDto fields", () => {
  const response: BusinessProfile = {
    organizationId: "org-a", currency: "VND", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
    businessName: "Công ty A", primaryIndustry: null, businessModel: "b2b", productsServices: ["SaaS"], targetCustomers: null, markets: [], competitiveAdvantages: [], priorityBusinessGoals: [], currentChallenges: [], developmentStage: null,
    marketingBudgetVnd: 0, paidAdsBudgetVnd: 0, budgetPeriodDays: 30, teamSize: null, availableHoursPerWeek: null, availableTools: [], availableChannels: [], riskTolerance: "balanced", constraintsNote: null,
  };
  const payload = toBusinessProfileUpdatePayload(toBusinessProfileInput(response));
  assert.equal(payload.marketingBudgetVnd, 0);
  assert.equal(payload.paidAdsBudgetVnd, 0);
  for (const readOnly of ["organizationId", "currency", "createdAt", "updatedAt"]) assert.equal(readOnly in payload, false);
  assert.deepEqual(Object.keys(payload).sort(), ["availableChannels", "availableHoursPerWeek", "availableTools", "businessModel", "businessName", "competitiveAdvantages", "constraintsNote", "currentChallenges", "developmentStage", "marketingBudgetVnd", "markets", "paidAdsBudgetVnd", "primaryIndustry", "priorityBusinessGoals", "productsServices", "riskTolerance", "targetCustomers", "teamSize", "budgetPeriodDays"].sort());
});
