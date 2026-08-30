import { Field, ID, ObjectType } from '@nestjs/graphql';
import { UserStatus } from './user-enums';

@ObjectType({ isAbstract: true })
export abstract class MemberIdentityFields {
  @Field(() => ID)
  id!: string;

  @Field()
  email!: string;

  @Field()
  name!: string;

  @Field(() => UserStatus)
  status!: UserStatus;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;
}
