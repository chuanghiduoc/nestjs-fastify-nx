import { defineConfig } from 'vitest/config';

export interface CoverageThresholds {
  lines?: number;
  functions?: number;
  branches?: number;
  statements?: number;
}

export interface VitestProjectOptions {
  name: string;
  rootDir: string;
  integrationTests?: boolean;
  testTimeout?: number;
  hookTimeout?: number;
  coverageExclude?: string[];
  coverageThresholds?: CoverageThresholds;
}

function computeRelativePath(rootDir: string): string {
  const depth = rootDir.split(/[/\\]/).filter(Boolean).length;
  return '../'.repeat(depth);
}

export function createVitestConfig(options: VitestProjectOptions) {
  const {
    name,
    rootDir,
    integrationTests = false,
    testTimeout,
    hookTimeout,
    coverageExclude = [],
    coverageThresholds,
  } = options;

  const defaultThresholds: CoverageThresholds = {
    lines: 60,
    functions: 60,
    branches: 60,
    statements: 60,
  };

  const thresholds = coverageThresholds
    ? { ...defaultThresholds, ...coverageThresholds }
    : defaultThresholds;

  const relativePath = computeRelativePath(rootDir);
  const isIntegrationRun = process.argv.includes('integration');

  const includePattern = integrationTests
    ? ['{src,tests}/**/*.{test,spec,integration}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}']
    : ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'];

  return {
    test: {
      name,
      watch: false,
      globals: true,
      environment: 'node',
      include: includePattern,
      // The include glob admits both `*.integration.ts` and `*.integration.spec.ts`; excluding
      // only the latter would run Testcontainers suites in the plain `test` target.
      exclude: isIntegrationRun ? [] : ['**/*.integration.*'],
      reporters: ['default'],
      setupFiles: [`${relativePath}vitest.setup.ts`],
      passWithNoTests: true,
      ...(testTimeout && { testTimeout }),
      ...(hookTimeout && { hookTimeout }),
      coverage: {
        reportsDirectory: `${relativePath}coverage/${rootDir}`,
        provider: 'v8' as const,
        include: ['src/**/*.ts'],
        exclude: [
          'src/**/*.spec.ts',
          'src/**/*.test.ts',
          'src/**/*.integration.ts',
          'src/**/index.ts',
          'src/**/*.module.ts',
          'src/**/*.dto.ts',
          'src/**/*.decorator.ts',
          'src/**/types/**',
          ...coverageExclude,
        ],
        thresholds,
      },
    },
  };
}

export function defineVitestConfig(options: VitestProjectOptions) {
  return defineConfig(() => createVitestConfig(options));
}
