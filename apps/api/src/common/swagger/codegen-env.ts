// Placeholder env for spec export ONLY. Must be a side-effect import placed
// BEFORE `./codegen-app.module` in export-spec.ts: ES module imports execute in
// order, and `@Module({ imports: [ConfigModule.forRoot({ validate })] })` runs
// `validateConfig(process.env)` the moment CodegenAppModule is loaded — so these
// values must already be set. Inlining the assignments in export-spec.ts is NOT
// enough: every `import` there hoists above inline statements, so the module
// (and its validation) would evaluate first. The exporter never opens a real
// DB/Redis/SMTP connection — these only satisfy env validation.
function setIfMissing(key: string, value: string): void {
  if (!process.env[key]) process.env[key] = value;
}

setIfMissing('NODE_ENV', 'development');
setIfMissing('DATABASE_URL', 'postgresql://codegen:codegen@localhost:5432/codegen');
setIfMissing('BETTER_AUTH_SECRET', 'codegen-placeholder-secret-min-32-characters-ok');
// Better Auth logs a warning at module init if BETTER_AUTH_URL is unset, even
// though the spec exporter never serves a real request. Sentinel keeps it quiet.
setIfMissing('BETTER_AUTH_URL', 'http://codegen.invalid');
setIfMissing('CORS_ORIGINS', 'http://localhost:3000');
setIfMissing('STORAGE_ACCESS_KEY', 'codegen');
setIfMissing('STORAGE_SECRET_KEY', 'codegen');
setIfMissing('BULL_BOARD_PASSWORD', 'codegen');
setIfMissing('MAIL_HOST', 'codegen.mail.invalid');
setIfMissing('MAIL_DEFAULT_EMAIL', 'codegen@codegen.invalid');
setIfMissing('ENABLE_METRICS', 'false');
