import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from "class-validator";

export class ResumeMarketResearchDto {
  @IsOptional() @IsBoolean() refreshAgentConfiguration?: boolean;
}

export class CreateMarketIntelligenceProjectDto {
  @IsString() @MaxLength(200) title!: string;
  @IsString() @MaxLength(200) industry!: string;
  @IsString() @MaxLength(200) market!: string;
  @IsString() @MaxLength(6000) objective!: string;
  @IsOptional() @IsString() @MaxLength(500) targetAudience?: string;
  @IsOptional() @IsInt() @Min(1) @Max(20) maxSources?: number;
  @IsOptional() @IsIn(["searxng", "tavily"]) researchProvider?: "searxng" | "tavily";
  @IsUUID() researchAgentId!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(8) @IsString({ each: true }) @MaxLength(160, { each: true }) keywords?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(2048, { each: true }) sourceUrls?: string[];
}
