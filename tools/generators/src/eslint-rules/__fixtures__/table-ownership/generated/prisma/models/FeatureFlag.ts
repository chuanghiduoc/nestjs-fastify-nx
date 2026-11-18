export type FeatureFlagWhereInput = {
  organizationId?: string;
  key?: string;
};

export interface FeatureFlagDelegate {
  findMany(args?: { where?: FeatureFlagWhereInput }): Promise<unknown[]>;
  updateMany(args: {
    where: FeatureFlagWhereInput;
    data: { enabled?: boolean };
  }): Promise<{ count: number }>;
}
