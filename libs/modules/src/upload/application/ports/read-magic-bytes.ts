import type { StoragePort } from '@nestjs-fastify-nx/infra-storage';
import { assertMagicBytesMatch } from '../../domain/entities/stored-file.entity';
import type { UploadLimits } from '../upload-limits';

export interface MagicByteHeadDeps {
  readonly storage: StoragePort;
  readonly limits: UploadLimits;
}

export async function readHeadAndAssertMagicBytes(
  deps: MagicByteHeadDeps,
  key: string,
  contentType: string,
  bucket: string,
): Promise<void> {
  const head = await deps.storage.readRange(key, deps.limits.magicByteCount, bucket);
  assertMagicBytesMatch(Buffer.from(head), contentType, key);
}
