import { apiFetch } from "./api-client";

export type GenerationPreset = "fast" | "balanced" | "deep";
export type ReasoningEffort = "low" | "medium" | "high";
export type CeoExecutionSourceType = "api_provider" | "chatgpt_plan";
export type CeoExecutionSourceSnapshot = { version:"v1"; type:"api_provider"; organizationId:string; requestedByUserId:string; providerConnectionId:string; modelId:string } | { version:"v1"; type:"chatgpt_plan"; organizationId:string; requestedByUserId:string; modelId:string|null };
export type CeoGenerationSettings = { preset: GenerationPreset; maxOutputTokens: number; timeoutSeconds: number; reasoningEffort: ReasoningEffort | null };
export type CreateCeoPlanInput = { ceoAgentId: string; title: string; objective: string; additionalContext?: string; preset: GenerationPreset; maxOutputTokens?: number; timeoutSeconds?: number; executionSource?: CeoExecutionSourceType };
export type CeoBusinessProfileSnapshot = { profile: Record<string, unknown> | null; missingFields: string[]; agents?: Array<{ id?: string; ref?: string; name?: string; role?: string; enabledTools?: string[]; status?: string }> };
export type CeoStructuredPlan = Record<string, unknown>;
export type CeoPlan = { id:string; ceoAgentId:string; taskId:string; title:string; objective:string; additionalContext:string|null; businessProfileSnapshot:CeoBusinessProfileSnapshot|null; businessProfileSnapshotAt:string|null; contextVersion:string|null; structuredPlan:CeoStructuredPlan|null; structuredPlanVersion:string|null; generationSettings:CeoGenerationSettings|null; executionSource:CeoExecutionSourceSnapshot|null; approvalStatus:"pending"|"approved"|"rejected"; decisionNote:string|null; decidedAt:string|null; retryOfPlanId:string|null; retryPlanId:string|null; retryStartedAt:string|null; retryCount:number; taskStatus:"queued"|"running"|"completed"|"failed"|"cancelled"|null; createdAt:string; updatedAt:string };

/** Removes UI-only and unsupported fields before the request reaches Nest DTO validation. */
export function createCeoPlanPayload(input: CreateCeoPlanInput): CreateCeoPlanInput {
  return {
    ceoAgentId: input.ceoAgentId,
    title: input.title,
    objective: input.objective,
    ...(input.additionalContext ? { additionalContext: input.additionalContext } : {}),
    preset: input.preset,
    ...(input.maxOutputTokens === undefined ? {} : { maxOutputTokens: input.maxOutputTokens }),
    ...(input.timeoutSeconds === undefined ? {} : { timeoutSeconds: input.timeoutSeconds }),
    ...(input.executionSource === undefined ? {} : { executionSource: input.executionSource }),
  };
}

export const ceoPlanningApi = {
  list: () => apiFetch<CeoPlan[]>("/ceo-plans"),
  create: (input: CreateCeoPlanInput) => apiFetch<CeoPlan>("/ceo-plans", { method:"POST", body:JSON.stringify(createCeoPlanPayload(input)) }),
  retry: (id:string) => apiFetch<CeoPlan>(`/ceo-plans/${encodeURIComponent(id)}/retry`, { method:"POST" }),
  decide: (id:string, input:{decision:"approved"|"rejected";note?:string}) => apiFetch<CeoPlan>(`/ceo-plans/${encodeURIComponent(id)}/decision`, { method:"POST", body:JSON.stringify(input) }),
  remove: (id:string) => apiFetch<{deleted:true}>(`/ceo-plans/${encodeURIComponent(id)}`, { method:"DELETE" }),
};
