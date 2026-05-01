import { ObjectType, Field, ID } from '@nestjs/graphql';
import { UserRole, UserStatus } from './user-enums';

@ObjectType()
export class UserType {
  @Field(() => ID)
  id!: string;

  @Field()
  email!: string;

  @Field()
  name!: string;

  @Field(() => UserRole)
  role!: UserRole;

  @Field(() => UserStatus)
  status!: UserStatus;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;
}
