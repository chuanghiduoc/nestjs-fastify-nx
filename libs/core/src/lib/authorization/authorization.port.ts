import type { Permission, ResourceType } from '@nestjs-fastify-nx/shared';

export const AUTHORIZATION_PORT = Symbol('AUTHORIZATION_PORT');

export type Principal =
  | {
      readonly type: 'user';
      readonly userId: string;
      readonly organizationId: string;
      readonly membershipId?: string;
    }
  | {
      readonly type: 'api_key';
      readonly apiKeyId: string;
      readonly organizationId: string;
      readonly scopes: readonly string[];
    }
  | { readonly type: 'system'; readonly reason: string };

export interface ResourceRef {
  readonly type: ResourceType;
  readonly id: string;
  readonly ownerId?: string;
  readonly organizationId?: string;
  readonly parent?: ResourceRef;
}

export interface AccessDecision {
  readonly allowed: boolean;
  readonly reason?: string;
}

/**
 * What an engine can say about a *set* of resources.
 *
 * `predicate` is a query condition an engine can express because its data lives beside the domain
 * data (the Postgres PBAC adapter). `ids` is an enumeration, which is all a relationship engine
 * (OpenFGA/SpiceDB ListObjects) can produce. Every consumer must handle all four branches from day
 * one — that is what makes swapping the engine an adapter change instead of a rewrite of every
 * list endpoint. `truncated` says the enumeration hit the engine's ceiling and is incomplete;
 * silently returning a short page would read as an empty state.
 */
export type AccessFilter =
  | { readonly kind: 'all' }
  | { readonly kind: 'none' }
  | { readonly kind: 'predicate'; readonly where: Record<string, unknown> }
  | { readonly kind: 'ids'; readonly ids: readonly string[]; readonly truncated: boolean };

export interface AuthorizationCapabilities {
  readonly predicateFilter: boolean;
  readonly hierarchy: boolean;
  readonly consistency: 'strong' | 'eventual';
  readonly maxEnumeratedObjects?: number;
}

export interface CheckRequest {
  readonly permission: Permission;
  readonly resource?: ResourceRef;
}

export interface RelationInput {
  readonly relation: string;
  readonly subject: Principal | ResourceRef;
}

export interface AuthorizationPort {
  check(
    principal: Principal,
    permission: Permission,
    resource?: ResourceRef,
    options?: { consistency?: 'strong' | 'eventual' },
  ): Promise<AccessDecision>;

  checkMany(
    principal: Principal,
    requests: readonly CheckRequest[],
  ): Promise<readonly AccessDecision[]>;

  filter(
    principal: Principal,
    permission: Permission,
    resourceType: ResourceType,
  ): Promise<AccessFilter>;

  /**
   * No-op under PBAC, where reachability is derivable from `organizationId`/`ownerId`. A
   * relationship engine writes the tuples that make the resource reachable here. It exists before
   * it is needed so adopting one later does not mean threading a hook through every command
   * handler; call it inside the same transaction as the aggregate write.
   */
  onResourceCreated(input: {
    readonly actor: Principal;
    readonly resource: ResourceRef;
    readonly relations?: readonly RelationInput[];
  }): Promise<void>;

  onResourceDeleted(resource: ResourceRef): Promise<void>;

  permissionsFor(principal: Principal): Promise<readonly Permission[]>;

  readonly capabilities: AuthorizationCapabilities;
}
