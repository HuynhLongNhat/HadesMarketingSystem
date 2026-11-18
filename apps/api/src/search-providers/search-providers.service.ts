import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { aiAgents, db, searchProviderConnections, type SearchProviderConnection } from "@workspace/db/node";

import type { RequestContext } from "../auth/request-context.js";
import { decryptCredential, encryptCredential } from "../ai-credentials/credential-crypto.js";
import { tenantWhere } from "../common/tenant/tenant-query.js";
import type { CreateSearchProviderDto, UpdateSearchProviderDto } from "./search-providers.dto.js";
import { SearchProviderConnectionTestService } from "./search-provider-connection-test.service.js";

export type SafeSearchProviderConnection = Pick<SearchProviderConnection, "id" | "provider" | "name" | "enabled" | "priority" | "consecutiveFailures" | "circuitOpenUntil" | "createdAt" | "updatedAt"> & { hasApiKey: boolean };
function safeConnection(connection: SearchProviderConnection): SafeSearchProviderConnection {
  return { id: connection.id, provider: connection.provider, name: connection.name, enabled: connection.enabled, priority: connection.priority, consecutiveFailures: connection.consecutiveFailures, circuitOpenUntil: connection.circuitOpenUntil, hasApiKey: Boolean(connection.encryptedApiKey), createdAt: connection.createdAt, updatedAt: connection.updatedAt };
}
function databaseErrorCode(error: unknown): string | undefined { if (!error || typeof error !== "object") return undefined; const value = error as { code?: unknown; cause?: unknown }; return typeof value.code === "string" ? value.code : databaseErrorCode(value.cause); }

@Injectable()
export class SearchProvidersService {
  constructor(private readonly tester: SearchProviderConnectionTestService) {}

  private async findConnection(context: RequestContext, id: string): Promise<SearchProviderConnection> {
    const [connection] = await db.select().from(searchProviderConnections).where(tenantWhere(context, searchProviderConnections.organizationId, eq(searchProviderConnections.id, id))).limit(1);
    if (!connection) throw new NotFoundException("Search provider connection not found");
    return connection;
  }

  async listConnections(context: RequestContext) {
    const connections = await db.select().from(searchProviderConnections).where(tenantWhere(context, searchProviderConnections.organizationId)).orderBy(asc(searchProviderConnections.priority), asc(searchProviderConnections.createdAt), asc(searchProviderConnections.id));
    return connections.map(safeConnection);
  }
  async getConnection(context: RequestContext, id: string) { return safeConnection(await this.findConnection(context, id)); }

  async createConnection(context: RequestContext, dto: CreateSearchProviderDto) {
    const name = dto.name.trim();
    const apiKey = dto.apiKey?.trim() ?? "";
    if (!name) throw new BadRequestException("Tên kết nối không được để trống");
    if (dto.provider !== "searxng" && !apiKey) throw new BadRequestException("API key là bắt buộc cho provider này.");
    if (dto.provider === "searxng" && apiKey) throw new BadRequestException("SearXNG nội bộ không nhận API key.");
    const id = randomUUID();
    const encrypted = apiKey ? encryptCredential(apiKey, { organizationId: context.organizationId, connectionId: id, provider: dto.provider }) : {};
    try {
      const [connection] = await db.insert(searchProviderConnections).values({ id, organizationId: context.organizationId, provider: dto.provider, name, ...encrypted, enabled: true, priority: dto.priority ?? 100 }).returning();
      if (!connection) throw new Error("Search provider connection insert failed");
      return safeConnection(connection);
    } catch (error) { if (databaseErrorCode(error) === "23505") throw new ConflictException("Connection name already exists for this provider"); throw error; }
  }

  async updateConnection(context: RequestContext, id: string, dto: UpdateSearchProviderDto) {
    if (!Object.keys(dto).length) throw new BadRequestException("At least one update field is required");
    const connection = await this.findConnection(context, id);
    const updates: Partial<typeof searchProviderConnections.$inferInsert> = { updatedAt: new Date() };
    if (dto.name !== undefined) { const name = dto.name.trim(); if (!name) throw new BadRequestException("Connection name cannot be empty"); updates.name = name; }
    if (dto.enabled !== undefined) updates.enabled = dto.enabled;
    if (dto.priority !== undefined) updates.priority = dto.priority;
    if (dto.apiKey !== undefined) {
      if (connection.provider === "searxng") throw new BadRequestException("SearXNG nội bộ không dùng API key.");
      if (!dto.apiKey.trim()) throw new BadRequestException("API key cannot be empty");
      Object.assign(updates, encryptCredential(dto.apiKey, { organizationId: context.organizationId, connectionId: connection.id, provider: connection.provider }));
    }
    try {
      const [updated] = await db.update(searchProviderConnections).set(updates).where(tenantWhere(context, searchProviderConnections.organizationId, eq(searchProviderConnections.id, id))).returning();
      if (!updated) throw new NotFoundException("Search provider connection not found");
      return safeConnection(updated);
    } catch (error) { if (databaseErrorCode(error) === "23505") throw new ConflictException("Connection name already exists for this provider"); throw error; }
  }

  async deleteConnection(context: RequestContext, id: string) {
    await this.findConnection(context, id);
    const deleted = await db.delete(searchProviderConnections).where(tenantWhere(context, searchProviderConnections.organizationId, eq(searchProviderConnections.id, id))).returning({ id: searchProviderConnections.id });
    if (!deleted.length) throw new NotFoundException("Search provider connection not found");
    return { deleted: true };
  }

  async testConnection(context: RequestContext, id: string) {
    const connection = await this.findConnection(context, id);
    try {
      const apiKey = connection.encryptedApiKey && connection.keyIv && connection.keyAuthTag
        ? decryptCredential({ encryptedApiKey: connection.encryptedApiKey, keyIv: connection.keyIv, keyAuthTag: connection.keyAuthTag, keyVersion: "v1" }, { organizationId: context.organizationId, connectionId: connection.id, provider: connection.provider })
        : null;
      return this.tester.test(connection, apiKey);
    } catch { return { connectionId: connection.id, provider: connection.provider, status: "unavailable" as const, success: false, message: "Không thể dùng credential đã lưu.", checkedAt: new Date().toISOString() }; }
  }

  /** Used by Task 02-03; it reads server-side agent data, never client tool claims. */
  async requireResearchPolicy(context: RequestContext, agentId: string, connectionId?: string) {
    const [agent] = await db.select().from(aiAgents).where(tenantWhere(context, aiAgents.organizationId, eq(aiAgents.id, agentId))).limit(1);
    if (!agent) throw new NotFoundException("Agent not found");
    if (agent.status !== "active") throw new BadRequestException({ code: "AGENT_NOT_ACTIVE", message: "Agent must be active for web research." });
    if (!agent.toolConfig.enabledTools.includes("web_research")) throw new BadRequestException({ code: "AGENT_CAPABILITY_REQUIRED", message: "Agent is not allowed to use web research." });
    if (connectionId) {
      const [connection] = await db.select().from(searchProviderConnections).where(tenantWhere(context, searchProviderConnections.organizationId, and(eq(searchProviderConnections.id, connectionId), eq(searchProviderConnections.provider, "tavily")))).limit(1);
      if (!connection) throw new NotFoundException("Search provider connection not found");
      if (!connection.enabled) throw new BadRequestException({ code: "SEARCH_PROVIDER_DISABLED", message: "The selected search provider connection is disabled." });
      return connection;
    }
    const connections = await db.select().from(searchProviderConnections).where(tenantWhere(context, searchProviderConnections.organizationId, and(eq(searchProviderConnections.provider, "tavily"), eq(searchProviderConnections.enabled, true)))).orderBy(asc(searchProviderConnections.createdAt), asc(searchProviderConnections.id)).limit(2);
    if (connections.length === 0) throw new BadRequestException({ code: "SEARCH_PROVIDER_NOT_CONFIGURED", message: "No enabled Tavily connection is configured for this organization." });
    if (connections.length > 1) throw new BadRequestException({ code: "SEARCH_PROVIDER_SELECTION_REQUIRED", message: "Select a Tavily connection explicitly." });
    return connections[0]!;
  }

  /** Ordered provider candidates for Hybrid Search. The caller may pin one
   * connection, otherwise it receives only enabled, non-open circuits. */
  async researchCandidates(context: RequestContext, agentId: string, options: { connectionId?: string; providers?: string[]; excludeProviders?: string[] } = {}) {
    const [agent] = await db.select().from(aiAgents).where(tenantWhere(context, aiAgents.organizationId, eq(aiAgents.id, agentId))).limit(1);
    if (!agent) throw new NotFoundException("Agent not found");
    if (agent.status !== "active") throw new BadRequestException({ code: "AGENT_NOT_ACTIVE", message: "Agent must be active for web research." });
    if (!agent.toolConfig.enabledTools.includes("web_research")) throw new BadRequestException({ code: "AGENT_CAPABILITY_REQUIRED", message: "Agent is not allowed to use web research." });
    const all = await db.select().from(searchProviderConnections).where(tenantWhere(context, searchProviderConnections.organizationId, eq(searchProviderConnections.enabled, true))).orderBy(asc(searchProviderConnections.priority), asc(searchProviderConnections.createdAt), asc(searchProviderConnections.id));
    const providerAllowed = (connection: SearchProviderConnection) => (!options.providers || options.providers.includes(connection.provider)) && !options.excludeProviders?.includes(connection.provider);
    if (options.connectionId) {
      const connection = all.find((item) => item.id === options.connectionId && providerAllowed(item));
      if (!connection) throw new NotFoundException("Search provider connection not found");
      if (connection.circuitOpenUntil && connection.circuitOpenUntil > new Date()) throw new BadRequestException({ code: "SEARCH_PROVIDER_CIRCUIT_OPEN", message: "Search provider đang tạm nghỉ sau các lỗi liên tiếp." });
      return [connection];
    }
    const candidates = all.filter((connection) => providerAllowed(connection) && (!connection.circuitOpenUntil || connection.circuitOpenUntil <= new Date()));
    if (!candidates.length) throw new BadRequestException({ code: "SEARCH_PROVIDER_NOT_CONFIGURED", message: "Chưa có Search Provider khả dụng cho Organization này." });
    return candidates;
  }

  async credentialFor(context: RequestContext, connection: SearchProviderConnection) {
    if (!connection.encryptedApiKey) return null;
    if (!connection.keyIv || !connection.keyAuthTag) throw new BadRequestException({ code: "SEARCH_PROVIDER_CREDENTIAL_INVALID", message: "Credential Search Provider không hợp lệ." });
    try { return decryptCredential({ encryptedApiKey: connection.encryptedApiKey, keyIv: connection.keyIv, keyAuthTag: connection.keyAuthTag, keyVersion: "v1" }, { organizationId: context.organizationId, connectionId: connection.id, provider: connection.provider }); }
    catch { throw new BadRequestException({ code: "SEARCH_PROVIDER_CREDENTIAL_INVALID", message: "Credential Search Provider không thể sử dụng." }); }
  }

  async markResearchSuccess(context: RequestContext, connectionId: string) {
    await db.update(searchProviderConnections).set({ consecutiveFailures: 0, circuitOpenUntil: null, updatedAt: new Date() }).where(tenantWhere(context, searchProviderConnections.organizationId, eq(searchProviderConnections.id, connectionId)));
  }

  async markResearchFailure(context: RequestContext, connection: SearchProviderConnection) {
    const failures = connection.consecutiveFailures + 1;
    const circuitOpenUntil = failures >= 3 ? new Date(Date.now() + 60_000) : null;
    await db.update(searchProviderConnections).set({ consecutiveFailures: failures, circuitOpenUntil, updatedAt: new Date() }).where(tenantWhere(context, searchProviderConnections.organizationId, eq(searchProviderConnections.id, connection.id)));
  }
}
