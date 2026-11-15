import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

export class CreateMarketIntelligenceProjectDto {
  @IsString() @MaxLength(200) title!: string;
  @IsString() @MaxLength(200) industry!: string;
  @IsString() @MaxLength(200) market!: string;
  @IsString() @MaxLength(6000) objective!: string;
  @IsUUID() researchAgentId!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(8) @IsString({ each: true }) @MaxLength(160, { each: true }) keywords?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(2048, { each: true }) sourceUrls?: string[];
}
