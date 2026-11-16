import type Redis from 'ioredis';
import type { Queue } from 'bullmq';

export async function closeQuietly(client: Redis): Promise<void> {
  await client.quit().catch(() => client.disconnect());
}

export async function closeQueueQuietly(queue: Queue): Promise<void> {
  try {
    await queue.close();
  } catch {
    await queue.disconnect().catch(() => undefined);
  }
}
