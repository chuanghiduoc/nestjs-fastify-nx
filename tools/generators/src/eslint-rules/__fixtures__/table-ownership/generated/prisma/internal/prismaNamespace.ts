export type SelectAndInclude = {
  select: unknown;
  include: unknown;
};

export type SelectSubset<T, U> = {
  [key in keyof T]: key extends keyof U ? T[key] : never;
} & (T extends SelectAndInclude ? 'Please either choose `select` or `include`.' : object);

type Without<T, U> = { [P in Exclude<keyof T, keyof U>]?: never };

export type XOR<T, U> = T extends object
  ? U extends object
    ? ((Without<T, U> & U) | (Without<U, T> & T)) & object
    : U
  : T;

export type GetSelect<Base, KR extends PropertyKey = never> = {
  [K in KR | keyof Base]?: K extends keyof Base ? Base[K] : boolean;
};
