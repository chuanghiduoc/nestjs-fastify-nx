import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class ConfirmUploadDto {
  @ApiProperty({
    description: 'Storage key returned by the previous /upload/presign call.',
    example:
      'uploads/019dd1a5-9235-70db-8d57-54ef901d8185/019dd1a6-102a-7b25-a5a3-54b298b81864.png',
    maxLength: 256,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  @Matches(
    /^uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[A-Za-z0-9._-]+$/i,
    {
      message: 'key must be a previously issued uploads/<user-id>/<file-id>.<ext> path',
    },
  )
  key!: string;
}
