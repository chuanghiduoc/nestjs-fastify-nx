import { defineConfig } from 'orval';

export default defineConfig({
  api: {
    input: {
      target: './dist/swagger/openapi.json',
    },
    output: {
      // `workspace` is the base for `target` + `schemas` + auto-barrel.
      // `clean: true` wipes stale files (prevents the duplicate-export
      // accretion bug in orval #1875 and stale tag files after rename).
      workspace: 'libs/api-client/src/generated/',
      target: './api.ts',
      schemas: './schemas',
      client: 'axios',
      mode: 'tags-split',
      indexFiles: true,
      clean: true,
      formatter: 'prettier',
      override: {
        mutator: {
          path: '../lib/axios-instance.ts',
          name: 'customAxiosInstance',
        },
      },
    },
  },
});
