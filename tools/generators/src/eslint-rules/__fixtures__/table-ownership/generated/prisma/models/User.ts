import type {
  MemberCreateNestedManyWithoutUserInput,
  MemberFindManyArgs,
  MemberListRelationFilter,
} from './Member';
import type { GetSelect, SelectSubset, XOR } from '../internal/prismaNamespace';

export type UserWhereInput = {
  id?: string;
  email?: string;
  status?: string;
  memberships?: MemberListRelationFilter;
  AND?: UserWhereInput[];
  OR?: UserWhereInput[];
};

export type UserInclude = {
  memberships?: boolean | MemberFindManyArgs;
};

export type UserSelect = GetSelect<{
  id?: boolean;
  memberships?: boolean | MemberFindManyArgs;
}>;

export type UserFindManyArgs = {
  where?: UserWhereInput;
  include?: UserInclude;
  select?: UserSelect;
  take?: number;
};

export type UserCreateInput = {
  email: string;
  memberships?: MemberCreateNestedManyWithoutUserInput;
};

export type UserFindUniqueArgs = {
  where: UserWhereInput;
  include?: UserInclude;
};

export type UserCreateArgs = {
  data: UserCreateInput;
};

export type UserUpdateInput = {
  email?: string;
  memberships?: MemberCreateNestedManyWithoutUserInput;
};

export type UserUncheckedUpdateInput = {
  id?: string;
  email?: string;
};

export type UserUpdateArgs = {
  where: UserWhereInput;
  data: XOR<UserUpdateInput, UserUncheckedUpdateInput>;
};

export type UserDeleteManyArgs = {
  where?: UserWhereInput;
};

export interface UserDelegate {
  findMany<T extends UserFindManyArgs>(
    args?: SelectSubset<T, UserFindManyArgs>,
  ): Promise<unknown[]>;
  findUnique<T extends UserFindUniqueArgs>(
    args: SelectSubset<T, UserFindUniqueArgs>,
  ): Promise<unknown>;
  create<T extends UserCreateArgs>(args: SelectSubset<T, UserCreateArgs>): Promise<unknown>;
  update<T extends UserUpdateArgs>(args: SelectSubset<T, UserUpdateArgs>): Promise<unknown>;
  deleteMany<T extends UserDeleteManyArgs>(
    args?: SelectSubset<T, UserDeleteManyArgs>,
  ): Promise<{ count: number }>;
}
