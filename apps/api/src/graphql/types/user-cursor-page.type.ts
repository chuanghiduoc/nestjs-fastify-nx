import { ObjectType, Field } from '@nestjs/graphql';
import { OrganizationMemberType } from './organization-member.type';

@ObjectType()
export class UserCursorPageType {
  @Field(() => [OrganizationMemberType])
  data!: OrganizationMemberType[];

  @Field()
  hasMore!: boolean;

  @Field(() => String, { nullable: true })
  lastCursor!: string | null;
}
