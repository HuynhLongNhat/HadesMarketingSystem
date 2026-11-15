
import {
  BadRequestException,
  BadGatewayException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import {
  aiProviderConnections,
  db,
} from "@workspace/db/node";

import {
  PROVIDER_REGISTRY,
  listEmbeddingModelDefinitions,
  listProviderDefinitions,
} from "./provider-registry.js";

import type { AiProviderType } from "@workspace/db/node";
import type { AiProviderConnection } from "@workspace/db/node";

import { decryptCredential } from "../ai-credentials/credential-crypto.js";
import type { RequestContext } from "../auth/request-context.js";

export interface CatalogModel {
  id: string;
  name: string;
  provider: string;
  contextWindow: number | null;
  inputPricePerMillion: number | null;
  outputPricePerMillion: number | null;
  supportsVision: boolean;
  supportsTools: boolean;
  dimensions?: number;
}

export interface ModelAvailabilityResult {
  connectionId: string;
  provider: AiProviderType;
  modelId: string;
  available: boolean;
  status: "available" | "model_unsupported" | "unsupported";
  message: string;
}

type JsonObject = Record<string, unknown>;

function record(value: unknown): JsonObject | null {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function numberOrNull(value: unknown): number | null {
  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) return value;

  if (
    typeof value === "string" &&
    value.trim() &&
    Number.isFinite(Number(value))
  ) return Number(value);

  return null;
}

function pricePerMillion(value: unknown): number | null {
  const number = numberOrNull(value);
  return number === null ? null : number * 1_000_000;
}

@Injectable()
export class ModelCatalogService {
  private readonly cache = new Map<
    string,
    { expiresAt: number; data: CatalogModel[] }
  >();

  listProviders() {
    return listProviderDefinitions();
  }

  listEmbeddingModels(provider: string): CatalogModel[] {
    if (
      !Object.prototype.hasOwnProperty.call(
        PROVIDER_REGISTRY,
        provider,
      )
    ) {
      throw new BadRequestException("Unsupported provider");
    }

    return listEmbeddingModelDefinitions(
      provider as AiProviderType,
    ).map((model) => ({
      id: model.modelId,
      name: model.modelId,
      provider: model.provider,
      contextWindow: null,
      inputPricePerMillion: null,
      outputPricePerMillion: null,
      supportsVision: false,
      supportsTools: false,
      dimensions: model.dimensions,
    }));
  }

  async listModels(
    provider: string,
    context?: RequestContext,
    connectionId?: string,
  ): Promise<CatalogModel[]> {
    if (
      !Object.prototype.hasOwnProperty.call(
        PROVIDER_REGISTRY,
        provider,
      )
    ) {
      throw new BadRequestException("Unsupported provider");
    }

    const definition =
      PROVIDER_REGISTRY[provider as AiProviderType];

    if (!definition.catalogProvider) {
      return [];
    }

    if (provider === "groq") {
      if (!context || !connectionId) {
        throw new BadRequestException({
          code: "MODEL_CATALOG_CONNECTION_REQUIRED",
          message: "Groq cần một kết nối đang bật để tải danh sách mô hình.",
        });
      }

      const cacheKey = `groq:${context.organizationId}:${connectionId}`;
      const cachedGroq = this.cache.get(cacheKey);
      if (cachedGroq && cachedGroq.expiresAt > Date.now()) {
        return cachedGroq.data;
      }

      const connection = await this.findConnection(
        context,
        connectionId,
        "groq",
      );
      const models = await this.getGroqModels(
        connection,
        this.decryptConnectionCredential(context, connection),
      );

      this.cache.set(cacheKey, {
        data: models,
        expiresAt: Date.now() + 15 * 60 * 1000,
      });
      return models;
    }

    const cached = this.cache.get(provider);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const models =
      provider === "openrouter"
        ? await this.getOpenRouterModels()
        : await this.getLiteLLMModels(
            provider,
            definition.catalogProvider,
          );

    this.cache.set(provider, {
      data: models,
      expiresAt: Date.now() + 15 * 60 * 1000,
    });

    return models;
  }

  async validateModel(
    context: RequestContext,
    connectionId: string,
    rawModelId: string,
  ): Promise<ModelAvailabilityResult> {
    const modelId = rawModelId.trim();
    const connection = await this.findConnection(context, connectionId);

    if (connection.provider !== "groq") {
      return {
        connectionId: connection.id,
        provider: connection.provider,
        modelId,
        available: false,
        status: "unsupported",
        message: "Chưa hỗ trợ kiểm tra mô hình trực tiếp cho nhà cung cấp này.",
      };
    }

    const models = await this.listModels(
      connection.provider,
      context,
      connection.id,
    );
    const available = models.some((model) => model.id === modelId);

    return {
      connectionId: connection.id,
      provider: connection.provider,
      modelId,
      available,
      status: available ? "available" : "model_unsupported",
      message: available
        ? "Mô hình khả dụng trên kết nối Groq này."
        : "Groq không trả về Model ID này cho kết nối hiện tại.",
    };
  }

  private async findConnection(
    context: RequestContext,
    connectionId: string,
    provider?: AiProviderType,
  ): Promise<AiProviderConnection> {
    const conditions = [
      eq(aiProviderConnections.organizationId, context.organizationId),
      eq(aiProviderConnections.id, connectionId),
      eq(aiProviderConnections.enabled, true),
    ];

    if (provider) {
      conditions.push(eq(aiProviderConnections.provider, provider));
    }

    const [connection] = await db
      .select()
      .from(aiProviderConnections)
      .where(and(...conditions))
      .limit(1);

    if (!connection) {
      throw new NotFoundException("AI provider connection not found or disabled");
    }

    return connection;
  }

  private decryptConnectionCredential(
    context: RequestContext,
    connection: AiProviderConnection,
  ): string {
    try {
      return decryptCredential(
        {
          encryptedApiKey: connection.encryptedApiKey,
          keyIv: connection.keyIv,
          keyAuthTag: connection.keyAuthTag,
          keyVersion: "v1",
        },
        {
          organizationId: context.organizationId,
          connectionId: connection.id,
          provider: connection.provider,
        },
      );
    } catch {
      throw new ServiceUnavailableException({
        code: "MODEL_CATALOG_CREDENTIAL_UNAVAILABLE",
        message: "Không thể sử dụng credential đã lưu của kết nối này.",
      });
    }
  }

  private async getGroqModels(
    connection: AiProviderConnection,
    apiKey: string,
  ): Promise<CatalogModel[]> {
    let response: Response;

    try {
      response = await fetch("https://api.groq.com/openai/v1/models", {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        signal: AbortSignal.timeout(10_000),
        redirect: "error",
      });
    } catch {
      throw new ServiceUnavailableException({
        code: "MODEL_CATALOG_UNAVAILABLE",
        message: "Không thể kết nối tới Groq để tải danh sách mô hình.",
      });
    }

    if (response.status === 401) {
      await response.body?.cancel();
      throw new UnauthorizedException({
        code: "MODEL_CATALOG_INVALID_API_KEY",
        message: "Groq từ chối API key của kết nối này.",
      });
    }

    if (response.status === 429) {
      await response.body?.cancel();
      throw new HttpException({
        code: "MODEL_CATALOG_RATE_LIMITED",
        message: "Groq đang giới hạn yêu cầu tải danh sách mô hình (HTTP 429).",
      }, 429);
    }

    if (!response.ok) {
      await response.body?.cancel();
      throw new BadGatewayException({
        code: "MODEL_CATALOG_HTTP_ERROR",
        message: `Groq không thể tải danh sách mô hình (HTTP ${response.status}).`,
      });
    }

    let payload: JsonObject | null;
    try {
      payload = record(await response.json());
    } catch {
      throw new BadGatewayException({
        code: "MODEL_CATALOG_INVALID_RESPONSE",
        message: "Groq trả về danh sách mô hình không hợp lệ.",
      });
    }

    const entries = payload?.data;
    if (!Array.isArray(entries)) {
      throw new BadGatewayException({
        code: "MODEL_CATALOG_INVALID_RESPONSE",
        message: "Groq trả về danh sách mô hình không hợp lệ.",
      });
    }

    return entries.flatMap((raw): CatalogModel[] => {
      const item = record(raw);
      if (!item || typeof item.id !== "string" || !item.id.trim()) {
        return [];
      }

      return [{
        id: item.id,
        name: item.id,
        provider: connection.provider,
        contextWindow: null,
        inputPricePerMillion: null,
        outputPricePerMillion: null,
        supportsVision: false,
        supportsTools: false,
      }];
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  private async getJson(url: string): Promise<unknown> {
    let response: Response;

    try {
      response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new ServiceUnavailableException(
        "External model catalog unavailable",
      );
    }

    if (!response.ok) {
      throw new BadGatewayException(
        `External catalog HTTP ${response.status}`,
      );
    }

    const contentLength = Number(
      response.headers.get("content-length") ?? 0,
    );

    if (contentLength > 8_000_000) {
      throw new BadGatewayException(
        "Catalog response too large",
      );
    }

    try {
      const text = await response.text();

      if (text.length > 8_000_000) {
        throw new BadGatewayException(
          "Catalog response too large",
        );
      }

      return JSON.parse(text) as unknown;
    } catch (error) {
      if (error instanceof BadGatewayException) {
        throw error;
      }

      throw new BadGatewayException(
        "Invalid catalog JSON",
      );
    }
  }

  private async getLiteLLMModels(
    provider: string,
    catalogProvider: string,
  ): Promise<CatalogModel[]> {
    const url = new URL(
      "https://models.litellm.ai/model_catalog",
    );

    url.searchParams.set("provider", catalogProvider);
    url.searchParams.set("page_size", "100");

    const models: CatalogModel[] = [];
    const seen = new Set<string>();

    for (let page = 1; page <= 20; page++) {
      url.searchParams.set("page", String(page));

      const payload = record(
        await this.getJson(url.toString()),
      );

      const entries = payload?.data;

      if (!Array.isArray(entries)) {
        throw new BadGatewayException(
          "Unexpected LiteLLM response",
        );
      }

      for (const raw of entries) {
        const item = record(raw);
        if (!item) continue;

        const id =
          typeof item.id === "string"
            ? item.id
            : null;

        if (!id || seen.has(id)) continue;
        seen.add(id);

        models.push({
          id,
          name:
            typeof item.name === "string"
              ? item.name
              : id,
          provider,
          contextWindow:
            numberOrNull(item.max_input_tokens) ??
            numberOrNull(item.max_tokens),
          inputPricePerMillion: pricePerMillion(
            item.input_cost_per_token,
          ),
          outputPricePerMillion: pricePerMillion(
            item.output_cost_per_token,
          ),
          supportsVision:
            item.supports_vision === true,
          supportsTools:
            item.supports_function_calling === true,
        });
      }

      if (entries.length < 100) break;
    }

    return models.sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  private async getOpenRouterModels(): Promise<CatalogModel[]> {
    const payload = record(
      await this.getJson(
        "https://openrouter.ai/api/v1/models",
      ),
    );

    const entries = payload?.data;

    if (!Array.isArray(entries)) {
      throw new BadGatewayException(
        "Unexpected OpenRouter response",
      );
    }

    return entries.flatMap((raw): CatalogModel[] => {
      const item = record(raw);
      if (!item || typeof item.id !== "string") {
        return [];
      }

      const pricing = record(item.pricing);
      const architecture = record(item.architecture);
      const modalities = architecture?.input_modalities;
      const parameters = item.supported_parameters;

      return [{
        id: item.id,
        name:
          typeof item.name === "string"
            ? item.name
            : item.id,
        provider: "openrouter",
        contextWindow:
          numberOrNull(item.context_length),
        inputPricePerMillion:
          pricePerMillion(pricing?.prompt),
        outputPricePerMillion:
          pricePerMillion(pricing?.completion),
        supportsVision:
          Array.isArray(modalities) &&
          modalities.includes("image"),
        supportsTools:
          Array.isArray(parameters) &&
          parameters.includes("tools"),
      }];
    }).sort((a, b) => a.name.localeCompare(b.name));
  }
}
