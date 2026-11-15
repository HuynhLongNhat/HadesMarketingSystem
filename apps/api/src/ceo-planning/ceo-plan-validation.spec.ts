import assert from "node:assert/strict";
import test from "node:test";
import { ceoPlanApprovalError, validateCeoPlanReport } from "./ceo-plan-validation.js";
import { isTruncatedFinishReason } from "../tasks/task-ai-execution.service.js";

const structured = {
  version: "v3.1", objective: "Tăng trưởng có kiểm soát.", businessAnalysis: ["Bối cảnh."], strategy: ["Thử nghiệm."], assumptions: [], risks: [],
  phases: [{ name: "Khởi động", milestone: "Chốt mục tiêu", timeframe: "Tuần 1" }],
  resourceAllocation: { summary: "Cần xác nhận nguồn lực.", humanHoursAssumption: null, aiSupportNotes: [] },
  tasks: [{ id: "TASK-01", title: "Phân tích", description: "Phân tích hiện trạng.", deliverable: "Bản tóm tắt", acceptanceCriteria: "Có phát hiện rõ ràng.", priority: "high", estimatedHours: 2, dependencies: [], responsibleType: "HUMAN", agentRef: null }],
  agentRecommendations: [],
  kpis: [{ metric: "Lead", target: "Mục tiêu cần xác nhận", deadline: "30 ngày", measurementMethod: "Đối chiếu CRM", relatedObjective: "Tăng trưởng" }],
  feasibilityWarnings: [],
};

const valid = `# Mục tiêu\nTăng trưởng có kiểm soát.\n## Phân tích và bối cảnh\nBối cảnh.\n## Giả định và rủi ro\nRủi ro.\n## Chiến lược đề xuất\nChiến lược.\n## Công việc đề xuất\n| Công việc | Owner |\n| --- | --- |\n| Phân tích | Research Agent |\n## Nhân viên AI phù hợp và lý do\nResearch Agent phù hợp.\n## Chỉ số theo dõi\nTỷ lệ chuyển đổi.`;

test("accepts a complete CEO plan", () => assert.equal(validateCeoPlanReport(valid), null));
test("rejects a report missing a required section", () => assert.match(validateCeoPlanReport(valid.replace("## Chỉ số theo dõi\nTỷ lệ chuyển đổi.", "")) ?? "", /Chỉ số theo dõi/));
test("rejects a truncated markdown table", () => assert.match(validateCeoPlanReport(valid.replace("| Phân tích | Research Agent |", "| Phân tích |")) ?? "", /bảng Markdown/));
test("rejects the real incomplete final table row returned by the provider", () => {
  const realCutoff = `${valid}\n| 6 | **`;
  assert.match(validateCeoPlanReport(realCutoff) ?? "", /bảng Markdown/);
});
test("allows approval only for a completed, valid plan", () => {
  assert.match(ceoPlanApprovalError({ status: "running", result: valid }) ?? "", /hoàn tất/);
  assert.match(ceoPlanApprovalError({ status: "completed", result: "# Mục tiêu" }) ?? "", /thiếu mục/);
  assert.equal(ceoPlanApprovalError({ status: "completed", result: valid }), null);
});
test("allows a completed persisted V3.1 structured plan", () => {
  assert.equal(ceoPlanApprovalError({ status: "completed", result: null }, structured), null);
});
test("allows a completed V3.1 JSON result when persistence is not yet available", () => {
  assert.equal(ceoPlanApprovalError({ status: "completed", result: JSON.stringify(structured) }), null);
});
test("rejects incomplete V3.1 JSON instead of falling back to Markdown headings", () => {
  const invalid = { ...structured, kpis: [{ ...structured.kpis[0] }] };
  delete (invalid.kpis[0] as Record<string, unknown>).measurementMethod;
  assert.match(ceoPlanApprovalError({ status: "completed", result: JSON.stringify(invalid) }) ?? "", /JSON kế hoạch không hợp lệ/);
});

test("recognises provider output stopped at its token limit", () => {
  assert.equal(isTruncatedFinishReason("length"), true);
  assert.equal(isTruncatedFinishReason("max_tokens"), true);
  assert.equal(isTruncatedFinishReason("stop"), false);
});
