import { IsBoolean, IsString, MaxLength, MinLength } from 'class-validator';

// PhantomPulse: bodies for the public comment endpoints.
export class ReplyCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  message: string;
}

export class HideCommentDto {
  @IsBoolean()
  hidden: boolean;
}
