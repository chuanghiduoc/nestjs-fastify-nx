import { describe, it, expect } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { MetricsIpAllowGuard } from '../metrics/metrics-ip-allow.guard';
import { HealthController } from './health.controller';

function guardsFor(methodName: keyof HealthController): unknown[] {
  return (
    (Reflect.getMetadata(GUARDS_METADATA, HealthController.prototype[methodName]) as
      unknown[] | undefined) ?? []
  );
}

describe('HealthController route guards', () => {
  it('restricts /health/dependencies to the metrics IP allowlist', () => {
    expect(guardsFor('dependencies')).toContain(MetricsIpAllowGuard);
  });

  it('leaves the LB/k8s probes unrestricted', () => {
    expect(guardsFor('check')).not.toContain(MetricsIpAllowGuard);
    expect(guardsFor('readiness')).not.toContain(MetricsIpAllowGuard);
    expect(guardsFor('liveness')).not.toContain(MetricsIpAllowGuard);
  });
});
