import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from "class-validator";
import { CEO_PLAN_APPROVAL_STATUSES } from "@workspace/db/node";

export class CreateCeoPlanDto {
  @IsUUID() ceoAgentId!: string;
  @IsString() @MaxLength(200) title!: string;
  @IsString() @MaxLength(12000) objective!: string;
  @IsOptional() @IsString() @MaxLength(4000) additionalContext?: string;
  @IsOptional() @IsIn(["fast", "balanced", "deep"] as const) preset?: "fast" | "balanced" | "deep";
  @IsOptional() @IsInt() @Min(1) @Max(8000) maxOutputTokens?: number;
  @IsOptional() @IsInt() @Min(10) @Max(180) timeoutSeconds?: number;
  @IsOptional() @IsIn(["low", "medium", "high"] as const) reasoningEffort?: "low" | "medium" | "high";
  @IsOptional() @IsIn(["api_provider", "chatgpt_plan"] as const) executionSource?: "api_provider" | "chatgpt_plan";
}
export class DecideCeoPlanDto {
  @IsIn(["approved", "rejected"] as const) decision!: typeof CEO_PLAN_APPROVAL_STATUSES[number];
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}
export class CreateStrategicReviewDto {
  @IsString() @MaxLength(200) providerConnectionId!: string;
  @IsString() @MaxLength(200) modelId!: string;
}
