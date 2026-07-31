import { describe, expect, it, vi } from 'vitest';
import type { CommandBus } from '@nestjs/cqrs';
import type { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import { VerifyUploadCommand } from '@nestjs-fastify-nx/modules-upload';
import {
  UploadVerificationProcessor,
  type UploadVerificationPayload,
} from './upload-verification.processor';

function build() {
  const commandBus = { execute: vi.fn().mockResolvedValue('verified') };
  const config = { get: vi.fn().mockReturnValue(5) };
  const processor = new UploadVerificationProcessor(
    commandBus as unknown as CommandBus,
    config as unknown as ConfigService<never, true>,
  );
  return { processor, commandBus };
}

const job = (data: Partial<UploadVerificationPayload> = {}) =>
  ({
    data: {
      key: 'files/u/f.png',
      declaredContentType: 'image/png',
      bucket: 'uploads',
      correlationId: 'corr-1',
      ...data,
    },
  }) as Job<UploadVerificationPayload>;

// The lifecycle itself is covered by VerifyUploadHandler's spec; this only pins the transport
// contract, so the api and the worker cannot drift apart on the payload shape.
describe('UploadVerificationProcessor', () => {
  it('dispatches the shared verification command with the job payload', async () => {
    const { processor, commandBus } = build();

    await processor.process(job());

    expect(commandBus.execute).toHaveBeenCalledWith(
      new VerifyUploadCommand('files/u/f.png', 'image/png', 'uploads', 'corr-1'),
    );
  });

  it('propagates a command failure so BullMQ retries and can dead-letter the job', async () => {
    const { processor, commandBus } = build();
    commandBus.execute.mockRejectedValue(new Error('verification failed'));

    await expect(processor.process(job())).rejects.toThrow('verification failed');
  });
});
