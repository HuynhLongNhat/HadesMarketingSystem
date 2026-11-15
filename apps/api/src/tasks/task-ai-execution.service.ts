import { HttpException, Injectable, Logger } from "@nestjs/common";
import { and, desc, eq, gte, isNull, lt, ne, or, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import {
  aiProviderConnections,
  aiAgents,
  aiTaskEvents,
  aiTaskReportCitations,
  aiTaskResearchRuns,
  aiTaskResearchSources,
  aiTasks,
  businessDoctrines,
  ceoPlans,
  ceoPlanReviews,
  marketIntelligenceProjects,
  marketIntelligenceReports,
  db,
} from "@workspace/db/node";
import { decryptCredential } from "../ai-credentials/credential-crypto.js";
import { PROVIDER_REGISTRY } from "../ai-providers/provider-registry.js";
import { AiUsageQuotaService } from "../conversations/ai-usage-quota.service.js";
import { AiUsageRecorder } from "../conversations/ai-usage-recorder.js";
import type { AiTaskJobData } from "../jobs/jobs.service.js";
import { SearchProviderRuntimeService } from "../search-providers/search-provider-runtime.service.js";
import { SearchProviderRuntimeError } from "../search-providers/search-provider.adapter.js";
import { canAttemptTaskExecution, canWorkerClaimTask, MAX_TASK_EXECUTIONS } from "./task-execution-state.js";
import { extractCeoStructuredPlan, validateCeoPlanAgentReferences } from "../ceo-planning/ceo-structured-plan.js";
import { resolveGenerationSettings } from "./generation-settings.js";
import { extractStrategicReview } from "../ceo-planning/strategic-review.js";

const TIMEOUT_MS = 60_000;
const CEO_PLAN_TIMEOUT_MS = 180_000;
const MAX_OUTPUT_TOKENS = 2_000;
const CEO_PLAN_MAX_OUTPUT_TOKENS = 8_000;
const LEASE_MS = 90_000;
const LEASE_HEARTBEAT_MS = 20_000;

type Usage = { input?: unknown; output?: unknown; total?: unknown };
type Runtime = { provider: string; protocol: "openai" | "anthropic" | "google"; endpoint: string; apiKey: string; modelId: string };
type ResearchDecision = { useResearch: boolean; query: string | null; fallback: boolean };

export function isTruncatedFinishReason(value: unknown) {
  return typeof value === "string" && ["length", "max_tokens", "max_output_tokens", "MAX_TOKENS"].includes(value);
}

export class TaskProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly retryAfterSeconds: number | null = null,
    readonly kind: "PROVIDER_ERROR" | "PROVIDER_RATE_LIMITED" | "PROVIDER_TIMEOUT" | "STRUCTURED_OUTPUT_INVALID" | "AGENT_REFERENCE_INVALID" = "PROVIDER_ERROR",
  ) { super(message); }
}

const DEFAULT_RATE_LIMIT_RETRY_SECONDS = 60;
function retryAfterSeconds(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isInteger(seconds) && seconds > 0) return Math.min(seconds, 300);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  const remaining = Math.ceil((date - now) / 1_000);
  return remaining > 0 ? Math.min(remaining, 300) : null;
}

class TaskCancelledError extends Error {}
type ResearchEvidence = { query: string; provider: string; sources: Array<{ citationNumber: number; title: string; url: string; excerpt: string | null }> };

function token(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeError(error: unknown): string {
  if (error instanceof TaskProviderError) return error.message;
  return "Không thể hoàn tất nhiệm vụ do lỗi không xác định của AI Provider.";
}

/** Log enough to correlate an execution fault without ever serialising prompts or credentials. */
function safeExecutionFailure(error: unknown) {
  if (error instanceof TaskProviderError) return { kind: error.kind, retryable: error.retryable };
  if (error instanceof HttpException) return { kind: "http", status: error.getStatus() };
  if (error instanceof Error) return { kind: "internal", name: error.name || "Error" };
  return { kind: "internal", name: typeof error };
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

@Injectable()
export class TaskAiExecutionService {
  private readonly logger = new Logger(TaskAiExecutionService.name);
  constructor(private readonly usage: AiUsageRecorder, private readonly quota: AiUsageQuotaService, private readonly research?: SearchProviderRuntimeService) {}

  private prompt(task: { title: string; description: string; agentName: string | null; agentRole: string | null; agentSystemPrompt: string | null }, evidence?: ResearchEvidence) {
    const limitations = "MVP này KHÔNG có Web Search, dữ liệu Internet trực tiếp hoặc tool được tích hợp. Không được gọi, giả lập hoặc tuyên bố đã dùng tool/Web Search. Không được bịa số liệu, nguồn dẫn, thị phần, giá cả hoặc tuyên bố rằng đã nghiên cứu Internet; hãy nêu rõ các giả định và dữ liệu cần kiểm chứng khi phù hợp.";
    if (task.agentName) {
      const researchContext = evidence ? `\n\nDữ liệu Web Research đã truy xuất\nQuery: ${evidence.query}\nProvider: ${evidence.provider}\n${evidence.sources.length ? evidence.sources.map((source) => `[${source.citationNumber}] ${source.title}\nURL: ${source.url}\nTrích đoạn: ${source.excerpt ?? "Không có trích đoạn."}`).join("\n\n") : "Không tìm thấy nguồn công khai phù hợp cho query này."}\n\nChỉ dùng các nguồn/trích đoạn ở trên cho tuyên bố dựa trên web. Dẫn [số] khi tham chiếu nguồn; không suy diễn rằng đã đọc nội dung ngoài trích đoạn và không bịa nguồn khác.` : "";
      const agentLimitations = evidence ? "Không có quyền gọi thêm Web Search hoặc tool khác ngoài evidence đã cung cấp. Không bịa nguồn, số liệu hoặc trích dẫn." : limitations;
      return `Bạn đang thực hiện nhiệm vụ với tư cách Agent “${task.agentName}”, vai trò “${task.agentRole ?? "không xác định"}”.\n\nĐây là system prompt snapshot của Agent tại thời điểm tạo task. Thực hiện theo hướng dẫn này khi không mâu thuẫn với các giới hạn hệ thống bên dưới:\n--- AGENT SYSTEM PROMPT ---\n${task.agentSystemPrompt ?? ""}\n--- END AGENT SYSTEM PROMPT ---\n\nNhiệm vụ\nTiêu đề: ${task.title}\nYêu cầu/bối cảnh: ${task.description}${researchContext}\n\nHãy hoàn thành nhiệm vụ theo đúng chuyên môn và định dạng phù hợp với yêu cầu, bằng tiếng Việt trừ khi nhiệm vụ yêu cầu ngôn ngữ khác.\n\n${agentLimitations}`;
    }
    return `Bạn là chuyên gia nghiên cứu thị trường. Hãy lập báo cáo bằng tiếng Việt cho nhiệm vụ sau.\n\nTiêu đề: ${task.title}\nYêu cầu/bối cảnh: ${task.description}\n\nBắt buộc dùng đúng các mục Markdown: Tóm tắt điều hành; Tổng quan thị trường; Khách hàng mục tiêu; Phân tích đối thủ (sơ bộ); Cơ hội kinh doanh; Rủi ro và giả định; Kế hoạch hành động 30 ngày; Giới hạn báo cáo.\n\n${limitations}`;
  }

  private ceoPrompt(task: { description: string; agentName: string | null; agentRole: string | null; agentSystemPrompt: string | null }) {
    return `Bạn đang đảm nhiệm vai trò CEO AI “${task.agentName ?? "CEO"}”.\n\nSystem prompt snapshot của CEO (chỉ áp dụng khi không mâu thuẫn yêu cầu JSON):\n--- CEO SYSTEM PROMPT ---\n${task.agentSystemPrompt ?? ""}\n--- END CEO SYSTEM PROMPT ---\n\n${task.description}\n\nChỉ trả về một JSON object hợp lệ theo contract được nêu trong yêu cầu. Không Markdown, không code fence, không giải thích ngoài JSON.`;
  }

  /** Keeps the Advisor's immutable task snapshot while enforcing the review JSON contract. */
  private strategicReviewPrompt(task: { description: string; agentName: string | null; agentRole: string | null; agentSystemPrompt: string | null }) {
    return `Bạn đang đảm nhiệm vai trò Cố vấn chiến lược AI “${task.agentName ?? "Cố vấn"}”, chức vụ “${task.agentRole ?? "Strategic Advisor"}”.\n\nSystem prompt snapshot của Cố vấn (chỉ áp dụng khi không mâu thuẫn với yêu cầu JSON, bảo mật hoặc dữ liệu đã xác minh):\n--- ADVISOR SYSTEM PROMPT ---\n${task.agentSystemPrompt ?? ""}\n--- END ADVISOR SYSTEM PROMPT ---\n\n${task.description}\n\nChỉ trả về một JSON object hợp lệ theo contract đánh giá được nêu trong yêu cầu. Không Markdown, không code fence, không tự phê duyệt hoặc thực thi công việc.`;
  }

  private ceoRepairPrompt(raw: string, issues: Array<{ path: string; code: string; message: string; format: string | null; receivedType: string | null }>) {
    const safeIssues = issues.map((issue) => ({ path: issue.path, code: issue.code, message: issue.message, format: issue.format, receivedType: issue.receivedType }));
    return `Sửa đúng JSON kế hoạch CEO bên dưới để hợp lệ theo contract v3.1. Chỉ trả về JSON object đã sửa, không Markdown/code fence/giải thích. Giữ nguyên toàn bộ nội dung hợp lệ; chỉ bổ sung hoặc sửa field bị lỗi. Với KPI thiếu measurementMethod, nêu cách đo lường thực tế nhưng không bịa dữ liệu kinh doanh. Không đổi objective nếu không cần. Không tạo UUID/Agent ID; chỉ dùng TASK-xx và AGENT-xx đã có trong roster.\n\nValidation metadata: ${JSON.stringify(safeIssues)}\n\nJSON cần sửa:\n${raw}`;
  }

  private async event(taskId: string, organizationId: string, type: string, message: string) {
    await db.insert(aiTaskEvents).values({ id: randomUUID(), taskId, organizationId, type, message });
  }

  private renewLease(taskId: string, organizationId: string, token: string) {
    const leaseExpiresAt = new Date(Date.now() + LEASE_MS);
    return db.update(aiTasks).set({ leaseExpiresAt, updatedAt: new Date() }).where(and(eq(aiTasks.id, taskId), eq(aiTasks.organizationId, organizationId), eq(aiTasks.executionToken, token), eq(aiTasks.status, "running")));
  }

  private researchQuery(task: typeof aiTasks.$inferSelect) {
    return `${task.title}\n${task.description}`.replace(/\s+/g, " ").trim().slice(0, 500);
  }

  private async hasClaim(task: typeof aiTasks.$inferSelect, executionToken: string) {
    const [owned] = await db.select({ id: aiTasks.id }).from(aiTasks).where(and(eq(aiTasks.id, task.id), eq(aiTasks.organizationId, task.organizationId), eq(aiTasks.status, "running"), eq(aiTasks.executionToken, executionToken))).limit(1);
    return Boolean(owned);
  }

  private safeResearchError(error: unknown) {
    if (error instanceof SearchProviderRuntimeError) return { code: error.code, retryable: error.code === "SEARCH_PROVIDER_RATE_LIMITED" || error.code === "SEARCH_PROVIDER_TIMEOUT" || error.code === "SEARCH_PROVIDER_UNAVAILABLE", message: error.code === "SEARCH_PROVIDER_AUTH_FAILED" ? "Credential Tavily không hợp lệ hoặc đã bị từ chối." : error.code === "SEARCH_PROVIDER_RATE_LIMITED" ? "Tavily đang giới hạn lượt tìm kiếm." : error.code === "SEARCH_PROVIDER_TIMEOUT" ? "Tavily hết thời gian phản hồi." : "Không thể hoàn tất tìm kiếm Web Research." };
    if (error instanceof HttpException) {
      const response = error.getResponse();
      const detail = typeof response === "object" && response !== null ? response as { code?: unknown; message?: unknown } : {};
      const message = typeof detail.message === "string" ? detail.message : error.message;
      return { code: typeof detail.code === "string" ? detail.code : "RESEARCH_POLICY_ERROR", retryable: false, message };
    }
    return { code: "RESEARCH_EXECUTION_ERROR", retryable: false, message: "Không thể hoàn tất tìm kiếm Web Research." };
  }

  private async webResearch(task: typeof aiTasks.$inferSelect, executionToken: string, requestedQuery?: string, forceNew = false): Promise<ResearchEvidence> {
    if (!task.agentId || !this.research) throw new TaskProviderError("Task Web Research yêu cầu Agent và Search Provider runtime.", false);
    const [completedRun] = await db.select().from(aiTaskResearchRuns).where(and(eq(aiTaskResearchRuns.taskId, task.id), eq(aiTaskResearchRuns.organizationId, task.organizationId), eq(aiTaskResearchRuns.status, "completed"))).orderBy(desc(aiTaskResearchRuns.createdAt)).limit(1);
    if (completedRun && !forceNew) {
      const sources = await db.select({ title: aiTaskResearchSources.title, url: aiTaskResearchSources.displayUrl, excerpt: aiTaskResearchSources.excerpt, citationNumber: aiTaskReportCitations.citationNumber }).from(aiTaskResearchSources).leftJoin(aiTaskReportCitations, and(eq(aiTaskReportCitations.sourceId, aiTaskResearchSources.id), eq(aiTaskReportCitations.taskId, task.id), eq(aiTaskReportCitations.organizationId, task.organizationId))).where(and(eq(aiTaskResearchSources.taskId, task.id), eq(aiTaskResearchSources.organizationId, task.organizationId))).orderBy(aiTaskResearchSources.ordinal);
      return { query: completedRun.query ?? this.researchQuery(task), provider: completedRun.provider, sources: sources.map((source, index) => ({ ...source, citationNumber: source.citationNumber ?? index + 1 })) };
    }
    const query = requestedQuery?.trim().slice(0, 500) || this.researchQuery(task);
    const runId = randomUUID();
    const now = new Date();
    await db.insert(aiTaskResearchRuns).values({ id: runId, organizationId: task.organizationId, taskId: task.id, provider: task.researchProvider ?? "tavily", query, status: "running", queryCount: 1, requestCount: 1, startedAt: now, updatedAt: now });
    await this.event(task.id, task.organizationId, "research_started", `Worker đang tìm kiếm Web Research với Tavily: ${query}`);
    try {
      const response = await this.research.searchForResearch({ organizationId: task.organizationId, userId: task.createdBy, sessionId: `ai-task-${task.id}`, role: "owner" }, { agentId: task.agentId, request: { query, searchDepth: "basic", maxResults: 5 } });
      if (!await this.hasClaim(task, executionToken)) throw new TaskCancelledError();
      const existing = await db.select({ id: aiTaskResearchSources.id }).from(aiTaskResearchSources).where(and(eq(aiTaskResearchSources.taskId, task.id), eq(aiTaskResearchSources.organizationId, task.organizationId)));
      const seenUrls = new Set<string>();
      const sources: Array<typeof aiTaskResearchSources.$inferInsert> = [];
      for (const source of response.results) {
        try {
          const parsed = new URL(source.url);
          if (parsed.protocol !== "https:" && parsed.protocol !== "http:") continue;
          const canonicalUrl = parsed.toString().slice(0, 2048);
          if (seenUrls.has(canonicalUrl)) continue;
          seenUrls.add(canonicalUrl);
          const excerpt = source.snippet?.trim().slice(0, 12000) || null;
          sources.push({ id: randomUUID(), organizationId: task.organizationId, taskId: task.id, researchRunId: runId, ordinal: existing.length + sources.length + 1, canonicalUrl, displayUrl: source.url.trim().slice(0, 2048), title: source.title.trim().slice(0, 512) || parsed.hostname, domain: parsed.hostname.slice(0, 253), excerpt, contentHash: excerpt ? createHash("sha256").update(excerpt).digest("hex") : null, status: "retrieved", retrievedAt: new Date() });
        } catch { /* Discard malformed provider URLs. */ }
      }
      await db.transaction(async (tx) => {
        if (sources.length) await tx.insert(aiTaskResearchSources).values(sources);
        if (sources.length) await tx.insert(aiTaskReportCitations).values(sources.map((source) => ({ id: randomUUID(), organizationId: task.organizationId, taskId: task.id, sourceId: source.id, citationNumber: source.ordinal })));
        await tx.update(aiTaskResearchRuns).set({ provider: response.provider, status: "completed", sourceCount: sources.length, completedAt: new Date(), updatedAt: new Date(), safeErrorCode: null }).where(and(eq(aiTaskResearchRuns.id, runId), eq(aiTaskResearchRuns.organizationId, task.organizationId), eq(aiTaskResearchRuns.taskId, task.id)));
      });
      await this.event(task.id, task.organizationId, "research_completed", sources.length ? `Web Research hoàn tất: đã lưu ${sources.length} nguồn.` : "Web Research hoàn tất nhưng không tìm thấy nguồn phù hợp.");
      return { query, provider: response.provider, sources: sources.map((source) => ({ citationNumber: source.ordinal, title: source.title, url: source.displayUrl, excerpt: source.excerpt ?? null })) };
    } catch (error) {
      if (error instanceof TaskCancelledError) {
        await db.update(aiTaskResearchRuns).set({ status: "cancelled", completedAt: new Date(), updatedAt: new Date() }).where(and(eq(aiTaskResearchRuns.id, runId), eq(aiTaskResearchRuns.organizationId, task.organizationId)));
        throw error;
      }
      const safe = this.safeResearchError(error);
      await db.update(aiTaskResearchRuns).set({ status: "failed", safeErrorCode: safe.code, completedAt: new Date(), updatedAt: new Date() }).where(and(eq(aiTaskResearchRuns.id, runId), eq(aiTaskResearchRuns.organizationId, task.organizationId)));
      await this.event(task.id, task.organizationId, "research_failed", safe.message);
      throw new TaskProviderError(safe.message, safe.retryable);
    }
  }

  private marketQueries(project: { industry: string; market: string; objective: string; keywords: unknown }) {
    const keywords = Array.isArray(project.keywords) ? project.keywords.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 2) : [];
    return [...new Set([`${project.industry} ${project.market} ${project.objective}`, ...keywords.map((keyword) => `${keyword} ${project.market}`)].map((query) => query.replace(/\s+/g, " ").trim().slice(0, 500)).filter(Boolean))].slice(0, 3);
  }

  private marketIntelligencePrompt(project: { industry: string; market: string; objective: string }, evidence: ResearchEvidence[]) {
    const sources = evidence.flatMap((run) => run.sources.map((source) => `[${source.citationNumber}] ${source.title}\n${source.url}\n${source.excerpt ?? ""}`)).join("\n\n");
    return `Bạn là Intelligence Manager. Viết báo cáo tình báo thị trường bằng tiếng Việt dựa CHỈ trên evidence. Không bịa dữ liệu, nguồn hay thống kê. Phân biệt Dữ kiện có bằng chứng, Nhận định suy luận và Giả thuyết cần kiểm chứng. Mỗi kết luận có nguồn phải dùng [số].\n\nNgành: ${project.industry}\nThị trường: ${project.market}\nMục tiêu: ${project.objective}\n\nBắt buộc gồm: # Tóm tắt; ## Dữ kiện và xu hướng; ## Nhu cầu và nỗi đau khách hàng; ## Cơ hội kinh doanh; ## Giả thuyết cần kiểm chứng; ## Giới hạn nghiên cứu; ## Nguồn tham khảo.\n\nEvidence:\n${sources || "Không có nguồn phù hợp; nêu rõ giới hạn nghiên cứu."}`;
  }

  private async runtime(task: typeof aiTasks.$inferSelect): Promise<Runtime> {
    // Agent tasks always use the immutable connection/model captured at creation.
    // A malformed snapshot is a configuration error, never a fallback to General.
    if (task.agentName && (!task.agentConnectionId || !task.agentModelId || task.connectionId !== task.agentConnectionId || task.modelId !== task.agentModelId)) {
      throw new TaskProviderError("Task có snapshot cấu hình Agent không hợp lệ.", false);
    }
    if (!task.connectionId || !task.modelId) throw new TaskProviderError("Task thiếu cấu hình AI Provider.", false);
    const [connection] = await db.select().from(aiProviderConnections).where(and(eq(aiProviderConnections.organizationId, task.organizationId), eq(aiProviderConnections.id, task.connectionId), eq(aiProviderConnections.enabled, true))).limit(1);
    if (!connection) throw new TaskProviderError("AI Provider đã cấu hình không khả dụng.", false);
    const definition = PROVIDER_REGISTRY[connection.provider];
    if (!definition?.baseUrl || definition.runtimeProtocol === "ollama") throw new TaskProviderError("AI Provider này chưa có endpoint runtime được cấu hình.", false);
    let apiKey: string;
    try {
      apiKey = decryptCredential({ encryptedApiKey: connection.encryptedApiKey, keyIv: connection.keyIv, keyAuthTag: connection.keyAuthTag, keyVersion: "v1" }, { organizationId: task.organizationId, connectionId: connection.id, provider: connection.provider });
    } catch { throw new TaskProviderError("Không thể giải mã credential của AI Provider.", false); }
    if (!apiKey.trim()) throw new TaskProviderError("API key của AI Provider trống.", false);
    const endpoint = definition.baseUrl.replace(/\/$/, "");
    if (definition.runtimeProtocol === "openai") return { provider: connection.provider, protocol: "openai", endpoint: `${endpoint}/chat/completions`, apiKey, modelId: task.modelId };
    if (definition.runtimeProtocol === "anthropic") return { provider: connection.provider, protocol: "anthropic", endpoint: `${endpoint}/messages`, apiKey, modelId: task.modelId };
    return { provider: connection.provider, protocol: "google", endpoint: `${endpoint}/models/${encodeURIComponent(task.modelId)}:generateContent`, apiKey, modelId: task.modelId };
  }

  private async request(runtime: Runtime, prompt: string, maxOutputTokens = MAX_OUTPUT_TOKENS, timeoutMs = TIMEOUT_MS): Promise<{ text: string; usage: Usage }> {
    const started = Date.now();
    let response: Response;
    try {
      if (runtime.protocol === "anthropic") {
        response = await fetch(runtime.endpoint, { method: "POST", headers: { "x-api-key": runtime.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }, body: JSON.stringify({ model: runtime.modelId, max_tokens: maxOutputTokens, temperature: 0.3, messages: [{ role: "user", content: prompt }] }), signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
      } else if (runtime.protocol === "google") {
        response = await fetch(runtime.endpoint, { method: "POST", headers: { "x-goog-api-key": runtime.apiKey, "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens } }), signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
      } else {
        response = await fetch(runtime.endpoint, { method: "POST", headers: { Authorization: `Bearer ${runtime.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: runtime.modelId, temperature: 0.3, max_completion_tokens: maxOutputTokens, messages: [{ role: "system", content: "Trả lời chính xác theo yêu cầu, không bịa dữ liệu." }, { role: "user", content: prompt }] }), signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
      }
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      const timedOut = name === "TimeoutError" || name === "AbortError";
      this.logger.warn(JSON.stringify({ event: "ai_provider.response_error", provider: runtime.provider, category: timedOut ? "request_timeout" : "network_error", exception: name || "unknown", durationMs: Date.now() - started }));
      throw new TaskProviderError(timedOut ? "AI Provider hết thời gian phản hồi." : "Không thể kết nối AI Provider.", true, null, timedOut ? "PROVIDER_TIMEOUT" : "PROVIDER_ERROR");
    }
    if (!response.ok) {
      const retryAfter = response.status === 429 ? retryAfterSeconds(response.headers.get("retry-after")) : null;
      this.logger.warn(JSON.stringify({ event: "ai_provider.response_error", provider: runtime.provider, category: "http_error", status: response.status, contentType: response.headers.get("content-type"), requestId: response.headers.get("x-request-id") ?? response.headers.get("x-openrouter-request-id") ?? null, retryAfterSeconds: retryAfter }));
      await response.body?.cancel();
      if (response.status === 429) {
        const waitSeconds = retryAfter ?? DEFAULT_RATE_LIMIT_RETRY_SECONDS;
        throw new TaskProviderError(`AI Provider đang giới hạn lượt gọi. Hãy thử lại sau ít nhất ${waitSeconds} giây.`, true, waitSeconds, "PROVIDER_RATE_LIMITED");
      }
      throw new TaskProviderError(`AI Provider trả về HTTP ${response.status}.`, isRetryableStatus(response.status));
    }
    let body: { choices?: Array<{ message?: { content?: string }; finish_reason?: unknown }>; content?: Array<{ text?: string }>; stop_reason?: unknown; usage?: { input_tokens?: unknown; output_tokens?: unknown; prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown }; usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown; totalTokenCount?: unknown }; candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: unknown }> };
    try {
      body = await response.json() as typeof body;
    } catch (error) {
      const name = error instanceof Error ? error.name : "unknown";
      const category = name === "TimeoutError" || name === "AbortError" ? "response_timeout" : name === "SyntaxError" ? "json_parse_failure" : "body_read_failure";
      this.logger.warn(JSON.stringify({ event: "ai_provider.response_error", provider: runtime.provider, category, status: response.status, contentType: response.headers.get("content-type"), requestId: response.headers.get("x-request-id") ?? response.headers.get("x-openrouter-request-id") ?? null, exception: name, durationMs: Date.now() - started }));
      throw new TaskProviderError(category === "response_timeout" ? "AI Provider hết thời gian đọc phản hồi." : category === "json_parse_failure" ? "AI Provider trả về JSON không hợp lệ." : "Không thể đọc phản hồi từ AI Provider.", true, null, category === "response_timeout" ? "PROVIDER_TIMEOUT" : "PROVIDER_ERROR");
    }
    const text = runtime.protocol === "anthropic" ? body.content?.map((part) => part.text ?? "").join("") : runtime.protocol === "google" ? body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") : body.choices?.[0]?.message?.content;
    if (!text?.trim()) {
      this.logger.warn(JSON.stringify({ event: "ai_provider.response_error", provider: runtime.provider, category: "empty_content", status: response.status, contentType: response.headers.get("content-type"), requestId: response.headers.get("x-request-id") ?? response.headers.get("x-openrouter-request-id") ?? null }));
      throw new TaskProviderError("AI Provider trả về JSON hợp lệ nhưng không có nội dung model.", false);
    }
    const finishReason = runtime.protocol === "anthropic" ? body.stop_reason : runtime.protocol === "google" ? body.candidates?.[0]?.finishReason : body.choices?.[0]?.finish_reason;
    const usage = runtime.protocol === "google" ? { input: body.usageMetadata?.promptTokenCount, output: body.usageMetadata?.candidatesTokenCount, total: body.usageMetadata?.totalTokenCount } : { input: body.usage?.input_tokens ?? body.usage?.prompt_tokens, output: body.usage?.output_tokens ?? body.usage?.completion_tokens, total: body.usage?.total_tokens };
    this.logger.log(JSON.stringify({ event: "ai_provider.completion_metadata", provider: runtime.provider, modelId: runtime.modelId, finishReason: typeof finishReason === "string" ? finishReason : null, promptTokens: token(usage.input), completionTokens: token(usage.output), totalTokens: token(usage.total), requestedMaxCompletionTokens: maxOutputTokens }));
    if (isTruncatedFinishReason(finishReason)) throw new TaskProviderError("AI Provider đã dừng output vì giới hạn token; kế hoạch/báo cáo chưa hoàn chỉnh. Hãy rút gọn yêu cầu hoặc dùng model có output limit lớn hơn.", false);
    return { text: text.trim(), usage };
  }

  private parseResearchDecision(value: string, task: typeof aiTasks.$inferSelect): ResearchDecision {
    try {
      const parsed = JSON.parse(value.replace(/^```json\s*|\s*```$/g, "").trim()) as { use_web_research?: unknown; query?: unknown };
      if (typeof parsed.use_web_research !== "boolean") throw new Error("invalid");
      const query = typeof parsed.query === "string" && parsed.query.trim() ? parsed.query.trim().slice(0, 500) : null;
      return { useResearch: parsed.use_web_research, query: parsed.use_web_research ? query ?? this.researchQuery(task) : null, fallback: false };
    } catch { return { useResearch: false, query: null, fallback: true }; }
  }

  private async decideResearch(runtime: Runtime, task: typeof aiTasks.$inferSelect): Promise<ResearchDecision> {
    const instruction = `Decide whether this task requires current public web information. Return JSON only: {"use_web_research":boolean,"query":string|null}. Use web research only when current, externally verifiable information is necessary; do not use it for writing, editing, reasoning, or user-provided content.\nTitle: ${task.title}\nRequest: ${task.description}`;
    if (runtime.protocol === "openai") {
      try {
        const response = await fetch(runtime.endpoint, { method: "POST", headers: { Authorization: `Bearer ${runtime.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: runtime.modelId, temperature: 0, messages: [{ role: "system", content: "You decide whether to use the provided web research tool." }, { role: "user", content: instruction }], tools: [{ type: "function", function: { name: "web_research", description: "Search public web sources when current evidence is required.", parameters: { type: "object", additionalProperties: false, properties: { query: { type: "string" } }, required: ["query"] } } }], tool_choice: "auto" }), signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" });
        if (response.ok) {
          const body = await response.json() as { choices?: Array<{ message?: { tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>; content?: string } }> };
          const message = body.choices?.[0]?.message;
          const tool = message?.tool_calls?.find((call) => call.function?.name === "web_research");
          if (tool) {
            try { const args = JSON.parse(tool.function?.arguments ?? "{}") as { query?: unknown }; const query = typeof args.query === "string" && args.query.trim() ? args.query.trim().slice(0, 500) : this.researchQuery(task); return { useResearch: true, query, fallback: false }; }
            catch { return { useResearch: false, query: null, fallback: true }; }
          }
          if (message?.content) return this.parseResearchDecision(message.content, task);
          return { useResearch: false, query: null, fallback: false };
        }
        if (response.status >= 500 || response.status === 429 || response.status === 408) throw new TaskProviderError(`AI Provider trả về HTTP ${response.status}.`, true);
        await response.body?.cancel();
      } catch (error) { if (error instanceof TaskProviderError) throw error; }
    }
    const fallback = await this.request(runtime, instruction);
    return this.parseResearchDecision(fallback.text, task);
  }

  async execute(data: AiTaskJobData, attempt: number, finalAttempt: boolean): Promise<void> {
    const [task] = await db.select().from(aiTasks).where(and(eq(aiTasks.id, data.taskId), eq(aiTasks.organizationId, data.organizationId))).limit(1);
    // A delayed or retried BullMQ job must never resurrect a terminal task.
    if (!task || !canWorkerClaimTask(task.status)) return;
    if (!canAttemptTaskExecution(task.attemptCount)) {
      const [exhausted] = await db.update(aiTasks).set({ status: "failed", error: "Task đã vượt số lần thực thi tối đa.", executionToken: null, leaseExpiresAt: null, completedAt: new Date(), updatedAt: new Date() }).where(and(eq(aiTasks.id, task.id), eq(aiTasks.organizationId, task.organizationId), eq(aiTasks.status, "queued"), gte(aiTasks.attemptCount, MAX_TASK_EXECUTIONS))).returning({ id: aiTasks.id });
      if (exhausted) await this.event(task.id, task.organizationId, "failed", "Task đã vượt số lần thực thi tối đa.");
      return;
    }
    const started = Date.now();
    const executionToken = randomUUID();
    const now = new Date();
    const claimed = await db.update(aiTasks).set({ status: "running", executionToken, leaseExpiresAt: new Date(now.getTime() + LEASE_MS), attemptCount: sql`${aiTasks.attemptCount} + 1`, startedAt: task.startedAt ?? now, error: null, updatedAt: now }).where(and(
      eq(aiTasks.id, task.id),
      eq(aiTasks.organizationId, task.organizationId),
      lt(aiTasks.attemptCount, MAX_TASK_EXECUTIONS),
      or(
        eq(aiTasks.status, "queued"),
        and(eq(aiTasks.status, "running"), or(isNull(aiTasks.leaseExpiresAt), lt(aiTasks.leaseExpiresAt, now))),
      ),
    )).returning({ id: aiTasks.id });
    // Cancellation can race with a Worker that already read the task.
    // Do not send a chargeable provider request unless this Worker claimed it.
    if (!claimed.length) return;
    await this.event(task.id, task.organizationId, "running", task.agentName ? `Worker đang thực thi nhiệm vụ của Agent ${task.agentName} (lần thử ${attempt}).` : `Worker đang tạo báo cáo (lần thử ${attempt}).`);
    const heartbeat = setInterval(() => {
      void this.renewLease(task.id, task.organizationId, executionToken).catch(() => {
        this.logger.warn(`Could not renew AI task lease: ${task.id}`);
      });
    }, LEASE_HEARTBEAT_MS);
    heartbeat.unref();
    let runtime: Runtime | null = null;
    const reservationIds: string[] = [];
    const usageEntries: Array<{ usage: Usage; purpose: string }> = [];
    let usageReliable = true;
    try {
      runtime = await this.runtime(task);
      let evidence: ResearchEvidence | undefined;
      const [marketProject] = await db.select().from(marketIntelligenceProjects).where(and(eq(marketIntelligenceProjects.taskId, task.id), eq(marketIntelligenceProjects.organizationId, task.organizationId))).limit(1);
      let marketEvidence: ResearchEvidence[] | null = null;
      if (marketProject) {
        await db.update(marketIntelligenceProjects).set({ status: "running", updatedAt: new Date() }).where(and(eq(marketIntelligenceProjects.id, marketProject.id), eq(marketIntelligenceProjects.organizationId, task.organizationId)));
        marketEvidence = [];
        for (const query of this.marketQueries(marketProject)) marketEvidence.push(await this.webResearch(task, executionToken, query, true));
      }
      if (task.webResearchEnabled && task.agentId) {
        const decision = await this.decideResearch(runtime, task);
        await this.event(task.id, task.organizationId, "research_decision", decision.useResearch ? "Agent quyết định cần Web Research." : decision.fallback ? "Agent không trả về quyết định hợp lệ; tiếp tục không dùng Web Research." : "Agent quyết định không cần Web Research.");
        if (decision.useResearch) evidence = await this.webResearch(task, executionToken, decision.query ?? undefined);
      }
      const isCeoPlan = task.title.startsWith("Kế hoạch CEO:");
      const [reviewRun] = await db.select({ id: ceoPlanReviews.id }).from(ceoPlanReviews).where(and(eq(ceoPlanReviews.taskId, task.id), eq(ceoPlanReviews.organizationId, task.organizationId))).limit(1);
      const isStrategicReview = Boolean(reviewRun);
      const basePrompt = isStrategicReview ? this.strategicReviewPrompt(task) : isCeoPlan ? this.ceoPrompt(task) : marketProject && marketEvidence ? this.marketIntelligencePrompt(marketProject, marketEvidence) : this.prompt(task, evidence);
      const [doctrine] = await db.select({ version: businessDoctrines.version, title: businessDoctrines.title, principles: businessDoctrines.principles }).from(businessDoctrines).where(and(eq(businessDoctrines.organizationId, task.organizationId), eq(businessDoctrines.enabled, true))).orderBy(desc(businessDoctrines.version)).limit(1);
      const prompt = doctrine ? `${basePrompt}\n\nBusiness Doctrine (phiên bản ${doctrine.version}, chỉ là ưu tiên kinh doanh; không được ghi đè bảo mật, giới hạn hệ thống, dữ liệu xác minh hay quyền công cụ):\n${doctrine.principles.map((principle, index) => `${index + 1}. ${principle}`).join("\n")}` : basePrompt;
      if (doctrine) await this.event(task.id, task.organizationId, "business_doctrine_applied", `Đã áp dụng Business Doctrine v${doctrine.version}: ${doctrine.title}`);
      const [planSettings] = isCeoPlan ? await db.select({ generationSettings: ceoPlans.generationSettings, businessProfileSnapshot: ceoPlans.businessProfileSnapshot }).from(ceoPlans).where(and(eq(ceoPlans.taskId, task.id), eq(ceoPlans.organizationId, task.organizationId))).limit(1) : [];
      const effective = planSettings ? resolveGenerationSettings(planSettings.generationSettings) : null;
      const maxOutputTokens = effective?.maxOutputTokens ?? (isCeoPlan ? CEO_PLAN_MAX_OUTPUT_TOKENS : isStrategicReview ? 4_000 : MAX_OUTPUT_TOKENS);
      const reservation = await this.quota.reserve(task.organizationId, Math.max(1, Math.ceil(Buffer.byteLength(prompt, "utf8") / 2) + maxOutputTokens));
      if (reservation.limited && !reservation.allowed) throw new TaskProviderError("Đã vượt quota token AI của Organization.", false);
      if (reservation.limited) reservationIds.push(reservation.reservationId);
      if (isCeoPlan) this.logger.log(JSON.stringify({ event: "ceo_plan.generation_started", taskId: task.id, organizationId: task.organizationId }));
      let result = await this.request(runtime, prompt, maxOutputTokens, (effective?.timeoutSeconds ?? (isCeoPlan ? CEO_PLAN_TIMEOUT_MS / 1000 : TIMEOUT_MS / 1000)) * 1000);
      usageEntries.push({ usage: result.usage, purpose: isCeoPlan ? "ceo_planning_generation" : isStrategicReview ? "strategic_review" : "market_research_task" });
      if (isCeoPlan) {
        let structured = extractCeoStructuredPlan(result.text);
        if ("error" in structured) {
          this.logger.warn(JSON.stringify({ event: "ceo_plan.validation_failed", taskId: task.id, organizationId: task.organizationId, issues: structured.issues ?? [] }));
          await this.event(task.id, task.organizationId, "ceo_plan_validation_failed", "Kế hoạch CEO cần sửa định dạng JSON; đang thực hiện một lần sửa tự động.");
          this.logger.log(JSON.stringify({ event: "ceo_plan.repair_started", taskId: task.id, organizationId: task.organizationId }));
          const repairPrompt = this.ceoRepairPrompt(result.text, structured.issues ?? []);
          const repairMaxOutputTokens = Math.min(maxOutputTokens, 4_000);
          const repairReservation = await this.quota.reserve(task.organizationId, Math.max(1, Math.ceil(Buffer.byteLength(repairPrompt, "utf8") / 2) + repairMaxOutputTokens));
          if (repairReservation.limited && !repairReservation.allowed) throw new TaskProviderError("Không đủ quota token AI để sửa JSON kế hoạch CEO.", false, null, "STRUCTURED_OUTPUT_INVALID");
          if (repairReservation.limited) reservationIds.push(repairReservation.reservationId);
          try {
            result = await this.request(runtime, repairPrompt, repairMaxOutputTokens, (effective?.timeoutSeconds ?? CEO_PLAN_TIMEOUT_MS / 1000) * 1000);
          } catch (error) {
            this.logger.warn(JSON.stringify({ event: "ceo_plan.repair_failed", taskId: task.id, organizationId: task.organizationId, ...safeExecutionFailure(error) }));
            throw error;
          }
          usageEntries.push({ usage: result.usage, purpose: "ceo_planning_repair" });
          structured = extractCeoStructuredPlan(result.text);
          if ("error" in structured) {
            this.logger.warn(JSON.stringify({ event: "ceo_plan.repair_failed", taskId: task.id, organizationId: task.organizationId, issues: structured.issues }));
            throw new TaskProviderError(`CEO chưa tạo kế hoạch có cấu trúc sau khi sửa: ${structured.error}`, false, null, "STRUCTURED_OUTPUT_INVALID");
          }
          this.logger.log(JSON.stringify({ event: "ceo_plan.repair_succeeded", taskId: task.id, organizationId: task.organizationId }));
        }
        const snapshotAgents = ((planSettings?.businessProfileSnapshot as { agents?: Array<{ id?: string; ref?: string; status?: string }> } | null)?.agents) ?? [];
        const organizationAgents = await db.select({ id: aiAgents.id, status: aiAgents.status }).from(aiAgents).where(eq(aiAgents.organizationId, task.organizationId)).limit(100);
        const currentStatus = new Map(organizationAgents.map((agent) => [agent.id, agent.status]));
        const validatedAgents = [
          ...snapshotAgents.map((agent) => ({ ...agent, status: agent.id ? currentStatus.get(agent.id) ?? "archived" : agent.status })),
          ...organizationAgents.filter((agent) => !snapshotAgents.some((snapshot) => snapshot.id === agent.id)),
        ];
        const referenceError = validateCeoPlanAgentReferences(structured.plan, validatedAgents);
        if (referenceError) {
          this.logger.warn(JSON.stringify({ event: "ceo_structured_plan.agent_reference_failed", taskId: task.id, organizationId: task.organizationId, category: "agent_reference" }));
          throw new TaskProviderError(`CEO chưa tạo kế hoạch có cấu trúc: ${referenceError}`, false, null, "AGENT_REFERENCE_INVALID");
        }
        const [stored] = await db.update(ceoPlans).set({ structuredPlan: structured.plan, structuredPlanVersion: structured.plan.version, updatedAt: new Date() }).where(and(eq(ceoPlans.taskId, task.id), eq(ceoPlans.organizationId, task.organizationId))).returning({ id: ceoPlans.id });
        if (!stored) throw new TaskProviderError("Không tìm thấy kế hoạch CEO để lưu JSON có cấu trúc.", false);
      }
      if (isStrategicReview) {
        const review = extractStrategicReview(result.text);
        if ("error" in review) throw new TaskProviderError(`Strategic Reviewer chưa tạo báo cáo hợp lệ: ${review.error}`, false, null, "STRUCTURED_OUTPUT_INVALID");
        const [stored] = await db.update(ceoPlanReviews).set({ report: review.report, reportVersion: review.report.version, reviewedAt: new Date(), updatedAt: new Date() }).where(and(eq(ceoPlanReviews.id, reviewRun!.id), eq(ceoPlanReviews.organizationId, task.organizationId), eq(ceoPlanReviews.taskId, task.id))).returning({ id: ceoPlanReviews.id });
        if (!stored) throw new TaskProviderError("Không thể lưu báo cáo Strategic Reviewer.", false);
        await this.event(task.id, task.organizationId, "strategic_review_completed", "Strategic Reviewer đã hoàn tất đánh giá.");
      }
      if (marketProject) {
        await db.insert(marketIntelligenceReports).values({ id: randomUUID(), organizationId: task.organizationId, projectId: marketProject.id, taskId: task.id, content: result.text }).onConflictDoUpdate({ target: marketIntelligenceReports.projectId, set: { content: result.text } });
        await db.update(marketIntelligenceProjects).set({ status: "completed", updatedAt: new Date() }).where(and(eq(marketIntelligenceProjects.id, marketProject.id), eq(marketIntelligenceProjects.organizationId, task.organizationId)));
      }
      const completed = await db.update(aiTasks).set({ status: "completed", result: result.text, error: null, executionToken: null, leaseExpiresAt: null, completedAt: new Date(), updatedAt: new Date() }).where(and(eq(aiTasks.id, task.id), eq(aiTasks.organizationId, task.organizationId), eq(aiTasks.executionToken, executionToken), ne(aiTasks.status, "cancelled"))).returning({ id: aiTasks.id });
      if (completed.length) {
        // Record only after the terminal state is stored. A BullMQ retry will
        // then observe `completed` and cannot create a duplicate usage entry.
        usageReliable = (await Promise.all(usageEntries.map((entry) => this.usage.record({ organizationId: task.organizationId, provider: runtime!.provider, modelId: runtime!.modelId, purpose: entry.purpose, status: "success", inputTokens: token(entry.usage.input), outputTokens: token(entry.usage.output), totalTokens: token(entry.usage.total), latencyMs: Date.now() - started })))).every(Boolean);
        if (isCeoPlan) this.logger.log(JSON.stringify({ event: "ceo_plan.generation_completed", taskId: task.id, organizationId: task.organizationId, repaired: usageEntries.length > 1 }));
        await this.event(task.id, task.organizationId, "completed", task.agentName ? `Nhiệm vụ của Agent ${task.agentName} đã hoàn tất.` : "Báo cáo nghiên cứu thị trường đã hoàn tất.");
      } else {
        // The provider may already have charged the request, but this Worker
        // lost its lease (for example to cancellation or recovery). Retain
        // the reservation because no reliable usage record can be written.
        usageReliable = false;
      }
    } catch (error) {
      if (error instanceof TaskCancelledError) {
        usageReliable = false;
        await db.update(marketIntelligenceProjects).set({ status: "cancelled", updatedAt: new Date() }).where(and(eq(marketIntelligenceProjects.taskId, task.id), eq(marketIntelligenceProjects.organizationId, task.organizationId), eq(marketIntelligenceProjects.status, "running")));
        return;
      }
      // A Market Intelligence Project is only a Task projection. Keep its
      // visible lifecycle aligned with the authoritative Task terminal state.
      await db.update(marketIntelligenceProjects).set({ status: "failed", updatedAt: new Date() }).where(and(eq(marketIntelligenceProjects.taskId, task.id), eq(marketIntelligenceProjects.organizationId, task.organizationId), eq(marketIntelligenceProjects.status, "running")));
      const message = safeError(error);
      this.logger.error(JSON.stringify({
        event: "ai_task.execution_failed",
        taskId: task.id,
        organizationId: task.organizationId,
        attempt,
        ...safeExecutionFailure(error),
      }), error instanceof Error ? error.stack?.split("\n").slice(1, 7).join("\n") : undefined);
      if (error instanceof TaskProviderError && error.retryable && !finalAttempt) {
        // A request can have returned tokens before a later phase fails (for
        // example the one permitted CEO JSON repair). Account for those tokens
        // now; the next BullMQ attempt has a new execution token and must not
        // duplicate this usage entry.
        if (runtime && usageEntries.length) {
          usageReliable = (await Promise.all(usageEntries.map((entry) => this.usage.record({
            organizationId: task.organizationId,
            provider: runtime!.provider,
            modelId: runtime!.modelId,
            purpose: entry.purpose,
            status: "failed",
            inputTokens: token(entry.usage.input),
            outputTokens: token(entry.usage.output),
            totalTokens: token(entry.usage.total),
            latencyMs: Date.now() - started,
            errorCode: error.kind,
          })))).every(Boolean) && usageReliable;
        }
        // Keep a short queue lease during BullMQ backoff. Dashboard polling
        // must not enqueue a second recovery job before this retry runs.
        const released = await db.update(aiTasks).set({ status: "queued", executionToken: null, leaseExpiresAt: new Date(Date.now() + LEASE_MS), updatedAt: new Date() }).where(and(eq(aiTasks.id, task.id), eq(aiTasks.organizationId, task.organizationId), eq(aiTasks.executionToken, executionToken))).returning({ id: aiTasks.id });
        if (released.length) await this.event(task.id, task.organizationId, "retrying", `${message} Worker sẽ thử lại.`);
        else usageReliable = false;
        throw error;
      }
      const failed = await db.update(aiTasks).set({ status: "failed", error: message, executionToken: null, leaseExpiresAt: null, completedAt: new Date(), updatedAt: new Date() }).where(and(eq(aiTasks.id, task.id), eq(aiTasks.organizationId, task.organizationId), eq(aiTasks.executionToken, executionToken), ne(aiTasks.status, "cancelled"))).returning({ id: aiTasks.id });
      if (failed.length) {
        if (runtime) {
          const entries = usageEntries.length ? usageEntries : [{ usage: {} as Usage, purpose: "market_research_task" }];
          usageReliable = (await Promise.all(entries.map((entry) => this.usage.record({ organizationId: task.organizationId, provider: runtime!.provider, modelId: runtime!.modelId, purpose: entry.purpose, status: "failed", inputTokens: token(entry.usage.input), outputTokens: token(entry.usage.output), totalTokens: token(entry.usage.total), latencyMs: Date.now() - started, errorCode: error instanceof TaskProviderError ? error.kind : "execution_error" })))).every(Boolean) && usageReliable;
        }
        await this.event(task.id, task.organizationId, "failed", message);
      } else usageReliable = false;
      if (error instanceof TaskProviderError && error.retryable) throw error;
    } finally {
      clearInterval(heartbeat);
      for (const reservationId of reservationIds) {
        try { if (usageReliable) await this.quota.release(task.organizationId, reservationId); else await this.quota.retainUntilPeriodEnd(task.organizationId, reservationId); } catch { this.logger.error("Could not settle task quota reservation"); }
      }
    }
  }
}
