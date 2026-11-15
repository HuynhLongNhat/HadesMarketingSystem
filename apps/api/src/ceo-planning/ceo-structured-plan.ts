import { z } from "zod";

const text = z.string().trim().min(1).max(4000);
const taskRef = z.string().regex(/^TASK-\d{2,}$/i, "Task reference phải theo dạng TASK-01.");
const agentRef = z.string().regex(/^AGENT-\d{2,}$/i, "Agent reference phải theo dạng AGENT-01.");
const legacyAgentId = z.string().uuid().nullable().optional();

export const CEO_STRUCTURED_PLAN_VERSION = "v3.1";
const taskSchema = z.object({ id: taskRef, title: text, description: text, deliverable: text, acceptanceCriteria: text, priority: z.enum(["high", "medium", "low"]), estimatedHours: z.number().positive(), dependencies: z.array(taskRef), responsibleType: z.enum(["HUMAN", "EXISTING_AGENT", "PROPOSED_AGENT"]), agentRef: agentRef.nullable().optional(), agentId: legacyAgentId });
const agentRecommendationSchema = z.object({ agentRef: agentRef.nullable().optional(), agentId: legacyAgentId, name: text, rationale: text, status: z.enum(["EXISTING_AGENT", "PROPOSED_AGENT", "HUMAN"]), verifiedCapabilities: z.array(text) });

export const ceoStructuredPlanSchema = z.object({
  version: z.literal(CEO_STRUCTURED_PLAN_VERSION), objective: text, businessAnalysis: z.array(text).min(1), strategy: z.array(text).min(1), assumptions: z.array(text), risks: z.array(text),
  phases: z.array(z.object({ name: text, milestone: text, timeframe: text })).min(1),
  resourceAllocation: z.object({ summary: text, humanHoursAssumption: z.number().nonnegative().nullable(), aiSupportNotes: z.array(text) }),
  tasks: z.array(taskSchema).min(1), agentRecommendations: z.array(agentRecommendationSchema),
  kpis: z.array(z.object({ metric: text, target: text, deadline: text, measurementMethod: text, relatedObjective: text })).min(1), feasibilityWarnings: z.array(text),
}).superRefine((plan, ctx) => {
  const ids = new Set(plan.tasks.map((task) => task.id.toUpperCase()));
  for (let index = 0; index < plan.tasks.length; index++) {
    const task = plan.tasks[index]!;
    if (task.dependencies.some((id) => !ids.has(id.toUpperCase()))) ctx.addIssue({ code: "custom", path: ["tasks", index, "dependencies"], message: "Task dependency không tồn tại." });
    const hasAgentReference = Boolean(task.agentRef || task.agentId);
    if (task.responsibleType === "EXISTING_AGENT" && !hasAgentReference) ctx.addIssue({ code: "custom", path: ["tasks", index], message: "EXISTING_AGENT cần agentRef hợp lệ." });
    if (task.responsibleType !== "EXISTING_AGENT" && hasAgentReference) ctx.addIssue({ code: "custom", path: ["tasks", index], message: "Chỉ EXISTING_AGENT được có agentRef hoặc agentId." });
  }
  for (let index = 0; index < plan.agentRecommendations.length; index++) {
    const recommendation = plan.agentRecommendations[index]!;
    const hasAgentReference = Boolean(recommendation.agentRef || recommendation.agentId);
    if (recommendation.status === "EXISTING_AGENT" && !hasAgentReference) ctx.addIssue({ code: "custom", path: ["agentRecommendations", index], message: "EXISTING_AGENT cần agentRef hợp lệ." });
    if (recommendation.status !== "EXISTING_AGENT" && hasAgentReference) ctx.addIssue({ code: "custom", path: ["agentRecommendations", index], message: "Chỉ EXISTING_AGENT được có agentRef hoặc agentId." });
  }
});

export type CeoStructuredPlan = z.infer<typeof ceoStructuredPlanSchema>;
export type CeoPlanValidationIssue = { path: string; code: string; message: string; expected: string | null; format: string | null; receivedType: string | null };
type SnapshotAgent = { id?: string; ref?: string; status?: string };

export function validateCeoPlanAgentReferences(plan: CeoStructuredPlan, agents: SnapshotAgent[]): string | null {
  const byRef = new Map(agents.filter((agent) => agent.ref && agent.id).map((agent) => [agent.ref!.toUpperCase(), agent]));
  const ids = new Set(agents.map((agent) => agent.id).filter((id): id is string => typeof id === "string"));
  const validate = (ref: string | null | undefined, id: string | null | undefined) => {
    if (ref) { const agent = byRef.get(ref.toUpperCase()); if (!agent || agent.status !== "active") return "Agent reference không thuộc roster active của Organization."; }
    if (id && !ids.has(id)) return "Agent ID không thuộc Organization của kế hoạch.";
    return null;
  };
  for (const task of plan.tasks) { const error = validate(task.agentRef, task.agentId); if (error) return error; }
  for (const recommendation of plan.agentRecommendations) { const error = validate(recommendation.agentRef, recommendation.agentId); if (error) return error; }
  return null;
}

function issues(error: z.ZodError): CeoPlanValidationIssue[] {
  return error.issues.slice(0, 10).map((issue) => ({
    path: issue.path.map(String).join("."),
    code: issue.code,
    message: issue.message,
    expected: "expected" in issue && typeof issue.expected === "string" ? issue.expected : null,
    format: "format" in issue && typeof issue.format === "string" ? issue.format : null,
    // Zod omits `input` for a missing object property. "missing" is useful
    // repair metadata without exposing the plan's raw value in logs.
    receivedType: "input" in issue ? typeof issue.input : issue.code === "invalid_type" ? "missing" : null,
  }));
}

export function extractCeoStructuredPlan(raw: string) {
  const marker = String.fromCharCode(96).repeat(3);
  const trimmed = raw.trim().replace(new RegExp("^" + marker + "json\\s*", "i"), "").replace(new RegExp("\\s*" + marker + "$"), "");
  const start = trimmed.indexOf("{"); const end = trimmed.lastIndexOf("}");
  if (start < 0 || end < start) return { error: "CEO không trả về JSON kế hoạch.", issues: [] as CeoPlanValidationIssue[] } as const;
  try {
    const parsed: unknown = JSON.parse(trimmed.slice(start, end + 1));
    const result = ceoStructuredPlanSchema.safeParse(parsed);
    return result.success ? { plan: result.data } : { error: "JSON kế hoạch không hợp lệ: " + (result.error.issues[0]?.message ?? "schema error"), issues: issues(result.error) };
  } catch { return { error: "CEO trả về JSON không thể phân tích.", issues: [] as CeoPlanValidationIssue[] }; }
}
