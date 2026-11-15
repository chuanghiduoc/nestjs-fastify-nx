import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { WorkerEnvConfig } from '../../config/env.validation';
import { MailAdapter } from './mail.adapter';

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  sendMail: vi.fn(),
}));

vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({ verify: mocks.verify, sendMail: mocks.sendMail })),
}));

function config(overrides: Record<string, unknown> = {}): ConfigService<WorkerEnvConfig, true> {
  const values: Record<string, unknown> = {
    MAIL_HOST: 'smtp.example.test',
    MAIL_PORT: 1025,
    MAIL_DEFAULT_NAME: 'App',
    MAIL_DEFAULT_EMAIL: 'no-reply@example.test',
    MAIL_IGNORE_TLS: false,
    MAIL_SECURE: false,
    MAIL_REQUIRE_TLS: false,
    NODE_ENV: 'production',
    ...overrides,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService<WorkerEnvConfig, true>;
}

describe('MailAdapter', () => {
  beforeEach(() => {
    mocks.verify.mockReset();
    mocks.sendMail.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('verifies the transport at boot when SMTP is reachable', async () => {
    mocks.verify.mockResolvedValue(true);
    const adapter = new MailAdapter(config());

    await adapter.onModuleInit();

    expect(mocks.verify).toHaveBeenCalledTimes(1);
  });

  it('does not crash the worker when SMTP is briefly unreachable', async () => {
    vi.useFakeTimers();
    mocks.verify.mockRejectedValue(new Error('connection refused'));
    const adapter = new MailAdapter(config());

    const booting = adapter.onModuleInit();
    await vi.advanceTimersByTimeAsync(2_500);

    await expect(booting).resolves.toBeUndefined();
    expect(mocks.verify).toHaveBeenCalledTimes(3);
  });

  it('sends through the verified transport', async () => {
    mocks.verify.mockResolvedValue(true);
    mocks.sendMail.mockResolvedValue({});
    const adapter = new MailAdapter(config());
    await adapter.onModuleInit();

    await adapter.send({ to: 'user@example.test', subject: 'Hi', html: '<p>Hi</p>' });

    expect(mocks.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'user@example.test', subject: 'Hi', html: '<p>Hi</p>' }),
    );
  });
});
