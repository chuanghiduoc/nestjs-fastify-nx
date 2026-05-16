import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyRequest } from 'fastify';
import type { EnvConfig } from '../../config/env.validation';

/**
 * Guards the /metrics endpoint so only requests from allowed CIDRs (or exact IPs)
 * pass through. Fails closed: if METRICS_ALLOW_CIDRS is not configured, all
 * non-loopback requests are rejected. Loopback (127.0.0.1, ::1) is always allowed
 * to support local healthcheck scrapers.
 *
 * METRICS_ALLOW_CIDRS: comma-separated list of CIDR prefixes or exact IPs.
 * Example: "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
 * For Kubernetes: set to the pod CIDR so only in-cluster Prometheus scrapes pass.
 */
@Injectable()
export class MetricsIpAllowGuard implements CanActivate {
  private readonly allowedCidrs: string[];

  constructor(private readonly config: ConfigService<EnvConfig, true>) {
    const raw = process.env['METRICS_ALLOW_CIDRS'] ?? '';
    this.allowedCidrs = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const ip = this.extractIp(request);

    // Always allow loopback — sidecar scrapers on localhost must not be blocked.
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') {
      return true;
    }

    // Fail closed: no allowlist configured → block all non-loopback requests.
    if (this.allowedCidrs.length === 0) {
      return false;
    }

    return this.allowedCidrs.some((cidr) => this.ipMatchesCidr(ip, cidr));
  }

  private extractIp(request: FastifyRequest): string {
    // Fastify populates req.ip respecting the trustProxy setting from main.ts.
    return request.ip ?? '';
  }

  private ipMatchesCidr(ip: string, cidr: string): boolean {
    // Exact IP match (no slash).
    if (!cidr.includes('/')) {
      return ip === cidr;
    }

    const [network, prefixStr] = cidr.split('/');
    const prefix = parseInt(prefixStr, 10);

    if (isNaN(prefix) || !network) return false;

    // IPv4 only — IPv6 CIDR matching is out of scope; use exact IP for IPv6 peers.
    const ipNum = this.ipv4ToNumber(ip.replace('::ffff:', ''));
    const netNum = this.ipv4ToNumber(network);

    if (ipNum === null || netNum === null) {
      // Fall back to exact string comparison for non-IPv4 entries.
      return ip === network;
    }

    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    return (ipNum & mask) === (netNum & mask);
  }

  private ipv4ToNumber(ip: string): number | null {
    const parts = ip.split('.');
    if (parts.length !== 4) return null;
    const nums = parts.map(Number);
    if (nums.some((n) => isNaN(n) || n < 0 || n > 255)) return null;
    return ((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0;
  }
}
