import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

// One-shot CLI: runs `prisma migrate deploy` then optionally seeds, then exits.
// Designed for orchestrator-gated workflows (Docker Compose service_completed_successfully,
// K8s Job / Init Container). Plain console logging keeps the bundle minimal — full
// app loggers (pino/Nest) are unnecessary for a batch job that runs once and dies.
//
// The injectDatabasePassword helper is intentionally inlined here (a small copy
// of libs/shared/src/lib/db-password-file.ts) because `scope:migration` has an
// empty boundary allow-list — schema rollouts must stay decoupled from runtime
// business code. The duplication is ~15 lines and the alternative (relaxing
// the boundary just for this util) would re-open the channel that lint guards.

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

function injectDatabasePassword(
  url: string | undefined,
  passwordFile: string | undefined,
): string | undefined {
  if (!url || !passwordFile || !existsSync(passwordFile)) return url;
  const match = url.match(/^(postgres(?:ql)?:\/\/)([^@:/]+)@(.+)$/);
  if (!match) return url;
  const password = readFileSync(passwordFile, 'utf8').trim();
  if (!password) return url;
  return `${match[1]}${match[2]}:${encodeURIComponent(password)}@${match[3]}`;
}

function bootstrap(): void {
  const start = Date.now();
  log('starting');

  // Docker-secrets / k8s overlays publish DATABASE_URL without the password
  // and mount the secret at DB_PASSWORD_FILE. Inject the password into the
  // env vars BEFORE spawning prisma — execSync inherits process.env, so the
  // CLI sees the fully-formed URL without needing a shell wrapper.
  // injectDatabasePassword is a no-op when DB_PASSWORD_FILE is unset.
  const passwordFile = process.env['DB_PASSWORD_FILE'];
  if (passwordFile) {
    const directUrl = injectDatabasePassword(process.env['DATABASE_DIRECT_URL'], passwordFile);
    const writeUrl = injectDatabasePassword(process.env['DATABASE_URL'], passwordFile);
    if (directUrl) process.env['DATABASE_DIRECT_URL'] = directUrl;
    if (writeUrl) process.env['DATABASE_URL'] = writeUrl;
  }

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
