import { IsArray, IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";
export class CreateBusinessDoctrineDto { @IsString() @MaxLength(120) title!: string; @IsArray() @IsString({ each: true }) @MaxLength(1200, { each: true }) principles!: string[]; @IsOptional() @IsBoolean() enabled?: boolean; }
export class ToggleBusinessDoctrineDto { @IsBoolean() enabled!: boolean; }
