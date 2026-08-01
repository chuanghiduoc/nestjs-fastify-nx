const { spawnSync } = require('node:child_process');
const { existsSync, globSync, rmSync } = require('node:fs');
const { isAbsolute, relative, resolve, sep } = require('node:path');

const workspaceRoot = resolve(__dirname, '../..');
const nxCli = resolve(workspaceRoot, 'node_modules/nx/bin/nx.js');

// A running daemon can hold the workspace database open on Windows. Cleaning
// must still work when node_modules itself is incomplete, so stopping Nx is
// best-effort and does not gate removal of disposable files.
if (existsSync(nxCli)) {
  spawnSync(process.execPath, [nxCli, 'daemon', '--stop'], {
    cwd: workspaceRoot,
    stdio: 'inherit',
  });
}

const generatedOutputs = globSync(
  [
    'apps/*/out-tsc',
    'libs/*/out-tsc',
    'libs/*/*/out-tsc',
    'tools/*/out-tsc',
    // tsc --build keeps its incremental state next to the config, and a stale one makes a
    // "clean" build silently skip work that the deleted outputs no longer back.
    '**/*.tsbuildinfo',
  ],
  { cwd: workspaceRoot, exclude: (name) => name === 'node_modules' },
);

const disposablePaths = [
  'dist',
  'tmp',
  '.nx/cache',
  '.nx/workspace-data',
  '.cache/webpack',
  'node_modules/.vite',
  'node_modules/.cache',
  ...generatedOutputs,
];

const failures = [];

for (const entry of disposablePaths) {
  const target = resolve(workspaceRoot, entry);
  const fromRoot = relative(workspaceRoot, target);

  if (
    fromRoot === '' ||
    fromRoot === '..' ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new Error(`Refusing to remove path outside the workspace: ${target}`);
  }

  try {
    rmSync(target, {
      recursive: true,
      force: true,
      // Windows holds a handle briefly after the daemon exits; one second of retries was not
      // enough and the resulting EPERM aborted the whole loop, leaving later paths untouched.
      maxRetries: 20,
      retryDelay: 250,
    });
  } catch (error) {
    // Collect and continue: one locked path must not stop the rest of the clean.
    failures.push({ path: fromRoot, message: error.message });
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`clean: could not remove ${failure.path} — ${failure.message}`);
  }
  console.error(
    'clean: something still holds these paths open. Close editors/terminals using the workspace ' +
      '(and any running `nx serve`), then re-run `pnpm clean`.',
  );
  process.exit(1);
}
