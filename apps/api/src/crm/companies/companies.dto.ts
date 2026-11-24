import { Type } from "class-transformer";
import { IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from "class-validator";

export class CompanyFieldsDto {
  @IsOptional() @IsString() @MaxLength(32) taxCode?: string;
  @IsOptional() @IsString() @MaxLength(500) website?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @ValidateIf((_, value) => value !== undefined && value !== null && value !== "") @IsEmail() @MaxLength(320) email?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
export class CreateCompanyDto extends CompanyFieldsDto {
  @IsString() @Matches(/\S/) @MaxLength(200) name!: string;
}
export class UpdateCompanyDto extends CompanyFieldsDto {
  @ValidateIf((_, value) => value !== undefined) @IsString() @Matches(/\S/) @MaxLength(200) name?: string;
}
export class ListCompaniesDto {
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsIn(["active", "archived", "all"]) status?: "active" | "archived" | "all";
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
export class LinkCompanyContactDto {
  @IsString() @Matches(/\S/) @MaxLength(128) contactId!: string;
}
