import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { writeFileSync } from 'fs';

const PROBE_FILE = '/tmp/worker-alive';
const INTERVAL_MS = 30_000; // every 30 seconds

@Injectable()
export class WorkerHealthService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;

  onApplicationBootstrap(): void {
    this.writeProbe();
    this.timer = setInterval(() => this.writeProbe(), INTERVAL_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private writeProbe(): void {
    writeFileSync(PROBE_FILE, new Date().toISOString(), 'utf8');
  }
}
