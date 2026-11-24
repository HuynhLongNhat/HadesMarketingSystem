import { Type } from "class-transformer";
import { IsIn, IsISO8601, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator";
const types = ["note","call","meeting","email","message"] as const;
export class ActivityInput {
  @IsIn(types) type!: typeof types[number];
  @IsString() @Matches(/\S/) @MaxLength(200) subject!: string;
  @IsOptional() @IsString() @MaxLength(10000) body?: string;
  @IsOptional() @IsString() @MaxLength(2000) outcome?: string;
  @IsISO8601({strict:true}) occurredAt!: string;
}
export class CreateActivityDto extends ActivityInput {
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(128) relatedId?: string;
}
export class ListActivitiesDto {
  @IsOptional() @IsIn(types) type?: typeof types[number];
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(100000) page=1;
  @IsOptional() @IsIn(["active","archived"]) status?: "active"|"archived";
}
