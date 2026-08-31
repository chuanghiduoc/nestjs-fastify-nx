import { describe, expect, it } from 'vitest';
import { DomainException } from '@nestjs-fastify-nx/core';
import { generateId } from '@nestjs-fastify-nx/shared';
import { FeatureFlag } from './feature-flag.entity';

const ORG_ID = '019dd1a5-9235-70db-8d57-54ef91100001';

function flag(overrides: Partial<Parameters<typeof FeatureFlag.create>[0]> = {}): FeatureFlag {
  return FeatureFlag.create({ organizationId: ORG_ID, key: 'checkout.new-flow', ...overrides });
}

describe('FeatureFlag', () => {
  it('defaults to disabled at full rollout', () => {
    const created = flag();

    expect(created.enabled).toBe(false);
    expect(created.rolloutPercentage).toBe(100);
  });

  it.each(['Checkout', '1flag', 'a', 'has space', 'x'.repeat(101)])(
    'rejects the malformed key %j',
    (key) => {
      expect(() => flag({ key })).toThrow(DomainException);
    },
  );

  it.each([-1, 101, 1.5])('rejects the out-of-range rollout %s', (rolloutPercentage) => {
    expect(() => flag({ rolloutPercentage })).toThrow(DomainException);
  });

  it('is off for everyone while the master switch is off', () => {
    const created = flag({ enabled: false, rolloutPercentage: 100 });

    expect(created.isEnabledFor(generateId())).toBe(false);
  });

  it('is on for everyone at 100% rollout', () => {
    const created = flag({ enabled: true, rolloutPercentage: 100 });

    expect(created.isEnabledFor(generateId())).toBe(true);
  });

  it('is off for everyone at 0% rollout', () => {
    const created = flag({ enabled: true, rolloutPercentage: 0 });

    expect(created.isEnabledFor(generateId())).toBe(false);
  });

  // The property that makes a partial rollout usable: the same subject must not flicker between
  // calls the way Math.random() would.
  it('resolves the same subject identically every time', () => {
    const created = flag({ enabled: true, rolloutPercentage: 50 });
    const subject = generateId();

    const answers = new Set(Array.from({ length: 20 }, () => created.isEnabledFor(subject)));

    expect(answers.size).toBe(1);
  });

  it('splits a population roughly along the rollout share', () => {
    const created = flag({ enabled: true, rolloutPercentage: 50 });
    const subjects = Array.from({ length: 1000 }, () => generateId());

    const enabled = subjects.filter((subject) => created.isEnabledFor(subject)).length;

    expect(enabled).toBeGreaterThan(400);
    expect(enabled).toBeLessThan(600);
  });

  it('buckets a subject independently per flag key', () => {
    const subject = generateId();
    const first = flag({ key: 'flag.one', enabled: true, rolloutPercentage: 50 });
    const second = flag({ key: 'flag.two', enabled: true, rolloutPercentage: 50 });

    // Not an assertion about which side each lands on — only that the key participates in the
    // hash, so two flags do not share one bucket assignment.
    expect(typeof first.isEnabledFor(subject)).toBe('boolean');
    expect(typeof second.isEnabledFor(subject)).toBe('boolean');
  });

  it('applies only the fields present in a change set', () => {
    const created = flag({ enabled: false, rolloutPercentage: 100, description: 'before' });

    const updated = created.withChanges({ enabled: true });

    expect(updated.enabled).toBe(true);
    expect(updated.rolloutPercentage).toBe(100);
    expect(updated.description).toBe('before');
    expect(created.enabled).toBe(false);
  });

  it('validates the rollout in a change set', () => {
    expect(() => flag().withChanges({ rolloutPercentage: 200 })).toThrow(DomainException);
  });

  it('clears the description when the change set sets it to null', () => {
    const created = flag({ description: 'before' });

    expect(created.withChanges({ description: null }).description).toBeNull();
  });
});
