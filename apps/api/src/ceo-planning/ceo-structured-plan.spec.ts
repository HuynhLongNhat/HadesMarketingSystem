import assert from "node:assert/strict";
import test from "node:test";
import { extractCeoStructuredPlan, validateCeoPlanAgentReferences } from "./ceo-structured-plan.js";

const existingAgentId = "5ae7d251-e662-4bda-9a0e-19d7ce2af5cb";
const foreignAgentId = "6ae7d251-e662-4bda-9a0e-19d7ce2af5cb";
type RawPlan = Record<string, unknown>;
const task = (plan: RawPlan) => (plan.tasks as Array<Record<string, unknown>>)[0]!;
const recommendation = (plan: RawPlan) => (plan.agentRecommendations as Array<Record<string, unknown>>)[0]!;

function validPlan(): RawPlan {
  return {
    version: "v3.1", objective: "Tăng khách hàng phù hợp", businessAnalysis: ["Dữ liệu hiện có chưa đủ."], strategy: ["Thử nghiệm phạm vi nhỏ."], assumptions: ["Cần xác nhận kênh."], risks: ["Thiếu thời gian."],
    phases: [{ name: "Khởi động", milestone: "Chốt thông điệp", timeframe: "Tuần 1" }],
    resourceAllocation: { summary: "Ước lượng cần xác nhận.", humanHoursAssumption: null, aiSupportNotes: ["AI chỉ hỗ trợ phân tích."] },
    tasks: [{ id: "TASK-01", title: "Phân tích", description: "Phân tích dữ liệu hiện có.", deliverable: "Bản tóm tắt", acceptanceCriteria: "Có ba phát hiện.", priority: "high", estimatedHours: 4, dependencies: [], responsibleType: "EXISTING_AGENT", agentRef: "AGENT-01" }],
    agentRecommendations: [{ agentRef: "AGENT-01", name: "Research", rationale: "Có web research.", status: "EXISTING_AGENT", verifiedCapabilities: ["web_research"] }],
    kpis: [{ metric: "Lead phù hợp", target: "Mục tiêu cần xác nhận", deadline: "30 ngày", measurementMethod: "Đối chiếu CRM", relatedObjective: "Tăng khách hàng phù hợp" }],
    feasibilityWarnings: [],
  };
}
function parsed(plan: RawPlan) {
  const result = extractCeoStructuredPlan(JSON.stringify(plan));
  if ("error" in result) assert.fail(result.error);
  return result.plan;
}

test("accepts model-generated local task and agent references", () => {
  const plan = parsed(validPlan());
  assert.equal(validateCeoPlanAgentReferences(plan, [{ id: existingAgentId, ref: "AGENT-01", status: "active" }]), null);
});
test("rejects a model-generated name where an agent reference is required", () => {
  const plan = validPlan(); task(plan).agentRef = "Research";
  const result = extractCeoStructuredPlan(JSON.stringify(plan));
  assert.ok("error" in result);
  if ("error" in result) assert.equal(result.issues?.[0]?.path, "tasks.0.agentRef");
});
test("rejects a fake UUID and an agent UUID from another organization", () => {
  const fake = validPlan(); delete task(fake).agentRef; task(fake).agentId = "not-a-uuid";
  assert.ok("error" in extractCeoStructuredPlan(JSON.stringify(fake)));
  const foreign = validPlan(); delete task(foreign).agentRef; task(foreign).agentId = foreignAgentId;
  assert.match(validateCeoPlanAgentReferences(parsed(foreign), [{ id: existingAgentId, ref: "AGENT-01", status: "active" }]) ?? "", /không thuộc Organization/);
});
test("rejects a dependency that does not reference a declared local task", () => {
  const plan = validPlan(); task(plan).dependencies = ["TASK-99"];
  const result = extractCeoStructuredPlan(JSON.stringify(plan));
  assert.ok("error" in result);
  if ("error" in result) assert.equal(result.issues?.[0]?.path, "tasks.0.dependencies");
});
test("keeps a valid legacy UUID agent assignment readable but organization-scoped", () => {
  const plan = validPlan(); delete task(plan).agentRef; task(plan).agentId = existingAgentId; delete recommendation(plan).agentRef; recommendation(plan).agentId = existingAgentId;
  assert.equal(validateCeoPlanAgentReferences(parsed(plan), [{ id: existingAgentId, status: "active" }]), null);
});
