const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');
const { SwcEs2022TargetPlugin } = require('../../tools/webpack/swc-es2022-target-plugin');
const {
  DeploymentArtifactsPlugin,
  ProductionSourceMapPlugin,
} = require('../../tools/webpack/deployment-artifacts-plugin');

const nxAppPlugin = new NxAppWebpackPlugin({
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
});

module.exports = {
  output: {
    path: join(__dirname, '../../dist/apps/worker'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  plugins: [
    nxAppPlugin,
    new SwcEs2022TargetPlugin(),
    new ProductionSourceMapPlugin(),
    new DeploymentArtifactsPlugin(nxAppPlugin, { excludedRuntimeDependencies: ['prisma'] }),
  ],
};
