const { createLockFile } = require('@nx/js');

class DeploymentArtifactsPlugin {
  constructor(
    nxAppPlugin,
    { additionalRuntimeDependencies = [], excludedRuntimeDependencies = [] } = {},
  ) {
    this.nxAppPlugin = nxAppPlugin;
    this.additionalRuntimeDependencies = additionalRuntimeDependencies;
    this.excludedRuntimeDependencies = excludedRuntimeDependencies;
  }

  apply(compiler) {
    compiler.hooks.thisCompilation.tap('DeploymentArtifactsPlugin', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'DeploymentArtifactsPlugin',
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE,
        },
        () => {
          const packageAsset = compilation.getAsset('package.json');
          if (!packageAsset) return;

          const generated = JSON.parse(packageAsset.source.source().toString());
          const projectGraph = this.nxAppPlugin.options?.projectGraph;
          if (!projectGraph) {
            throw new Error(
              'Nx project graph is unavailable while generating deployment artifacts',
            );
          }

          generated.dependencies ??= {};
          for (const name of this.additionalRuntimeDependencies) {
            const node = projectGraph.externalNodes?.[`npm:${name}`];
            const version = node?.data?.version;
            if (!version) {
              throw new Error(
                `Cannot resolve runtime dependency ${name} from the Nx project graph`,
              );
            }
            generated.dependencies[name] = version;
          }
          for (const name of this.excludedRuntimeDependencies) {
            delete generated.dependencies[name];
          }

          // Nx pins direct dependencies but also copies workspace overrides. pnpm
          // rejects that combination when installing the generated frozen lockfile.
          if (generated.pnpm?.overrides) delete generated.pnpm.overrides;
          if (generated.pnpm && Object.keys(generated.pnpm).length === 0) delete generated.pnpm;

          const packageJson = `${JSON.stringify(generated, null, 2)}\n`;
          const lockfile = createLockFile(generated, projectGraph, 'pnpm').replace(
            /^overrides:\n(?:[ ].*\n)+/m,
            '',
          );
          compilation.updateAsset(
            'package.json',
            new compiler.webpack.sources.RawSource(packageJson),
          );
          compilation.updateAsset(
            'pnpm-lock.yaml',
            new compiler.webpack.sources.RawSource(lockfile),
          );
        },
      );
    });
  }
}

class ProductionSourceMapPlugin {
  apply(compiler) {
    if (process.env.NODE_ENV === 'production') {
      compiler.options.devtool = 'nosources-source-map';
    }
  }
}

module.exports = { DeploymentArtifactsPlugin, ProductionSourceMapPlugin };
