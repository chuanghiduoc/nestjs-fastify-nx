import { execSync } from 'node:child_process';

// One-shot CLI: runs `prisma migrate deploy` then optionally seeds, then exits.
// Designed for orchestrator-gated workflows (Docker Compose service_completed_successfully,
// K8s Job / Init Container). Plain console logging keeps the bundle minimal — full
// app loggers (pino/Nest) are unnecessary for a batch job that runs once and dies.

const log = (msg: string): void => {
  console.log(`[migration] ${new Date().toISOString()} ${msg}`);
};

const fail = (msg: string, err: unknown): never => {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error(`[migration] ${new Date().toISOString()} ${msg}\n${detail}`);
  process.exit(1);
};

function run(command: string, label: string): void {
  log(`▶ ${label}`);
  execSync(command, { stdio: 'inherit' });
}

function bootstrap(): void {
  const start = Date.now();
  log('starting');

  try {
    run('node_modules/.bin/prisma migrate deploy', 'prisma migrate deploy');
  } catch (err) {
    fail('prisma migrate deploy failed', err);
  }

  // Seed is gated behind RUN_SEED so routine deploys never touch user data.
  if (process.env['RUN_SEED'] === 'true') {
    try {
      run('node prisma/seed.mjs', 'seed');
    } catch (err) {
      fail('seed failed', err);
    }
  } else {
    log('RUN_SEED!=true — skipping seed');
  }

  log(`completed in ${Date.now() - start}ms`);
}

bootstrap();
