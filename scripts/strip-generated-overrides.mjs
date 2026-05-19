#!/usr/bin/env node
// Strip `pnpm.overrides` from a webpack-generated dist/apps/<svc>/package.json
// and the matching top-level `overrides:` from its pnpm-lock.yaml.
//
// NxAppWebpackPlugin keeps source overrides while pinning direct deps to
// exact versions, so `pnpm install --frozen-lockfile` rejects the mismatch
// (e.g. override `uuid: ^14.0.0` vs direct `uuid: 14.0.0`). Transitives are
// already resolved in the generated lockfile — overrides add nothing here.
//
// Usage:  node scripts/strip-generated-overrides.mjs dist/apps/api
import { readFileSync, writeFileSync } from 'node:fs';
import { argv, exit } from 'node:process';

const dir = argv[2];
if (!dir) {
  console.error('usage: strip-generated-overrides.mjs <dist/apps/X>');
  exit(1);
}

const pkgPath = `${dir}/package.json`;
const lockPath = `${dir}/pnpm-lock.yaml`;

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
if (pkg.pnpm?.overrides) {
  delete pkg.pnpm.overrides;
  if (Object.keys(pkg.pnpm).length === 0) delete pkg.pnpm;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`stripped pnpm.overrides from ${pkgPath}`);
}

let lock;
try {
  lock = readFileSync(lockPath, 'utf8');
} catch {
  exit(0);
}
const cleaned = lock.replace(/^overrides:\n(?:[ ].*\n)+/m, '');
if (cleaned !== lock) {
  writeFileSync(lockPath, cleaned);
  console.log(`stripped overrides: block from ${lockPath}`);
}
