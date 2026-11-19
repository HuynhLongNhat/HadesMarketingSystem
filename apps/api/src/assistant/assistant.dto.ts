import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from "class-validator";
export class RenameAssistantConversationDto {
  @IsString() @MinLength(1) @MaxLength(160) title!: string;
}
export class AssistantMessageDto {
  @IsUUID() requestId!: string;
  @IsString() @MinLength(1) @MaxLength(8000) content!: string;
  @IsString() @MinLength(1) @MaxLength(200) connectionId!: string;
  @IsString() @MinLength(1) @MaxLength(200) modelId!: string;
  @IsOptional() @IsBoolean() retry?: boolean;
}
