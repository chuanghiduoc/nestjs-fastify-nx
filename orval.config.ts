import { defineConfig } from 'orval';

export default defineConfig({
  api: {
    input: {
      target: './dist/swagger/openapi.json',
    },
    output: {
      target: 'libs/api-client/src/generated/api.ts',
      schemas: 'libs/api-client/src/generated/schemas',
      client: 'axios',
      mode: 'tags-split',
      prettier: true,
      override: {
        mutator: {
          path: 'libs/api-client/src/lib/axios-instance.ts',
          name: 'customAxiosInstance',
        },
      },
    },
  },
});
