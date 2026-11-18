import assert from "node:assert/strict";
import test from "node:test";
import { ResearchServiceClient, ResearchServiceError } from "./research-service.client.js";

const originalFetch = globalThis.fetch;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("Research Service client normalizes validated SearXNG evidence", async () => {
  globalThis.fetch = async () => response({ provider: "searxng", queries: ["AI agents"], sources: [{ title: "Nguồn", url: "https://example.com/a", canonical_url: "https://example.com/a", domain: "example.com", snippet: "Tóm tắt", extracted_content: "Nội dung", extraction_status: "retrieved", extraction_error: null, retrieved_at: "2026-01-01T00:00:00.000Z", content_hash: "hash" }] });
  try {
    const result = await new ResearchServiceClient().research({ queries: ["AI agents"], maxResults: 5 });
    assert.equal(result.provider, "searxng");
    assert.equal(result.sources[0]?.extracted_content, "Nội dung");
  } finally { globalThis.fetch = originalFetch; }
});

test("Research Service client rejects invalid response shapes without exposing body", async () => {
  globalThis.fetch = async () => response({ provider: "searxng", sources: [] });
  try { await assert.rejects(() => new ResearchServiceClient().research({ queries: ["AI"], maxResults: 5 }), (error: unknown) => error instanceof ResearchServiceError && error.code === "RESEARCH_SERVICE_INVALID_RESPONSE"); }
  finally { globalThis.fetch = originalFetch; }
});

test("Research Service client maps unavailable service safely", async () => {
  globalThis.fetch = async () => response({ error: "internal" }, 503);
  try { await assert.rejects(() => new ResearchServiceClient().research({ queries: ["AI"], maxResults: 5 }), (error: unknown) => error instanceof ResearchServiceError && error.code === "RESEARCH_SERVICE_UNAVAILABLE"); }
  finally { globalThis.fetch = originalFetch; }
});
