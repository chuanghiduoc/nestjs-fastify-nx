import { ObjectType, Field } from '@nestjs/graphql';
import { UserRole } from './user-enums';
import { MemberIdentityFields } from './member-identity-fields.type';

@ObjectType()
export class UserType extends MemberIdentityFields {
  @Field(() => UserRole)
  role!: UserRole;
}
