import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

// One-shot CLI: `prisma migrate deploy` → optional seed → exit. injectDatabasePassword
// is inlined (not imported from libs/shared) because scope:migration has an empty
// boundary allow-list — schema rollouts must stay decoupled from runtime business code.

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

// Postgres healthcheck can flip from `healthy` to "actually accepting queries"
// with a 1–3s gap on cold boot. Compose / Swarm restart the container on
// failure, but the scary P1001 in the log noise alarms operators — retry
// in-process instead.
function boundedIntEnv(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

async function runWithRetry(
  command: string,
  label: string,
  attempts: number,
  delayMs: number,
): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      run(command, attempt === 1 ? label : `${label} (attempt ${attempt})`);
      return;
    } catch (err) {
      if (attempt === attempts) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      log(`${label} attempt ${attempt} failed — retrying in ${delayMs}ms: ${msg}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

// Deliberate copy of libs/shared/src/lib/db-password-file.ts — scope:migration has an empty module
// boundary allow-list on purpose, so it can't import shared. Keep this in sync with that file: WHATWG
// URL parsing (not regex — the old regex missed `user:@host` empty-password DSNs) + encodeURIComponent
// (the URL setter leaves a literal `%` un-encoded, which pg would mis-decode).
function injectDatabasePassword(
  url: string | undefined,
  passwordFile: string | undefined,
): string | undefined {
  if (!url || !passwordFile || !existsSync(passwordFile)) return url;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') return url;
  if (parsed.password !== '' || parsed.username === '') return url;

  const password = readFileSync(passwordFile, 'utf8').trim();
  if (!password) return url;

  parsed.password = encodeURIComponent(password);
  return parsed.toString();
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

  try {
    await runWithRetry(
      'node_modules/.bin/prisma migrate deploy',
      'prisma migrate deploy',
      boundedIntEnv('MIGRATION_MAX_ATTEMPTS', 10, 1, 100),
      boundedIntEnv('MIGRATION_RETRY_DELAY_MS', 1_500, 100, 60_000),
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
