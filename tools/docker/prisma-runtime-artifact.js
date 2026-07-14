const { copyFileSync, cpSync, mkdirSync } = require('node:fs');
const { createRequire } = require('node:module');
const { dirname, resolve } = require('node:path');

const [mode, artifactDir] = process.argv.slice(2);
if (!['export', 'install'].includes(mode) || !artifactDir) {
  throw new Error('usage: prisma-runtime-artifact.js <export|install> <artifact-dir>');
}

const projectRequire = createRequire(resolve(process.cwd(), 'package.json'));
const clientDir = dirname(projectRequire.resolve('@prisma/client/package.json'));
const generatedDir = resolve(clientDir, '../../.prisma');

if (mode === 'export') {
  mkdirSync(artifactDir, { recursive: true });
  cpSync(clientDir, resolve(artifactDir, 'client'), { recursive: true, dereference: true });
  cpSync(generatedDir, resolve(artifactDir, '.prisma'), { recursive: true, dereference: true });
  copyFileSync(__filename, resolve(artifactDir, 'install.js'));
} else {
  mkdirSync(generatedDir, { recursive: true });
  cpSync(resolve(artifactDir, 'client'), clientDir, { recursive: true });
  cpSync(resolve(artifactDir, '.prisma'), generatedDir, { recursive: true });
}
