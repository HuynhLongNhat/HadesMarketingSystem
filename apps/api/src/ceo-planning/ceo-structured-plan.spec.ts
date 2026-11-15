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
test("reports a missing KPI measurement method as safe repair metadata and accepts the repaired plan", () => {
  const invalid = validPlan();
  delete (invalid.kpis as Array<Record<string, unknown>>)[0]!.measurementMethod;
  const result = extractCeoStructuredPlan(JSON.stringify(invalid));
  assert.ok("error" in result);
  if ("error" in result) {
    const issue = (result.issues ?? []).find((value) => value.path === "kpis.0.measurementMethod");
    assert.equal(issue?.code, "invalid_type");
    assert.equal(issue?.expected, "string");
    assert.equal(issue?.receivedType, "missing");
  }
  (invalid.kpis as Array<Record<string, unknown>>)[0]!.measurementMethod = "Đối chiếu số liệu CRM hàng tuần";
  assert.ok(!("error" in extractCeoStructuredPlan(JSON.stringify(invalid))));
});
test("returns bounded metadata for several missing required fields and malformed JSON", () => {
  const incomplete = validPlan();
  delete incomplete.objective;
  delete (incomplete.kpis as Array<Record<string, unknown>>)[0]!.target;
  delete (incomplete.tasks as Array<Record<string, unknown>>)[0]!.deliverable;
  const invalid = extractCeoStructuredPlan(JSON.stringify(incomplete));
  assert.ok("error" in invalid);
  if ("error" in invalid) {
    const metadata = invalid.issues ?? [];
    assert.ok(metadata.length >= 3);
    assert.ok(metadata.length <= 10);
    assert.ok(metadata.every((issue) => issue.receivedType === "missing" || issue.receivedType === null));
  }
  const malformed = extractCeoStructuredPlan('{not-json}');
  assert.ok("error" in malformed);
  if ("error" in malformed) assert.match(malformed.error ?? "", /không thể phân tích/);
});
test("keeps a valid legacy UUID agent assignment readable but organization-scoped", () => {
  const plan = validPlan(); delete task(plan).agentRef; task(plan).agentId = existingAgentId; delete recommendation(plan).agentRef; recommendation(plan).agentId = existingAgentId;
  assert.equal(validateCeoPlanAgentReferences(parsed(plan), [{ id: existingAgentId, status: "active" }]), null);
});
