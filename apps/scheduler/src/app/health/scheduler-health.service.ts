import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { writeFileSync } from 'fs';

const PROBE_FILE = '/tmp/scheduler-alive';
const INTERVAL_MS = 30_000; // every 30 seconds

@Injectable()
export class SchedulerHealthService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SchedulerHealthService.name);
  private timer: NodeJS.Timeout | undefined;

  onApplicationBootstrap(): void {
    this.writeProbe();
    this.timer = setInterval(() => this.writeProbe(), INTERVAL_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private writeProbe(): void {
    try {
      writeFileSync(PROBE_FILE, new Date().toISOString(), 'utf8');
    } catch (err) {
      // The stale file makes the container unhealthy; avoid an uncaught timer exception so the
      // orchestrator gets a stable failure signal and can restart according to its policy.
      this.logger.warn(`failed to refresh ${PROBE_FILE}: ${String(err)}`);
    }
  }
}
