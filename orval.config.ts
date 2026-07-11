import { defineConfig } from 'orval';

export default defineConfig({
  api: {
    input: {
      target: './dist/swagger/openapi.json',
    },
    output: {
      // One file per OpenAPI tag (admin/users/auth/upload/…, mirroring the DDD
      // modules) plus a single `api.schemas.ts` — the generated client is
      // committed, so `tags` keeps the diff readable instead of `tags-split`'s
      // one-file-per-model explosion (~250 files). `clean: true` wipes stale
      // files (orval #1875 duplicate-export accretion + stale tag files on rename).
      workspace: 'libs/api-client/src/generated/',
      target: './api.ts',
      client: 'axios',
      mode: 'tags',
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
