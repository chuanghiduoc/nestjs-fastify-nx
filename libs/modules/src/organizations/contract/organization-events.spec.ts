import { describe, expect, it } from 'vitest';
import { generateId } from '@nestjs-fastify-nx/shared';
import {
  organizationCreatedPayloadSchema,
  organizationDeletedPayloadSchema,
  organizationMemberAddedPayloadSchema,
  organizationMemberRemovedPayloadSchema,
  organizationMemberRoleUpdatedPayloadSchema,
  organizationRoleChangedPayloadSchema,
} from './index';

describe('organization event payload schemas', () => {
  it.each([
    ['organizations.created', organizationCreatedPayloadSchema],
    ['organizations.deleted', organizationDeletedPayloadSchema],
  ])('%s accepts the name and slug its trigger emits', (_event, schema) => {
    expect(schema.safeParse({ name: 'Acme', slug: 'acme' }).success).toBe(true);
    expect(schema.safeParse({ name: 'Acme' }).success).toBe(false);
    expect(schema.safeParse({ slug: 'acme' }).success).toBe(false);
  });

  it.each([
    ['organizations.member_added', organizationMemberAddedPayloadSchema],
    ['organizations.member_removed', organizationMemberRemovedPayloadSchema],
  ])('%s accepts the member id and role its trigger emits', (_event, schema) => {
    const userId = generateId();
    expect(schema.safeParse({ userId, role: 'member' }).success).toBe(true);
    expect(schema.safeParse({ userId }).success).toBe(false);
    expect(schema.safeParse({ role: 'member' }).success).toBe(false);
    expect(schema.safeParse({ userId: 'not-a-uuid', role: 'member' }).success).toBe(false);
  });

  it('organizations.member_role_updated requires the previous and the new role', () => {
    const userId = generateId();
    expect(
      organizationMemberRoleUpdatedPayloadSchema.safeParse({
        userId,
        oldRole: 'member',
        role: 'admin',
      }).success,
    ).toBe(true);
    expect(
      organizationMemberRoleUpdatedPayloadSchema.safeParse({ userId, role: 'admin' }).success,
    ).toBe(false);
  });

  it.each(['INSERT', 'UPDATE', 'DELETE'])(
    'organizations.role_changed accepts the %s action its trigger emits',
    (action) => {
      expect(
        organizationRoleChangedPayloadSchema.safeParse({ role: 'auditor', action }).success,
      ).toBe(true);
    },
  );

  it('organizations.role_changed rejects a missing or unknown action', () => {
    expect(organizationRoleChangedPayloadSchema.safeParse({ role: 'auditor' }).success).toBe(false);
    expect(
      organizationRoleChangedPayloadSchema.safeParse({ role: 'auditor', action: 'TRUNCATE' })
        .success,
    ).toBe(false);
  });
});
