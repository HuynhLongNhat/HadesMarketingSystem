import { z } from "zod";

const text = z.string().trim().min(1).max(4000);
const criterion = z.object({ score: z.number().min(0).max(25), comment: text, strengths: z.array(text), weaknesses: z.array(text), improvements: z.array(text) });
export const STRATEGIC_REVIEW_VERSION = "v1";
export const strategicReviewSchema = z.object({
  version: z.literal(STRATEGIC_REVIEW_VERSION), totalScore: z.number().min(0).max(100), classification: z.enum(["APPROVE_RECOMMENDED", "NEEDS_IMPROVEMENT", "MAJOR_REVISION", "REBUILD_RECOMMENDED"]),
  criteria: z.object({ feasibility: criterion, strategyQuality: criterion, resourceAllocation: criterion, riskManagement: criterion, kpis: criterion, logicConsistency: criterion }),
  criticalIssues: z.array(text), strengths: z.array(text), weaknesses: z.array(text), improvements: z.array(z.object({ priority: z.enum(["high", "medium", "low"]), recommendation: text })),
  conclusion: text, recommendation: text,
}).superRefine((report, context) => {
  const sum = Object.values(report.criteria).reduce((total, item) => total + item.score, 0);
  if (Math.abs(sum - report.totalScore) > 0.01) context.addIssue({ code: "custom", path: ["totalScore"], message: "Tổng điểm phải bằng tổng sáu tiêu chí." });
  const limits = { feasibility: 25, strategyQuality: 20, resourceAllocation: 15, riskManagement: 15, kpis: 15, logicConsistency: 10 } as const;
  for (const [key, limit] of Object.entries(limits)) if (report.criteria[key as keyof typeof limits].score > limit) context.addIssue({ code: "custom", path: ["criteria", key, "score"], message: `Điểm ${key} vượt giới hạn.` });
});
export type StrategicReview = z.infer<typeof strategicReviewSchema>;
export function extractStrategicReview(raw: string) { const start=raw.indexOf("{"),end=raw.lastIndexOf("}"); if(start<0||end<start)return { error:"Reviewer không trả JSON." } as const; try { const result=strategicReviewSchema.safeParse(JSON.parse(raw.slice(start,end+1))); return result.success?{report:result.data}:{error:`JSON đánh giá không hợp lệ: ${result.error.issues[0]?.message??"schema error"}`}; } catch { return { error:"Reviewer trả JSON không thể phân tích." }; } }
