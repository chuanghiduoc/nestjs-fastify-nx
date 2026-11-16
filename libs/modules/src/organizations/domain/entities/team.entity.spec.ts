import { describe, expect, it } from 'vitest';
import { DomainException } from '@nestjs-fastify-nx/core';
import { Team } from './team.entity';

const ORG_ID = '019dd1a5-9235-70db-8d57-54ef90600002';

describe('Team', () => {
  it('trims the name on creation', () => {
    expect(Team.create({ organizationId: ORG_ID, name: '  Platform  ' }).name).toBe('Platform');
  });

  it('rejects a name that is blank after trimming', () => {
    expect(() => Team.create({ organizationId: ORG_ID, name: '   ' })).toThrow(DomainException);
  });

  it('rejects a name beyond 100 characters', () => {
    expect(() => Team.create({ organizationId: ORG_ID, name: 'x'.repeat(101) })).toThrow(
      DomainException,
    );
  });

  it('renames without mutating the original and stamps updatedAt', () => {
    const team = Team.create({ organizationId: ORG_ID, name: 'Platform' });

    const renamed = team.renamedTo('Infrastructure');

    expect(renamed.name).toBe('Infrastructure');
    expect(renamed.id).toBe(team.id);
    expect(renamed.updatedAt).toBeInstanceOf(Date);
    expect(team.name).toBe('Platform');
  });

  it('validates the new name on rename', () => {
    const team = Team.create({ organizationId: ORG_ID, name: 'Platform' });

    expect(() => team.renamedTo('  ')).toThrow(DomainException);
  });
});
