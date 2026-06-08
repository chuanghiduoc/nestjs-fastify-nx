const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');
const fs = require('fs');
const {
  SwcEs2022TargetPlugin,
} = require('../../tools/webpack/swc-es2022-target-plugin');

// seed.mjs runs via execSync — webpack misses its imports. Nx's `runtimeDependencies`
// resolves via `require.resolve('<pkg>/package.json')`, which @prisma/adapter-pg
// and better-auth don't export. Post-process the generated package.json instead.
const SEED_RUNTIME_DEPS = ['prisma', '@prisma/client', '@prisma/adapter-pg', 'better-auth', 'pg'];

class InjectSeedRuntimeDeps {
  apply(compiler) {
    compiler.hooks.afterEmit.tapAsync('InjectSeedRuntimeDeps', (compilation, cb) => {
      const generatedPkgPath = join(compilation.outputOptions.path, 'package.json');
      if (!fs.existsSync(generatedPkgPath)) return cb();

      const rootPkg = require('../../package.json');
      const generated = JSON.parse(fs.readFileSync(generatedPkgPath, 'utf8'));
      generated.dependencies = generated.dependencies ?? {};

      for (const name of SEED_RUNTIME_DEPS) {
        const range = rootPkg.dependencies?.[name] ?? rootPkg.devDependencies?.[name];
        if (range) generated.dependencies[name] = range;
      }

      fs.writeFileSync(generatedPkgPath, JSON.stringify(generated, null, 2) + '\n');
      cb();
    });
  }
}

module.exports = {
  output: {
    path: join(__dirname, '../../dist/apps/migration'),
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
      // prisma is invoked via execSync — webpack's static analysis can't see it.
      runtimeDependencies: ['prisma'],
      sourceMap: true,
    }),
    new SwcEs2022TargetPlugin(),
    new InjectSeedRuntimeDeps(),
  ],
};
