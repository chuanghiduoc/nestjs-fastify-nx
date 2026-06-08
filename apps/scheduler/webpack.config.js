const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');
const { SwcEs2022TargetPlugin } = require('../../tools/webpack/swc-es2022-target-plugin');

module.exports = {
  output: {
    path: join(__dirname, '../../dist/apps/scheduler'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'swc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      assets: ['./src/assets'],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      runtimeDependencies: ['tslib'],
      sourceMap: true,
    }),
    new SwcEs2022TargetPlugin(),
  ],
};
