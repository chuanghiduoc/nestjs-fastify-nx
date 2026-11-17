import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineVitestConfig } from '../../vitest.shared';

const contextFolders = readdirSync(fileURLToPath(new URL('./src', import.meta.url)), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => `src/${entry.name}/**`);

export default defineVitestConfig({
  name: 'modules',
  rootDir: 'libs/modules',
  integrationTests: true,
  testTimeout: 60_000,
  hookTimeout: 60_000,
  coverageExclude: ['src/**/prisma-*.repository.ts'],
  coverageThresholdGlobs: contextFolders,
});
