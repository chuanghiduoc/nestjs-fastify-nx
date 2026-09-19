export const AUTH_SESSION_POLICY = Symbol('AUTH_SESSION_POLICY');

export interface AuthSessionPolicy {
  resolveOrganizationId(userId: string): Promise<string>;
}
