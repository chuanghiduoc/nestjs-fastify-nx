import { ArgsType, Field, Int } from '@nestjs/graphql';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { UserRole, UserStatus } from '../types/user-enums';

@ArgsType()
export class ListUsersArgs {
  @Field(() => Int, { defaultValue: 1 })
  @IsInt()
  @Min(1)
  page = 1;

  @Field(() => Int, { defaultValue: 20 })
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @Field(() => UserRole, { nullable: true })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @Field(() => UserStatus, { nullable: true })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
