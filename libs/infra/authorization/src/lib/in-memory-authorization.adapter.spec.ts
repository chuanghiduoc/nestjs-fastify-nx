import type { Permission } from '@nestjs-fastify-nx/shared';
import { InMemoryAuthorizationAdapter } from './in-memory-authorization.adapter';
import { describeAuthorizationConformance } from './authorization-conformance';

describeAuthorizationConformance({
  name: 'InMemoryAuthorizationAdapter',
  async create() {
    const adapter = new InMemoryAuthorizationAdapter();
    return {
      authorization: adapter,
      async grantRoles(organizationId, userId, roles) {
        adapter.setMemberRoles(organizationId, userId, roles);
      },
      async defineCustomRole(organizationId, role, permissions) {
        adapter.defineCustomRole(organizationId, role, permissions as readonly Permission[]);
      },
    };
  },
});
