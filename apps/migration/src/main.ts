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
    run('node_modules/.bin/prisma migrate deploy', 'prisma migrate deploy');
  } catch (err) {
    fail('prisma migrate deploy failed', err);
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
