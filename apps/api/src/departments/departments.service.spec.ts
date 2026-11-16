import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { DepartmentsService } from "./departments.service.js";
import { departmentWorkflowWaitingToken, isDepartmentWorkflowWaitingToken, isReleasedDepartmentStep } from "./department-workflow-state.js";

const agent = (id:string, role:string, tools:string[] = []) => ({ id, name:id, role, status:"active", departmentId:"dept", connectionId:"connection", modelId:"model", toolConfig:{ enabledTools:tools } });
const pick = (agents: unknown[]) => (DepartmentsService.prototype as unknown as { pickWorkflow: (department: unknown, agents: unknown[]) => Array<{agent:{id:string};role:string}> }).pickWorkflow({ slug:"market-intelligence", leadAgentId:"manager" }, agents);

test("Market Intelligence assigns the explicit research and insights roles", () => {
  const workflow = pick([agent("manager", "Intelligence Manager"), agent("insights", "Customer Insights Agent", ["web_research"]), agent("research", "Research Agent", ["web_research"])]);
  assert.deepEqual(workflow.map((step) => step.agent.id), ["manager", "research", "insights", "manager"]);
  assert.deepEqual(workflow.map((step) => step.role), ["Intelligence Manager", "Research Agent", "Customer Insights Agent", "Intelligence Manager"]);
});

test("Market Intelligence rejects a missing qualified Research Agent", () => {
  assert.throws(() => pick([agent("manager", "Intelligence Manager"), agent("insights", "Customer Insights Agent", ["web_research"])]), BadRequestException);
});

test("later Department steps are held until persisted predecessor output releases them", () => {
  const token = departmentWorkflowWaitingToken("run-1", 2);
  assert.equal(isDepartmentWorkflowWaitingToken(token), true);
  assert.equal(isReleasedDepartmentStep({ sequence: 2, previousStepStatus: "completed", description: "Nhiệm vụ chưa có output" }), false);
  assert.equal(isReleasedDepartmentStep({ sequence: 2, previousStepStatus: "completed", description: "--- OUTPUT BƯỚC 1 (Intelligence Manager) ---\nKết quả\n--- END OUTPUT ---" }), true);
  assert.equal(isReleasedDepartmentStep({ sequence: 2, previousStepStatus: "running", description: "--- OUTPUT BƯỚC 1 (Intelligence Manager) ---" }), false);
});
