import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { writeFileSync } from 'fs';

const PROBE_FILE = '/tmp/worker-alive';
const INTERVAL_MS = 30_000; // every 30 seconds

@Injectable()
export class WorkerHealthService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerHealthService.name);
  private timer: NodeJS.Timeout | undefined;

  onApplicationBootstrap(): void {
    this.writeProbe();
    this.timer = setInterval(() => this.writeProbe(), INTERVAL_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // tmpfs writes effectively never fail, but fd exhaustion or a misconfigured
  // mount would otherwise throw out of a setInterval callback → unhandledException
  // → worker crash. Logging keeps the failure visible without taking the process down.
  private writeProbe(): void {
    try {
      writeFileSync(PROBE_FILE, new Date().toISOString(), 'utf8');
    } catch (err) {
      this.logger.warn(`failed to refresh ${PROBE_FILE}: ${String(err)}`);
    }
  }
}
