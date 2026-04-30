import { ObjectType, Field, Int } from '@nestjs/graphql';
import { UserType } from './user.type';

@ObjectType()
export class PageMetaType {
  @Field(() => Int)
  page!: number;

  @Field(() => Int)
  limit!: number;

  @Field(() => Int)
  total!: number;

  @Field(() => Int)
  totalPages!: number;

  @Field()
  hasPrevPage!: boolean;

  @Field()
  hasNextPage!: boolean;
}

@ObjectType()
export class UserPageType {
  @Field(() => [UserType])
  data!: UserType[];

  @Field(() => PageMetaType)
  meta!: PageMetaType;
}
