import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class ConfirmUploadDto {
  @ApiProperty({
    description: 'Storage key returned by the previous /upload/presign call.',
    example: 'uploads/019dd1a5-9235-70db-8d57-54ef901d8185.png',
    maxLength: 256,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  @Matches(/^uploads\/[A-Za-z0-9._-]+$/, {
    message: 'key must be a previously issued uploads/<id>.<ext> path',
  })
  key!: string;
}
