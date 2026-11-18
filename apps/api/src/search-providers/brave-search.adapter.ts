import { Injectable } from "@nestjs/common";

import {
  type SearchProviderAdapter,
  SearchProviderRuntimeError,
  type SearchRequest,
  type SearchResponse,
} from "./search-provider.adapter.js";

type BraveItem = { title?: unknown; url?: unknown; description?: unknown; age?: unknown };
type BraveResponse = { web?: { results?: unknown } };

@Injectable()
export class BraveSearchAdapter implements SearchProviderAdapter {
  readonly provider = "brave";
  readonly requiresApiKey = true;

  async search(apiKey: string | null, request: SearchRequest): Promise<SearchResponse> {
    if (!apiKey) throw new SearchProviderRuntimeError("SEARCH_PROVIDER_AUTH_FAILED", "Search provider credential is unavailable.");
    try {
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", request.query);
      url.searchParams.set("count", String(request.maxResults ?? 5));
      if (request.includeDomains?.length) url.searchParams.set("site", request.includeDomains.join(","));
      const response = await fetch(url, {
        headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
        signal: AbortSignal.timeout(10_000),
        redirect: "error",
      });
      if (response.status === 401 || response.status === 403) throw new SearchProviderRuntimeError("SEARCH_PROVIDER_AUTH_FAILED", "Search provider credentials were rejected.");
      if (response.status === 429) throw new SearchProviderRuntimeError("SEARCH_PROVIDER_RATE_LIMITED", "Search provider rate limit reached.");
      if (!response.ok) throw new SearchProviderRuntimeError("SEARCH_PROVIDER_UNAVAILABLE", "Search provider is unavailable.");
      const body = await response.json() as BraveResponse;
      if (!Array.isArray(body.web?.results)) throw new SearchProviderRuntimeError("SEARCH_PROVIDER_INVALID_RESPONSE", "Search provider returned an invalid response.");
      const results = body.web.results.flatMap((value): SearchResponse["results"] => {
        if (!value || typeof value !== "object") return [];
        const result = value as BraveItem;
        if (typeof result.title !== "string" || typeof result.url !== "string") return [];
        const content = typeof result.description === "string" ? result.description : null;
        return [{ title: result.title, url: result.url, snippet: content, content, score: null, publishedAt: typeof result.age === "string" ? result.age : null, provider: this.provider }];
      });
      return { query: request.query, provider: this.provider, results };
    } catch (error) {
      if (error instanceof SearchProviderRuntimeError) throw error;
      if (error instanceof DOMException && error.name === "TimeoutError") throw new SearchProviderRuntimeError("SEARCH_PROVIDER_TIMEOUT", "Brave Search hết thời gian phản hồi.");
      throw new SearchProviderRuntimeError("SEARCH_PROVIDER_UNAVAILABLE", "Không thể kết nối Brave Search.");
    }
  }
}
