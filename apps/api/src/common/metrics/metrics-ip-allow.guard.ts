import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyRequest } from 'fastify';
import type { EnvConfig } from '../../config/env.validation';

// Fails closed on empty METRICS_ALLOW_CIDRS — loopback always allowed; Kubernetes: set pod CIDR.
@Injectable()
export class MetricsIpAllowGuard implements CanActivate {
  private readonly allowedCidrs: string[];

  constructor(private readonly config: ConfigService<EnvConfig, true>) {
    const raw = config.get('METRICS_ALLOW_CIDRS', { infer: true }) ?? '';
    this.allowedCidrs = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const ip = this.extractIp(request);

    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') {
      return true;
    }

    if (this.allowedCidrs.length === 0) {
      return false;
    }

    return this.allowedCidrs.some((cidr) => this.ipMatchesCidr(ip, cidr));
  }

  private extractIp(request: FastifyRequest): string {
    // socket.remoteAddress is direct TCP peer; req.ip is XFF-spoofable when trustProxy is set.
    return request.socket?.remoteAddress ?? '';
  }

  private ipMatchesCidr(ip: string, cidr: string): boolean {
    if (!cidr.includes('/')) {
      return ip === cidr;
    }

    const [network, prefixStr] = cidr.split('/');
    const prefix = parseInt(prefixStr, 10);

    // JS bitwise shift is undefined for prefix > 32 — validate before shifting.
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32 || !network) return false;

    const ipNum = this.ipv4ToNumber(ip.replace('::ffff:', ''));
    const netNum = this.ipv4ToNumber(network);

    if (ipNum === null || netNum === null) {
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
