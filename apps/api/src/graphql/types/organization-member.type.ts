import { Field, ID, ObjectType } from '@nestjs/graphql';
import { UserStatus } from './user-enums';

@ObjectType()
export class OrganizationMemberType {
  @Field(() => ID)
  id!: string;

  @Field()
  email!: string;

  @Field()
  name!: string;

  @Field()
  role!: string;

  @Field(() => UserStatus)
  status!: UserStatus;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;
}
