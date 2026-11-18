import type { SelectSubset } from '../internal/prismaNamespace';
import type { UserWhereInput } from './User';

export type MemberWhereInput = {
  organizationId?: string;
  role?: string;
  user?: UserWhereInput;
};

export type MemberListRelationFilter = {
  every?: MemberWhereInput;
  some?: MemberWhereInput;
  none?: MemberWhereInput;
};

export type MemberSelect = {
  role?: boolean;
};

export type MemberFindManyArgs = {
  where?: MemberWhereInput;
  select?: MemberSelect;
};

export type MemberCreateWithoutUserInput = {
  organizationId: string;
  role?: string;
};

export type MemberCreateNestedManyWithoutUserInput = {
  create?: MemberCreateWithoutUserInput[];
};

export type MemberCreateArgs = {
  data: MemberCreateWithoutUserInput;
};

export interface MemberDelegate {
  findMany<T extends MemberFindManyArgs>(
    args?: SelectSubset<T, MemberFindManyArgs>,
  ): Promise<unknown[]>;
  create<T extends MemberCreateArgs>(args: SelectSubset<T, MemberCreateArgs>): Promise<unknown>;
}
