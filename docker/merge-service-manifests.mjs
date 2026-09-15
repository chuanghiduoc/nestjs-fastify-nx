import { readFileSync, writeFileSync } from 'node:fs';

const inputs = process.argv.slice(2);
if (inputs.length === 0) {
  throw new Error('merge-service-manifests: expected at least one manifest path');
}

const dependencies = {};
const origin = {};

for (const path of inputs) {
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
    const seen = dependencies[name];
    if (seen !== undefined && seen !== version) {
      throw new Error(
        `merge-service-manifests: version conflict for ${name} — ${origin[name]} pins ${seen}, ${path} pins ${version}`,
      );
    }
    dependencies[name] = version;
    origin[name] = path;
  }
}

const merged = {
  name: 'runtime-deps',
  version: '0.0.0',
  private: true,
  packageManager: JSON.parse(readFileSync(inputs[0], 'utf8')).packageManager,
  dependencies: Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b))),
};

writeFileSync('package.json', `${JSON.stringify(merged, null, 2)}\n`);
process.stdout.write(`merged ${inputs.length} manifests into ${Object.keys(dependencies).length} dependencies\n`);
