/// <reference types="vitest/globals" />
import { describe, it, expect } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { MetricsIpAllowGuard } from './metrics-ip-allow.guard';
import type { EnvConfig } from '../../config/env.validation';

function makeGuard(cidrs: string): MetricsIpAllowGuard {
  const config = {
    get: () => cidrs,
  } as unknown as ConfigService<EnvConfig, true>;
  return new MetricsIpAllowGuard(config);
}

function makeContext(remoteAddress: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ socket: { remoteAddress } }),
    }),
  } as unknown as ExecutionContext;
}

describe('MetricsIpAllowGuard', () => {
  describe('loopback — always allowed', () => {
    it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])(
      'allows %s regardless of allowlist',
      (addr) => {
        const guard = makeGuard('');
        expect(guard.canActivate(makeContext(addr))).toBe(true);
      },
    );
  });

  describe('fail-closed — no allowlist configured', () => {
    it('blocks non-loopback when METRICS_ALLOW_CIDRS is empty', () => {
      const guard = makeGuard('');
      expect(guard.canActivate(makeContext('10.0.0.1'))).toBe(false);
    });
  });

  describe('exact IP match', () => {
    it('allows configured exact IP', () => {
      const guard = makeGuard('10.0.0.5');
      expect(guard.canActivate(makeContext('10.0.0.5'))).toBe(true);
    });

    it('blocks different exact IP', () => {
      const guard = makeGuard('10.0.0.5');
      expect(guard.canActivate(makeContext('10.0.0.6'))).toBe(false);
    });
  });

  describe('CIDR range match', () => {
    it('allows IP within /24 range', () => {
      const guard = makeGuard('192.168.1.0/24');
      expect(guard.canActivate(makeContext('192.168.1.100'))).toBe(true);
    });

    it('blocks IP outside /24 range', () => {
      const guard = makeGuard('192.168.1.0/24');
      expect(guard.canActivate(makeContext('192.168.2.1'))).toBe(false);
    });

    it('allows /0 (matches all IPv4)', () => {
      const guard = makeGuard('0.0.0.0/0');
      expect(guard.canActivate(makeContext('8.8.8.8'))).toBe(true);
    });

    it('allows /32 exact host match', () => {
      const guard = makeGuard('10.0.0.1/32');
      expect(guard.canActivate(makeContext('10.0.0.1'))).toBe(true);
    });

    it('blocks different host with /32', () => {
      const guard = makeGuard('10.0.0.1/32');
      expect(guard.canActivate(makeContext('10.0.0.2'))).toBe(false);
    });
  });

  describe('CIDR prefix edge cases — invalid prefixes must not match', () => {
    it('rejects prefix /33', () => {
      const guard = makeGuard('10.0.0.0/33');
      expect(guard.canActivate(makeContext('10.0.0.1'))).toBe(false);
    });

    it('rejects negative prefix /-1', () => {
      const guard = makeGuard('10.0.0.0/-1');
      expect(guard.canActivate(makeContext('10.0.0.1'))).toBe(false);
    });

    it('rejects non-numeric prefix /abc', () => {
      const guard = makeGuard('10.0.0.0/abc');
      expect(guard.canActivate(makeContext('10.0.0.1'))).toBe(false);
    });
  });

  describe('multiple CIDR entries (comma-separated)', () => {
    it('allows IP matching the second entry', () => {
      const guard = makeGuard('10.0.0.0/8,172.16.0.0/12');
      expect(guard.canActivate(makeContext('172.16.5.1'))).toBe(true);
    });

    it('blocks IP not matching any entry', () => {
      const guard = makeGuard('10.0.0.0/8,172.16.0.0/12');
      expect(guard.canActivate(makeContext('1.2.3.4'))).toBe(false);
    });
  });

  describe('IPv4-mapped IPv6 addresses', () => {
    it('allows ::ffff: prefixed address when underlying IPv4 matches CIDR', () => {
      const guard = makeGuard('192.168.0.0/16');
      expect(guard.canActivate(makeContext('::ffff:192.168.1.50'))).toBe(true);
    });
  });

  describe('IPv6 CIDR ranges', () => {
    it('allows an address inside the configured IPv6 subnet', () => {
      const guard = makeGuard('2001:db8::/32');
      expect(guard.canActivate(makeContext('2001:db8:1::5'))).toBe(true);
    });

    it('blocks an address outside the configured IPv6 subnet', () => {
      const guard = makeGuard('2001:db8::/32');
      expect(guard.canActivate(makeContext('2001:db9::1'))).toBe(false);
    });
  });
});
