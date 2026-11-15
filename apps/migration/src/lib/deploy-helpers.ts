import { existsSync, readFileSync } from 'node:fs';

export function boundedIntEnv(
  name: string,
  fallback: number,
  min: number,
  max: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const value = Number(env[name]);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

export function injectDatabasePassword(
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

export function isRetryableDeployError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /P1001|P1017|ECONNREFUSED|connection refused|timed out|server closed the connection/i.test(
    message,
  );
}

export async function runWithRetry(
  command: string,
  label: string,
  attempts: number,
  delayMs: number,
  run: (command: string, label: string) => void,
  log: (message: string) => void = () => undefined,
  isRetryable: (error: unknown) => boolean = () => true,
): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      run(command, attempt === 1 ? label : `${label} (attempt ${attempt})`);
      return;
    } catch (err) {
      if (attempt === attempts || !isRetryable(err)) throw err;
      log(`${label} attempt ${attempt} failed — retrying in ${delayMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
