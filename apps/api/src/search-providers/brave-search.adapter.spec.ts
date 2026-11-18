import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { SearchProviderRuntimeError } from "./search-provider.adapter.js";
import { BraveSearchAdapter } from "./brave-search.adapter.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("BraveSearchAdapter", () => {
  it("normalizes a result without leaking the API key", async () => {
    globalThis.fetch = (async (url, options) => {
      assert.match(String(url), /api\.search\.brave\.com/);
      assert.equal(new Headers(options?.headers).get("X-Subscription-Token"), "brave-secret");
      return new Response(JSON.stringify({ web: { results: [{ title: "AI", url: "https://example.com/ai", description: "AI insight" }] } }), { status: 200 });
    }) as typeof fetch;
    const result = await new BraveSearchAdapter().search("brave-secret", { query: "AI", maxResults: 1 });
    assert.equal(result.results[0]?.provider, "brave");
    assert.equal(JSON.stringify(result).includes("brave-secret"), false);
  });

  it("maps provider rate limits", async () => {
    globalThis.fetch = (async () => new Response(null, { status: 429 })) as typeof fetch;
    await assert.rejects(() => new BraveSearchAdapter().search("secret", { query: "AI" }), (error: unknown) => error instanceof SearchProviderRuntimeError && error.code === "SEARCH_PROVIDER_RATE_LIMITED");
  });
});
