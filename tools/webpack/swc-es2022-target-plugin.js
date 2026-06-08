// @nx/webpack injects swc-loader without a `jsc.target`, so swc falls back to its
// es3/es5 default and downlevels every `class` into an ES5 `_super.call(this)` shim.
// That breaks any class extending a NATIVE es-class from node_modules (which webpack
// never transpiles) — e.g. `WorkerHost`/`QueueEventsHost` from @nestjs/bullmq throw
// "Class constructor X cannot be invoked without 'new'" at DI instantiation.
// Pin the target to es2022 (matching tsconfig.base) so classes stay native and `super()`
// stays a real `super` call. Runs AFTER NxAppWebpackPlugin, which has already pushed the
// swc-loader rule onto compiler.options.module.rules synchronously inside its apply().
class SwcEs2022TargetPlugin {
  apply(compiler) {
    const rules = compiler.options.module?.rules ?? [];
    for (const rule of rules) {
      if (!rule || typeof rule !== 'object') continue;
      const loader = rule.loader;
      if (typeof loader === 'string' && loader.includes('swc-loader')) {
        rule.options ??= {};
        rule.options.jsc ??= {};
        rule.options.jsc.target = 'es2022';
      }
    }
  }
}

module.exports = { SwcEs2022TargetPlugin };
