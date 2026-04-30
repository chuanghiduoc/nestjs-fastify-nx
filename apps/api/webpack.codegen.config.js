// tsc compiler — only path that emits full design:paramtypes for Nest DI.
const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  output: {
    path: join(__dirname, '../../dist/apps/api-codegen'),
    clean: true,
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/common/swagger/export-spec.ts',
      tsConfig: './tsconfig.app.json',
      outputHashing: 'none',
      optimization: false,
      generatePackageJson: false,
      runtimeDependencies: ['tslib'],
      sourceMap: true,
    }),
  ],
};
