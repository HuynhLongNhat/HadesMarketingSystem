import { z } from "zod";

const text = z.string().trim().min(1).max(4000);
export const CEO_STRUCTURED_PLAN_VERSION = "v3.1";
export const ceoStructuredPlanSchema = z.object({
  version: z.literal(CEO_STRUCTURED_PLAN_VERSION), objective: text, businessAnalysis: z.array(text).min(1), strategy: z.array(text).min(1), assumptions: z.array(text), risks: z.array(text),
  phases: z.array(z.object({ name: text, milestone: text, timeframe: text })).min(1),
  resourceAllocation: z.object({ summary: text, humanHoursAssumption: z.number().nonnegative().nullable(), aiSupportNotes: z.array(text) }),
  tasks: z.array(z.object({ id: text, title: text, description: text, deliverable: text, acceptanceCriteria: text, priority: z.enum(["high", "medium", "low"]), estimatedHours: z.number().positive(), dependencies: z.array(z.string().trim().min(1)), responsibleType: z.enum(["HUMAN", "EXISTING_AGENT", "PROPOSED_AGENT"]), agentId: z.string().uuid().nullable() })).min(1),
  agentRecommendations: z.array(z.object({ agentId: z.string().uuid().nullable(), name: text, rationale: text, status: z.enum(["EXISTING_AGENT", "PROPOSED_AGENT", "HUMAN"]), verifiedCapabilities: z.array(text) })),
  kpis: z.array(z.object({ metric: text, target: text, deadline: text, measurementMethod: text, relatedObjective: text })).min(1), feasibilityWarnings: z.array(text),
}).superRefine((plan, ctx) => { const ids = new Set(plan.tasks.map((task) => task.id)); for (const task of plan.tasks) { if (task.dependencies.some((id) => !ids.has(id))) ctx.addIssue({ code: "custom", path: ["tasks"], message: "Task dependency không tồn tại." }); if (task.responsibleType === "EXISTING_AGENT" && !task.agentId) ctx.addIssue({ code: "custom", path: ["tasks"], message: "EXISTING_AGENT cần agentId." }); if (task.responsibleType !== "EXISTING_AGENT" && task.agentId) ctx.addIssue({ code: "custom", path: ["tasks"], message: "Chỉ EXISTING_AGENT được có agentId." }); } });
export type CeoStructuredPlan = z.infer<typeof ceoStructuredPlanSchema>;
export function extractCeoStructuredPlan(raw: string) { const trimmed = raw.trim().replace(/^```json\s*/i, "").replace(/\s*```$/, ""); const start = trimmed.indexOf("{"); const end = trimmed.lastIndexOf("}"); if (start < 0 || end < start) return { error: "CEO không trả về JSON kế hoạch." } as const; try { const parsed: unknown = JSON.parse(trimmed.slice(start, end + 1)); const result = ceoStructuredPlanSchema.safeParse(parsed); return result.success ? { plan: result.data } : { error: `JSON kế hoạch không hợp lệ: ${result.error.issues[0]?.message ?? "schema error"}` }; } catch { return { error: "CEO trả về JSON không thể phân tích." }; } }
