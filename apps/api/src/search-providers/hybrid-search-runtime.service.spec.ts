import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SearchProviderConnection } from "@workspace/db/node";
import type { RequestContext } from "../auth/request-context.js";
import { BraveSearchAdapter } from "./brave-search.adapter.js";
import { SearchProviderRuntimeError } from "./search-provider.adapter.js";
import { SearchProviderRuntimeService } from "./search-provider-runtime.service.js";
import { SearxngSearchAdapter } from "./searxng-search.adapter.js";
import type { SearchProvidersService } from "./search-providers.service.js";
import { TavilySearchAdapter } from "./tavily-search.adapter.js";

const context: RequestContext = { organizationId: "org-a", userId: "user-a", sessionId: "session-a", role: "owner" };
const connection = (provider: SearchProviderConnection["provider"], id: string = provider): SearchProviderConnection => ({ id, organizationId: "org-a", provider, name: provider, encryptedApiKey: provider === "searxng" ? null : "cipher", keyIv: provider === "searxng" ? null : "iv", keyAuthTag: provider === "searxng" ? null : "tag", keyVersion: "v1", enabled: true, priority: 10, consecutiveFailures: 0, circuitOpenUntil: null, createdAt: new Date(), updatedAt: new Date() });
const response = (provider: string, title = "AI agents for business") => ({ query: "AI agents", provider, results: [{ title, url: `https://${provider}.example.com/article`, snippet: "AI agents for business", content: null, score: null, publishedAt: null, provider }] });

function runtime(candidates: SearchProviderConnection[]) {
  const calls: string[] = [];
  const policy = {
    researchCandidates: async () => candidates,
    credentialFor: async () => "secret-never-returned",
    markResearchSuccess: async (_context: RequestContext, id: string) => { calls.push(`success:${id}`); },
    markResearchFailure: async (_context: RequestContext, item: SearchProviderConnection) => { calls.push(`failure:${item.id}`); },
  } as unknown as SearchProvidersService;
  const searxng = new SearxngSearchAdapter(); const tavily = new TavilySearchAdapter(); const brave = new BraveSearchAdapter();
  return { value: new SearchProviderRuntimeService(policy, searxng, tavily, brave), searxng, tavily, brave, calls };
}

describe("SearchProviderRuntimeService hybrid fallback", () => {
  it("uses SearXNG first and persists a successful circuit state", async () => {
    const subject = runtime([connection("searxng")]);
    subject.searxng.search = async () => response("searxng");
    const result = await subject.value.searchForResearch(context, { agentId: "agent-a", allowPaidFallback: true, request: { query: "AI agents" } });
    assert.equal(result.provider, "searxng");
    assert.deepEqual(subject.calls, ["success:searxng"]);
  });

  it("falls back from SearXNG timeout to Tavily", async () => {
    const subject = runtime([connection("searxng"), connection("tavily")]);
    subject.searxng.search = async () => { throw new SearchProviderRuntimeError("SEARCH_PROVIDER_TIMEOUT", "timeout"); };
    subject.tavily.search = async () => response("tavily");
    const result = await subject.value.searchForResearch(context, { agentId: "agent-a", allowPaidFallback: true, request: { query: "AI agents" } });
    assert.equal(result.provider, "tavily");
    assert.deepEqual(subject.calls, ["failure:searxng", "success:tavily"]);
  });

  it("does not rotate Tavily credentials after 429 and uses Brave next", async () => {
    const subject = runtime([connection("tavily", "tavily-a"), connection("tavily", "tavily-b"), connection("brave")]);
    let tavilyCalls = 0;
    subject.tavily.search = async () => { tavilyCalls += 1; throw new SearchProviderRuntimeError("SEARCH_PROVIDER_RATE_LIMITED", "rate limited"); };
    subject.brave.search = async () => response("brave");
    const result = await subject.value.searchForResearch(context, { agentId: "agent-a", allowPaidFallback: true, request: { query: "AI agents" } });
    assert.equal(result.provider, "brave");
    assert.equal(tavilyCalls, 1);
  });

  it("falls back after HTTP-successful but irrelevant results", async () => {
    const subject = runtime([connection("searxng"), connection("brave")]);
    subject.searxng.search = async () => ({ query: "AI agents", provider: "searxng", results: [{ title: "Gardening supplies", url: "https://searxng.example.com/garden", snippet: "Plants and soil", content: null, score: null, publishedAt: null, provider: "searxng" }] });
    subject.brave.search = async () => response("brave");
    const result = await subject.value.searchForResearch(context, { agentId: "agent-a", allowPaidFallback: true, request: { query: "AI agents" } });
    assert.equal(result.provider, "brave");
  });

  it("returns a safe final error when every provider fails", async () => {
    const subject = runtime([connection("searxng"), connection("brave")]);
    subject.searxng.search = async () => { throw new SearchProviderRuntimeError("SEARCH_PROVIDER_UNAVAILABLE", "private detail"); };
    subject.brave.search = async () => { throw new SearchProviderRuntimeError("SEARCH_PROVIDER_RATE_LIMITED", "private detail"); };
    await assert.rejects(() => subject.value.searchForResearch(context, { agentId: "agent-a", allowPaidFallback: true, request: { query: "AI agents" } }), (error: unknown) => error instanceof SearchProviderRuntimeError && error.code === "SEARCH_PROVIDER_RATE_LIMITED");
  });

  it("does not use a paid provider unless it is explicitly allowed", async () => {
    const subject = runtime([connection("tavily")]);
    subject.tavily.search = async () => response("tavily");
    await assert.rejects(() => subject.value.searchForResearch(context, { agentId: "agent-a", request: { query: "AI agents" } }), (error: unknown) => error instanceof SearchProviderRuntimeError && error.code === "SEARCH_PROVIDER_UNAVAILABLE");
  });

  it("records authentication failures so the persisted circuit can protect later tasks", async () => {
    const subject = runtime([connection("tavily")]);
    subject.tavily.search = async () => { throw new SearchProviderRuntimeError("SEARCH_PROVIDER_AUTH_FAILED", "bad key"); };
    await assert.rejects(() => subject.value.searchForResearch(context, { agentId: "agent-a", allowPaidFallback: true, request: { query: "AI agents" } }), (error: unknown) => error instanceof SearchProviderRuntimeError && error.code === "SEARCH_PROVIDER_AUTH_FAILED");
    assert.deepEqual(subject.calls, ["failure:tavily"]);
  });
});
