import { Injectable } from "@nestjs/common";

import {
  type SearchProviderAdapter,
  SearchProviderRuntimeError,
  type SearchRequest,
  type SearchResponse,
} from "./search-provider.adapter.js";

type SearxResult = { title?: unknown; url?: unknown; content?: unknown; publishedDate?: unknown; score?: unknown };
type SearxResponse = { results?: unknown };

/** Calls Nova's private Research Service, never a public SearXNG endpoint. */
@Injectable()
export class SearxngSearchAdapter implements SearchProviderAdapter {
  readonly provider = "searxng";
  readonly requiresApiKey = false;
  private readonly endpoint = (process.env.RESEARCH_SERVICE_URL ?? "http://127.0.0.1:8010").replace(/\/$/, "");

  async search(_apiKey: string | null, request: SearchRequest): Promise<SearchResponse> {
    try {
      const response = await fetch(`${this.endpoint}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: request.query, max_results: request.maxResults ?? 5 }),
        signal: AbortSignal.timeout(12_000),
        redirect: "error",
      });
      if (response.status === 429) throw new SearchProviderRuntimeError("SEARCH_PROVIDER_RATE_LIMITED", "SearXNG đang giới hạn yêu cầu.");
      if (!response.ok) throw new SearchProviderRuntimeError("SEARCH_PROVIDER_UNAVAILABLE", "SearXNG hoặc Research Service hiện không sẵn sàng.");
      const body = await response.json() as SearxResponse;
      if (!Array.isArray(body.results)) throw new SearchProviderRuntimeError("SEARCH_PROVIDER_INVALID_RESPONSE", "SearXNG trả về dữ liệu không hợp lệ.");
      const results = body.results.flatMap((value): SearchResponse["results"] => {
        if (!value || typeof value !== "object") return [];
        const result = value as SearxResult;
        if (typeof result.title !== "string" || typeof result.url !== "string") return [];
        const content = typeof result.content === "string" ? result.content : null;
        return [{ title: result.title, url: result.url, snippet: content, content, score: typeof result.score === "number" ? result.score : null, publishedAt: typeof result.publishedDate === "string" ? result.publishedDate : null, provider: this.provider }];
      });
      return { query: request.query, provider: this.provider, results };
    } catch (error) {
      if (error instanceof SearchProviderRuntimeError) throw error;
      if (error instanceof DOMException && error.name === "TimeoutError") throw new SearchProviderRuntimeError("SEARCH_PROVIDER_TIMEOUT", "SearXNG hết thời gian phản hồi.");
      throw new SearchProviderRuntimeError("SEARCH_PROVIDER_UNAVAILABLE", "Không thể kết nối SearXNG.");
    }
  }
}
