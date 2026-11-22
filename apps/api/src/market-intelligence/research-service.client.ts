import { Injectable } from "@nestjs/common";

export type ResearchServiceSource = {
  title: string;
  url: string;
  canonical_url: string;
  domain: string;
  snippet: string | null;
  extracted_content: string | null;
  extraction_status: "retrieved" | "blocked" | "failed";
  extraction_error: string | null;
  retrieved_at: string;
  content_hash: string | null;
};
export type ResearchPainSignal = {
  canonical_url: string;
  category: string;
  quote: string;
  verified: true;
  confidence: "low";
};
export type ResearchServiceResult = {
  provider: "searxng";
  queries: string[];
  sources: ResearchServiceSource[];
  pain_signals: ResearchPainSignal[];
};

export class ResearchServiceError extends Error {
  constructor(readonly code: "RESEARCH_SERVICE_UNAVAILABLE" | "RESEARCH_SERVICE_INVALID_RESPONSE", message: string) { super(message); this.name = "ResearchServiceError"; }
}

function readSource(value: unknown): ResearchServiceSource | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  if (typeof source.title !== "string" || typeof source.url !== "string" || typeof source.canonical_url !== "string" || typeof source.domain !== "string" || !["retrieved", "blocked", "failed"].includes(String(source.extraction_status))) return null;
  return {
    title: source.title, url: source.url, canonical_url: source.canonical_url, domain: source.domain,
    snippet: typeof source.snippet === "string" ? source.snippet : null,
    extracted_content: typeof source.extracted_content === "string" ? source.extracted_content : null,
    extraction_status: source.extraction_status as ResearchServiceSource["extraction_status"],
    extraction_error: typeof source.extraction_error === "string" ? source.extraction_error : null,
    retrieved_at: typeof source.retrieved_at === "string" ? source.retrieved_at : new Date().toISOString(),
    content_hash: typeof source.content_hash === "string" ? source.content_hash : null,
  };
}

@Injectable()
export class ResearchServiceClient {
  private readonly endpoint = (process.env.RESEARCH_SERVICE_URL ?? "http://127.0.0.1:8010").replace(/\/$/, "");

  async research(input: { queries: string[]; maxResults: number }): Promise<ResearchServiceResult> {
    let response: Response;
    try {
      response = await fetch(`${this.endpoint}/research`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queries: input.queries, max_results: input.maxResults }),
        signal: AbortSignal.timeout(90_000),
        redirect: "error",
      });
    } catch {
      throw new ResearchServiceError("RESEARCH_SERVICE_UNAVAILABLE", "Research Service không thể kết nối hoặc hết thời gian phản hồi.");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ResearchServiceError("RESEARCH_SERVICE_UNAVAILABLE", "Research Service hoặc SearXNG hiện không sẵn sàng.");
    }
    let body: unknown;
    try { body = await response.json(); }
    catch { throw new ResearchServiceError("RESEARCH_SERVICE_INVALID_RESPONSE", "Research Service trả về phản hồi không hợp lệ."); }
    if (!body || typeof body !== "object") throw new ResearchServiceError("RESEARCH_SERVICE_INVALID_RESPONSE", "Research Service trả về phản hồi không hợp lệ.");
    const parsed = body as { provider?: unknown; queries?: unknown; sources?: unknown; pain_signals?: unknown };
    if (parsed.provider !== "searxng" || !Array.isArray(parsed.queries) || !Array.isArray(parsed.sources)) throw new ResearchServiceError("RESEARCH_SERVICE_INVALID_RESPONSE", "Research Service trả về cấu trúc dữ liệu không hợp lệ.");
    const sources = parsed.sources.map(readSource).filter((source): source is ResearchServiceSource => Boolean(source)).slice(0, input.maxResults);
    // Verify service output at the trust boundary. Older deployments may omit pain_signals.
    const extractedByUrl = new Map(sources
      .filter((source) => source.extraction_status === "retrieved" && source.extracted_content)
      .map((source) => [source.canonical_url, source.extracted_content!]));
    const painSignals: ResearchPainSignal[] = [];
    for (const raw of Array.isArray(parsed.pain_signals) ? parsed.pain_signals.slice(0, 60) : []) {
      if (!raw || typeof raw !== "object") continue;
      const signal = raw as Record<string, unknown>;
      if (typeof signal.canonical_url !== "string" ||
          typeof signal.category !== "string" || !/^[a-z_]{2,32}$/.test(signal.category) ||
          typeof signal.quote !== "string" || signal.quote.length < 3 || signal.quote.length > 300 ||
          signal.verified !== true || signal.confidence !== "low" ||
          !extractedByUrl.get(signal.canonical_url)?.includes(signal.quote)) continue;
      painSignals.push({
        canonical_url: signal.canonical_url, category: signal.category, quote: signal.quote,
        verified: true, confidence: "low",
      });
    }
    return {
      provider: "searxng",
      queries: parsed.queries.filter((query): query is string => typeof query === "string").slice(0, 8),
      sources,
      pain_signals: painSignals,
    };
  }
}
