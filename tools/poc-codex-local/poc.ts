import { Codex } from "@openai/codex-sdk";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const planSchema = z.object({
  objective: z.string().min(1),
  strategy: z.array(z.string().min(1)).min(1),
  tasks: z.array(z.object({ title: z.string().min(1), deliverable: z.string().min(1), estimatedHours: z.number().positive() })).min(1),
  kpis: z.array(z.object({ metric: z.string().min(1), target: z.string().min(1), measurementMethod: z.string().min(1) })).min(1),
  assumptions: z.array(z.string()),
});

const outputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["objective", "strategy", "tasks", "kpis", "assumptions"],
  properties: {
    objective: { type: "string" }, strategy: { type: "array", items: { type: "string" } }, assumptions: { type: "array", items: { type: "string" } },
    tasks: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "deliverable", "estimatedHours"], properties: { title: { type: "string" }, deliverable: { type: "string" }, estimatedHours: { type: "number" } } } },
    kpis: { type: "array", items: { type: "object", additionalProperties: false, required: ["metric", "target", "measurementMethod"], properties: { metric: { type: "string" }, target: { type: "string" }, measurementMethod: { type: "string" } } } },
  },
} as const;

const timeoutMs = 120_000;
const pocDirectory = dirname(fileURLToPath(import.meta.url));
const prompt = `Bạn là cố vấn lập kế hoạch kinh doanh cho Nova AI Solutions. Không dùng tool, không đọc hay sửa file. Chỉ trả về JSON hợp lệ theo schema đã cung cấp: lập kế hoạch 30 ngày để giới thiệu dịch vụ AI automation cho SME Việt Nam. Để PoC nhanh, trả đúng 1 strategy, 1 task, 1 KPI và 1 assumption. Không bịa ngân sách hoặc dữ liệu thị trường.`;

async function main() {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    console.error(JSON.stringify({ event: "poc.started", timeoutMs }));
    const codex = new Codex();
    const thread = codex.startThread({
      workingDirectory: pocDirectory,
      sandboxMode: "read-only",
      approvalPolicy: "never",
      skipGitRepoCheck: true,
    });
    const result = await thread.run(prompt, { outputSchema, signal: controller.signal });
    const raw = result.finalResponse;
    const parsed = planSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) throw new Error(`Structured output failed validation: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
    console.log(JSON.stringify({ ok: true, elapsedMs: Math.round(performance.now() - started), threadId: thread.id, plan: parsed.data }, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(JSON.stringify({ ok: false, elapsedMs: Math.round(performance.now() - started), error: message }));
    process.exitCode = 1;
  } finally { clearTimeout(timer); }
}

await main();
