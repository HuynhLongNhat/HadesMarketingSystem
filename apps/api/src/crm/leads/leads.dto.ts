import {Type} from "class-transformer";
import {IsIn,IsInt,IsOptional,IsString,Matches,Max,MaxLength,Min,IsDateString} from "class-validator";
export const stages=["new","attempting","connected","qualified","disqualified","converted"] as const;
export const editableStages=["new","attempting","connected","qualified","disqualified"] as const;
export class LeadInput {
 @IsString() @Matches(/\S/) @MaxLength(200) title!:string;
 @IsOptional() @IsString() @MaxLength(128) companyId?:string;
 @IsOptional() @IsString() @MaxLength(128) contactId?:string;
 @IsOptional() @IsString() @MaxLength(10000) description?:string;
 @IsOptional() @Matches(/^\d{1,16}(\.\d{1,2})?$|^$/) budgetMin?:string;
 @IsOptional() @Matches(/^\d{1,16}(\.\d{1,2})?$|^$/) budgetMax?:string;
 @IsOptional() @IsIn(["VND","USD"]) currency?:"VND"|"USD";
 @IsOptional() @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) expectedStartDate?:string;
 @IsOptional() @IsIn(["low","medium","high"]) priority?:"low"|"medium"|"high";
 @IsOptional() @IsString() @MaxLength(120) source?:string;
 @IsOptional() @IsString() @MaxLength(128) ownerMemberId?:string;
 @IsOptional() @IsString() @MaxLength(2000) notes?:string;
}
export class LeadStatusInput {
 @IsIn(editableStages) status!:typeof editableStages[number];
 @IsOptional() @IsString() @MaxLength(2000) disqualifiedReason?:string;
}
export class ListLeadsDto {
 @IsOptional() @IsString() @MaxLength(200) search?:string;
 @IsOptional() @IsIn(stages) status?:typeof stages[number];
 @IsOptional() @IsIn(["low","medium","high"]) priority?:"low"|"medium"|"high";
 @IsOptional() @IsIn(["active","archived"]) archive?:"active"|"archived";
 @IsOptional() @IsString() @MaxLength(128) companyId?:string;
 @IsOptional() @IsString() @MaxLength(128) contactId?:string;
 @IsOptional() @IsIn(["updated","created","title"]) sort?:"updated"|"created"|"title";
 @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(100000) page=1;
}
