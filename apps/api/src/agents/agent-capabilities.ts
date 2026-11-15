import { BadRequestException } from "@nestjs/common";

/** Server-owned capability vocabulary. Unknown client supplied tool names are rejected. */
/** Server-owned capability vocabulary. Capabilities express allowed product actions, not model claims. */
export const AGENT_CAPABILITIES = ["web_research", "strategic_review"] as const;
export type AgentCapability = (typeof AGENT_CAPABILITIES)[number];

export function normalizeAgentCapabilities(tools: string[] | undefined): AgentCapability[] | undefined {
  if (tools === undefined) return undefined;
  const normalized = [...new Set(tools.map((tool) => tool.trim()))];
  if (normalized.some((tool) => !AGENT_CAPABILITIES.includes(tool as AgentCapability))) {
    throw new BadRequestException({ code: "UNSUPPORTED_AGENT_CAPABILITY", message: "One or more agent capabilities are not supported." });
  }
  return normalized as AgentCapability[];
}
