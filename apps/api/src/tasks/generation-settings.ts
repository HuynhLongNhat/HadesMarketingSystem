import { z } from "zod";
export const generationPresetSchema = z.enum(["fast", "balanced", "deep"]);
export const generationSettingsSchema = z.object({ preset: generationPresetSchema.default("balanced"), maxOutputTokens: z.number().int().min(1).max(8000).nullable().default(null), timeoutSeconds: z.number().int().min(10).max(180).nullable().default(null), temperature: z.number().min(0).max(1).nullable().default(null), reasoningEffort: z.enum(["low", "medium", "high"]).nullable().default(null) });
export type AiGenerationSettings = z.infer<typeof generationSettingsSchema>;
const preset = { fast: { maxOutputTokens: 2000, timeoutSeconds: 60 }, balanced: { maxOutputTokens: 4000, timeoutSeconds: 120 }, deep: { maxOutputTokens: 8000, timeoutSeconds: 180 } } as const;
export function resolveGenerationSettings(value: unknown): Required<Pick<AiGenerationSettings, "preset" | "maxOutputTokens" | "timeoutSeconds">> & AiGenerationSettings { const input = generationSettingsSchema.parse(value ?? {}); const fallback = preset[input.preset]; return { ...input, maxOutputTokens: input.maxOutputTokens ?? fallback.maxOutputTokens, timeoutSeconds: input.timeoutSeconds ?? fallback.timeoutSeconds }; }
