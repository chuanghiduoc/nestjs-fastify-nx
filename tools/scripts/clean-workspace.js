const { spawnSync } = require('node:child_process');
const { existsSync, globSync, rmSync } = require('node:fs');
const { dirname, isAbsolute, relative, resolve } = require('node:path');

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
  ['apps/*/out-tsc', 'libs/*/out-tsc', 'libs/*/*/out-tsc', 'tools/*/out-tsc'],
  { cwd: workspaceRoot },
);

const disposablePaths = [
  'dist',
  'tmp',
  '.nx/cache',
  '.nx/workspace-data',
  '.cache/webpack',
  'node_modules/.vite',
  ...generatedOutputs,
];

for (const entry of disposablePaths) {
  const target = resolve(workspaceRoot, entry);
  const fromRoot = relative(workspaceRoot, target);

  if (
    fromRoot === '' ||
    fromRoot === '..' ||
    fromRoot.startsWith(`..${require('node:path').sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new Error(`Refusing to remove path outside the workspace: ${target}`);
  }

  rmSync(target, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
