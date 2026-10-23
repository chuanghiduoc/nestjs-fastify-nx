import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsPositive, IsString, MaxLength } from 'class-validator';

const MAX_LOCATION_LENGTH = 1024;
const MAX_SIGNATURE_LENGTH = 128;

export class LocalDownloadQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_LOCATION_LENGTH)
  bucket!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_LOCATION_LENGTH)
  key!: string;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  expires!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_SIGNATURE_LENGTH)
  signature!: string;
}
