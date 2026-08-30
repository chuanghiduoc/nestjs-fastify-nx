import { Field, ObjectType } from '@nestjs/graphql';
import { MemberIdentityFields } from './member-identity-fields.type';

@ObjectType()
export class OrganizationMemberType extends MemberIdentityFields {
  @Field()
  role!: string;
}
