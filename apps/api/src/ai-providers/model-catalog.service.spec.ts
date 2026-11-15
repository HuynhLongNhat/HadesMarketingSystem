import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { HttpException } from "@nestjs/common";

import { ModelCatalogService } from "./model-catalog.service.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const groqConnection = {
  id: "connection-groq-1",
  organizationId: "organization-1",
  provider: "groq",
  name: "Groq production",
  encryptedApiKey: "encrypted",
  keyIv: "iv",
  keyAuthTag: "tag",
  keyVersion: "v1",
  enabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
} as const;

async function fetchGroqCatalog() {
  const service = new ModelCatalogService();
  return (service as unknown as {
    getGroqModels: (connection: typeof groqConnection, apiKey: string) => Promise<unknown>;
  }).getGroqModels(groqConnection, "test-key-that-must-not-escape");
}

describe("ModelCatalogService Groq catalog", () => {
  it("uses Groq's authenticated official models endpoint and normalizes models", async () => {
    globalThis.fetch = (async (url, options) => {
      assert.equal(url, "https://api.groq.com/openai/v1/models");
      assert.equal(new Headers(options?.headers).get("Authorization"), "Bearer test-key-that-must-not-escape");
      return new Response(JSON.stringify({
        data: [{ id: "llama-3.3-70b-versatile" }, { id: "qwen/qwen3-32b" }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    const models = await fetchGroqCatalog();
    assert.deepEqual(models, [
      {
        id: "llama-3.3-70b-versatile",
        name: "llama-3.3-70b-versatile",
        provider: "groq",
        contextWindow: null,
        inputPricePerMillion: null,
        outputPricePerMillion: null,
        supportsVision: false,
        supportsTools: false,
      },
      {
        id: "qwen/qwen3-32b",
        name: "qwen/qwen3-32b",
        provider: "groq",
        contextWindow: null,
        inputPricePerMillion: null,
        outputPricePerMillion: null,
        supportsVision: false,
        supportsTools: false,
      },
    ]);
    assert.equal(JSON.stringify(models).includes("test-key-that-must-not-escape"), false);
  });

  it("returns a safe invalid-key category when Groq returns HTTP 401", async () => {
    globalThis.fetch = (async () => new Response(null, { status: 401 })) as typeof fetch;

    await assert.rejects(fetchGroqCatalog, (error: unknown) =>
      error instanceof HttpException &&
      error.getStatus() === 401 &&
      (error.getResponse() as { code?: string }).code === "MODEL_CATALOG_INVALID_API_KEY",
    );
  });

  it("reports catalog HTTP errors without exposing provider response bodies", async () => {
    globalThis.fetch = (async () => new Response("sensitive provider body", { status: 503 })) as typeof fetch;

    await assert.rejects(fetchGroqCatalog, (error: unknown) => {
      if (!(error instanceof HttpException)) return false;
      const response = error.getResponse() as { code?: string; message?: string };
      return error.getStatus() === 502 &&
        response.code === "MODEL_CATALOG_HTTP_ERROR" &&
        !String(response.message).includes("sensitive provider body");
    });
  });
});
