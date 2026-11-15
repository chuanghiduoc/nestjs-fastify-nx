import { execSync } from 'node:child_process';
import {
  boundedIntEnv,
  injectDatabasePassword,
  isRetryableDeployError,
  runWithRetry,
} from './lib/deploy-helpers';

// One-shot CLI: `prisma migrate deploy` → optional seed → exit. injectDatabasePassword
// is inlined (not imported from libs/shared) because scope:migration has an empty
// boundary allow-list — schema rollouts must stay decoupled from runtime business code.

const log = (msg: string): void => {
  console.log(`[migration] ${new Date().toISOString()} ${msg}`);
};

const isScalar = (value: unknown): value is string | number =>
  typeof value === 'string' || typeof value === 'number';

const describeError = (err: unknown): string => {
  if (!(err instanceof Error)) return String(err);
  const { code, status } = err as Error & { code?: unknown; status?: unknown };
  const parts = [err.message];
  if (isScalar(code)) parts.push(`code=${code}`);
  if (isScalar(status)) parts.push(`exitStatus=${status}`);
  return parts.join(' ');
};

const fail = (msg: string, err: unknown): never => {
  console.error(`[migration] ${new Date().toISOString()} ${msg}\n${describeError(err)}`);
  process.exit(1);
};

function run(command: string, label: string): void {
  log(`▶ ${label}`);
  try {
    const stdout = execSync(command, { stdio: ['inherit', 'pipe', 'pipe'] });
    if (stdout.length > 0) process.stdout.write(stdout);
  } catch (err) {
    const stderr = (err as { stderr?: unknown }).stderr;
    const text =
      stderr instanceof Buffer && stderr.length > 0
        ? stderr.toString('utf8')
        : typeof stderr === 'string'
          ? stderr
          : undefined;
    if (text) {
      process.stderr.write(text);
      throw new Error(`${(err as Error).message}\n${text}`, { cause: err });
    }
    throw err;
  }
}

async function bootstrap(): Promise<void> {
  const start = Date.now();
  log('starting');

  // Inject DB password into env BEFORE spawning prisma — execSync inherits process.env.
  const passwordFile = process.env['DB_PASSWORD_FILE'];
  if (passwordFile) {
    const directUrl = injectDatabasePassword(process.env['DATABASE_DIRECT_URL'], passwordFile);
    const writeUrl = injectDatabasePassword(process.env['DATABASE_URL'], passwordFile);
    if (directUrl) process.env['DATABASE_DIRECT_URL'] = directUrl;
    if (writeUrl) process.env['DATABASE_URL'] = writeUrl;
  }

  if (!process.env['DATABASE_URL'] && !process.env['DATABASE_DIRECT_URL']) {
    fail(
      'DATABASE_URL or DATABASE_DIRECT_URL is required',
      new Error('no database DSN configured'),
    );
  }

  try {
    await runWithRetry(
      'node_modules/.bin/prisma migrate deploy',
      'prisma migrate deploy',
      boundedIntEnv('MIGRATION_MAX_ATTEMPTS', 10, 1, 100),
      boundedIntEnv('MIGRATION_RETRY_DELAY_MS', 1_500, 100, 60_000),
      run,
      log,
      isRetryableDeployError,
    );
  } catch (err) {
    fail('prisma migrate deploy failed after retries', err);
  }

  // RUN_SEED gate keeps routine deploys from touching user data.
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

void bootstrap();
