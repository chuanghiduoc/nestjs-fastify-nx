import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyRequest } from 'fastify';
import { BlockList, isIP } from 'node:net';
import type { EnvConfig } from '../../config/env.validation';

// Fails closed on empty/invalid METRICS_ALLOW_CIDRS. Loopback is always allowed.
@Injectable()
export class MetricsIpAllowGuard implements CanActivate {
  private readonly allowlist = new BlockList();
  private readonly hasRules: boolean;

  constructor(private readonly config: ConfigService<EnvConfig, true>) {
    const raw = config.get('METRICS_ALLOW_CIDRS', { infer: true }) ?? '';
    const rules = raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    let validRules = 0;
    for (const rule of rules) {
      if (this.addRule(rule)) validRules++;
    }
    this.hasRules = validRules > 0;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const ip = request.socket?.remoteAddress ?? '';

    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') {
      return true;
    }
    if (!this.hasRules) return false;

    const family = isIP(ip);
    return family !== 0 && this.allowlist.check(ip, family === 6 ? 'ipv6' : 'ipv4');
  }

  private addRule(rule: string): boolean {
    const separator = rule.lastIndexOf('/');
    const address = separator === -1 ? rule : rule.slice(0, separator);
    const family = isIP(address);
    if (family === 0) return false;
    const type = family === 6 ? 'ipv6' : 'ipv4';

    try {
      if (separator === -1) {
        this.allowlist.addAddress(address, type);
      } else {
        const prefixText = rule.slice(separator + 1);
        if (!/^\d+$/.test(prefixText)) return false;
        const prefix = Number(prefixText);
        const maxPrefix = family === 6 ? 128 : 32;
        if (prefix > maxPrefix) return false;
        this.allowlist.addSubnet(address, prefix, type);
      }
      return true;
    } catch {
      return false;
    }
  }
}
