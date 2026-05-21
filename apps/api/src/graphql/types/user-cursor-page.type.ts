import { ObjectType, Field } from '@nestjs/graphql';
import { UserType } from './user.type';

@ObjectType()
export class UserCursorPageType {
  @Field(() => [UserType])
  data!: UserType[];

  @Field()
  hasMore!: boolean;

  @Field(() => String, { nullable: true })
  lastCursor!: string | null;
}
