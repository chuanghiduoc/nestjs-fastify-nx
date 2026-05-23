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
function runWithRetry(command: string, label: string, attempts = 10, delayMs = 1500): void {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      run(command, attempt === 1 ? label : `${label} (attempt ${attempt})`);
      return;
    } catch (err) {
      if (attempt === attempts) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      log(`${label} attempt ${attempt} failed — retrying in ${delayMs}ms: ${msg}`);
      // Synchronous sleep so we keep execSync's straightforward error model.
      const wait = Date.now() + delayMs;
      while (Date.now() < wait) {
        // busy-wait — acceptable in a one-shot CLI that only blocks here.
      }
    }
  }
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

  // Inject DB password into env BEFORE spawning prisma — execSync inherits process.env.
  const passwordFile = process.env['DB_PASSWORD_FILE'];
  if (passwordFile) {
    const directUrl = injectDatabasePassword(process.env['DATABASE_DIRECT_URL'], passwordFile);
    const writeUrl = injectDatabasePassword(process.env['DATABASE_URL'], passwordFile);
    if (directUrl) process.env['DATABASE_DIRECT_URL'] = directUrl;
    if (writeUrl) process.env['DATABASE_URL'] = writeUrl;
  }

  try {
    runWithRetry('node_modules/.bin/prisma migrate deploy', 'prisma migrate deploy');
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

bootstrap();
