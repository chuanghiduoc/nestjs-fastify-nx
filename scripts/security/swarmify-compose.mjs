#!/usr/bin/env node
// Reads a `docker compose config` YAML on stdin, normalizes the output so
// `docker stack deploy` accepts it on modern Docker (29.x+):
//   - depends_on map → list (Swarm only takes short-form)
//   - cpus / mem values stay as strings
//   - published ports stay as integers
//
// Why this exists: compose.swarm.yml uses `!override` to convert depends_on
// to list form for Swarm, but `docker compose config` (and Docker 29.x's
// stack parser) drop the tag and re-merge as the original map. Re-canonicalise
// in JS so the script remains a single npm-free invocation.
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
// `yaml` is a transitive of multiple deps — load from a known pnpm store path. Search the pnpm dir for the actual version directory so a `pnpm update` doesn't break this script.
const pnpmDir = path.join(repoRoot, 'node_modules', '.pnpm');
const yamlEntry = fs.readdirSync(pnpmDir).find((name) => name.startsWith('yaml@'));
if (!yamlEntry) {
  console.error(`No yaml@* found in ${pnpmDir}; run pnpm install first.`);
  process.exit(1);
}
const requireFromYaml = createRequire(
  path.join(pnpmDir, yamlEntry, 'node_modules', 'yaml', 'package.json'),
);
const YAML = requireFromYaml('./dist/index.js');

const input = fs.readFileSync(0, 'utf8');
const doc = YAML.parse(input);

// Top-level keys Swarm rejects (compose adds `name` from COMPOSE_PROJECT_NAME).
delete doc.name;
delete doc.version;

for (const svc of Object.values(doc.services ?? {})) {
  if (!svc || typeof svc !== 'object') continue;
  if (svc.depends_on && typeof svc.depends_on === 'object' && !Array.isArray(svc.depends_on)) {
    svc.depends_on = Object.keys(svc.depends_on);
  }
}

process.stdout.write(YAML.stringify(doc));
