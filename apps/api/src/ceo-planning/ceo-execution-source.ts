import { BadRequestException } from "@nestjs/common";
import { z } from "zod";

export const ceoExecutionSourceTypeSchema = z.enum(["api_provider", "chatgpt_plan"]);
export type CeoExecutionSourceType = z.infer<typeof ceoExecutionSourceTypeSchema>;

const apiProviderExecutionSourceSchema = z.object({
  version: z.literal("v1"),
  type: z.literal("api_provider"),
  organizationId: z.string().min(1),
  requestedByUserId: z.string().min(1),
  providerConnectionId: z.string().min(1),
  modelId: z.string().min(1),
});

/**
 * Reserved shape only. SIWC tokens and authorization references are deliberately
 * not accepted or stored until an approved, user-controlled runtime exists.
 */
const chatgptPlanExecutionSourceSchema = z.object({
  version: z.literal("v1"),
  type: z.literal("chatgpt_plan"),
  organizationId: z.string().min(1),
  requestedByUserId: z.string().min(1),
  modelId: z.string().min(1).nullable(),
});

export const ceoExecutionSourceSnapshotSchema = z.discriminatedUnion("type", [
  apiProviderExecutionSourceSchema,
  chatgptPlanExecutionSourceSchema,
]);
export type CeoExecutionSourceSnapshot = z.infer<typeof ceoExecutionSourceSnapshotSchema>;

export function apiProviderExecutionSource(input: {
  organizationId: string;
  requestedByUserId: string;
  providerConnectionId: string | null;
  modelId: string | null;
}): CeoExecutionSourceSnapshot {
  if (!input.providerConnectionId || !input.modelId) {
    throw new BadRequestException("Không thể snapshot AI Provider cho kế hoạch CEO.");
  }
  return {
    version: "v1",
    type: "api_provider",
    organizationId: input.organizationId,
    requestedByUserId: input.requestedByUserId,
    providerConnectionId: input.providerConnectionId,
    modelId: input.modelId,
  };
}

/** Fail closed until SIWC approval and a user-controlled runtime are implemented. */
export function assertSupportedExecutionSource(source: CeoExecutionSourceType | undefined) {
  if (source === "chatgpt_plan") {
    throw new BadRequestException(
      "ChatGPT Plan chưa khả dụng: Nova chưa có SIWC approval và user-controlled runtime được xác nhận.",
    );
  }
}

export function storedExecutionSource(value: unknown): CeoExecutionSourceSnapshot | null {
  const parsed = ceoExecutionSourceSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
