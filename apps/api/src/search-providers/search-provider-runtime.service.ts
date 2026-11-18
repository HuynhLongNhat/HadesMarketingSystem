import { BadRequestException, Injectable } from "@nestjs/common";

import type { RequestContext } from "../auth/request-context.js";
import { SearchProvidersService } from "./search-providers.service.js";
import { type SearchProviderAdapter, SearchProviderRuntimeError, type SearchRequest, type SearchResponse } from "./search-provider.adapter.js";
import { BraveSearchAdapter } from "./brave-search.adapter.js";
import { SearxngSearchAdapter } from "./searxng-search.adapter.js";
import { TavilySearchAdapter } from "./tavily-search.adapter.js";

export type ResearchSearchInput = {
  agentId: string;
  connectionId?: string;
  providers?: string[];
  excludeProviders?: string[];
  allowPaidFallback?: boolean;
  request: SearchRequest;
};

const RETRYABLE_CODES = new Set(["SEARCH_PROVIDER_TIMEOUT", "SEARCH_PROVIDER_UNAVAILABLE"]);
const PAID_PROVIDERS = new Set(["tavily", "brave"]);

function safePublicUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local") || /^127\.|^10\.|^192\.168\.|^169\.254\.|^0\./.test(host)) return null;
    return url.toString();
  } catch { return null; }
}

function meaningfulResults(response: SearchResponse) {
  const queryWords = response.query.toLocaleLowerCase("en").split(/\s+/).filter((word) => word.length >= 3).slice(0, 5);
  const urls = new Set<string>();
  const results = response.results.flatMap((result) => {
    const url = safePublicUrl(result.url);
    if (!url || urls.has(url)) return [];
    urls.add(url);
    return [{ ...result, url }];
  });
  const relevant = !queryWords.length || results.some((result) => {
    const haystack = `${result.title} ${result.snippet ?? ""}`.toLocaleLowerCase("en");
    return queryWords.some((word) => haystack.includes(word));
  });
  return { results, relevant: results.length > 0 && relevant };
}

@Injectable()
export class SearchProviderRuntimeService {
  private readonly adapters: Map<string, SearchProviderAdapter>;

  constructor(
    private readonly policy: SearchProvidersService,
    searxng: SearxngSearchAdapter,
    tavily: TavilySearchAdapter,
    brave: BraveSearchAdapter,
  ) {
    this.adapters = new Map<string, SearchProviderAdapter>([[searxng.provider, searxng], [tavily.provider, tavily], [brave.provider, brave]]);
  }

  private validateRequest(request: SearchRequest): SearchRequest {
    const query = request.query.trim();
    if (!query || query.length > 500) throw new BadRequestException({ code: "INVALID_SEARCH_QUERY", message: "Search query must contain 1 to 500 characters." });
    const maxResults = request.maxResults ?? 5;
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 10) throw new BadRequestException({ code: "INVALID_SEARCH_MAX_RESULTS", message: "maxResults must be between 1 and 10." });
    const normalizedDomains = (domains: string[] | undefined) => domains?.map((domain) => domain.trim().toLowerCase()).filter(Boolean).slice(0, 20);
    return { query, searchDepth: request.searchDepth ?? "basic", maxResults, includeDomains: normalizedDomains(request.includeDomains), excludeDomains: normalizedDomains(request.excludeDomains) };
  }

  private async callAdapter(adapter: SearchProviderAdapter, apiKey: string | null, request: SearchRequest) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { return await adapter.search(apiKey, request); }
      catch (error) {
        lastError = error;
        if (!(error instanceof SearchProviderRuntimeError) || !RETRYABLE_CODES.has(error.code) || attempt === 1) throw error;
      }
    }
    throw lastError;
  }

  /** Priority resolver with bounded retry and persistent circuit protection.
   * A 429 never triggers another key of the same paid provider. */
  async searchForResearch(context: RequestContext, input: ResearchSearchInput): Promise<SearchResponse> {
    const request = this.validateRequest(input.request);
    const configured = await this.policy.researchCandidates(context, input.agentId, { connectionId: input.connectionId, providers: input.providers, excludeProviders: input.excludeProviders });
    // Paid providers require either an explicit provider choice or an
    // organization/operator opt-in. Priority alone must not spend credits.
    const candidates = input.providers || input.connectionId || input.allowPaidFallback ? configured : configured.filter((connection) => !PAID_PROVIDERS.has(connection.provider));
    if (!candidates.length) throw new SearchProviderRuntimeError("SEARCH_PROVIDER_UNAVAILABLE", "Không có SearXNG khả dụng; hãy chọn provider trả phí một cách rõ ràng.");
    let lastError: SearchProviderRuntimeError | undefined;
    const quotaBlockedProviders = new Set<string>();

    for (const connection of candidates) {
      if (quotaBlockedProviders.has(connection.provider)) continue;
      const adapter = this.adapters.get(connection.provider);
      if (!adapter) { lastError = new SearchProviderRuntimeError("SEARCH_PROVIDER_UNSUPPORTED", "Configured search provider is not supported."); continue; }
      try {
        const apiKey = adapter.requiresApiKey ? await this.policy.credentialFor(context, connection) : null;
        const response = await this.callAdapter(adapter, apiKey, request);
        const quality = meaningfulResults(response);
        if (!quality.relevant) throw new SearchProviderRuntimeError("SEARCH_PROVIDER_LOW_QUALITY", "Search provider returned no relevant public results.");
        await this.policy.markResearchSuccess(context, connection.id);
        return { ...response, results: quality.results };
      } catch (error) {
        const normalized = error instanceof SearchProviderRuntimeError ? error : new SearchProviderRuntimeError("SEARCH_PROVIDER_UNAVAILABLE", "Search provider could not be reached.");
        lastError = normalized;
        if (normalized.code === "SEARCH_PROVIDER_AUTH_FAILED" || normalized.code === "SEARCH_PROVIDER_RATE_LIMITED") quotaBlockedProviders.add(connection.provider);
        // Quality mismatches are query-specific. All provider/credential
        // failures contribute to the short circuit so later Tasks do not
        // keep spending time (or credits) on an unhealthy connection.
        if (normalized.code !== "SEARCH_PROVIDER_LOW_QUALITY") await this.policy.markResearchFailure(context, connection);
        // An explicit connection never silently spends another provider quota.
        if (input.connectionId) throw normalized;
        if (normalized.code === "SEARCH_PROVIDER_RATE_LIMITED" && PAID_PROVIDERS.has(connection.provider)) continue;
      }
    }
    throw lastError ?? new SearchProviderRuntimeError("SEARCH_PROVIDER_UNAVAILABLE", "Không có Search Provider khả dụng.");
  }
}
