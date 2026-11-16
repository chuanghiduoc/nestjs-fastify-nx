import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { writeFileSync } from 'fs';

const DEFAULT_INTERVAL_MS = 30_000;

export interface LivenessProbeOptions {
  readonly probeFile: string;
  readonly name: string;
  readonly intervalMs?: number;
}

@Injectable()
export class LivenessProbeService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger: Logger;
  private readonly probeFile: string;
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | undefined;

  constructor(options: LivenessProbeOptions) {
    this.probeFile = options.probeFile;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.logger = new Logger(`${options.name}LivenessProbe`);
  }

  onApplicationBootstrap(): void {
    this.writeProbe();
    this.timer = setInterval(() => this.writeProbe(), this.intervalMs);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private writeProbe(): void {
    try {
      writeFileSync(this.probeFile, new Date().toISOString(), 'utf8');
    } catch (err) {
      this.logger.warn({ err, probeFile: this.probeFile }, 'failed to refresh health probe');
    }
  }
}
