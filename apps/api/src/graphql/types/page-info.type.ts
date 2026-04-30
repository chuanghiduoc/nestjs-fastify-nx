import { ObjectType, Field, Int } from '@nestjs/graphql';

@ObjectType()
export class PageInfoType {
  @Field(() => Int)
  total!: number;

  @Field(() => Int)
  page!: number;

  @Field(() => Int)
  limit!: number;
}
