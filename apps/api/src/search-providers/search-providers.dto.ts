import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

import { SEARCH_PROVIDER_TYPES, type SearchProviderType } from "@workspace/db/node";

export class CreateSearchProviderDto {
  @ApiProperty({ enum: SEARCH_PROVIDER_TYPES })
  @IsIn(SEARCH_PROVIDER_TYPES)
  provider!: SearchProviderType;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ writeOnly: true, description: "Required for Tavily/Brave, not used by self-hosted SearXNG." })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  apiKey?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 1000, default: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  priority?: number;
}

export class UpdateSearchProviderDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ writeOnly: true })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  apiKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 1000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  priority?: number;
}
