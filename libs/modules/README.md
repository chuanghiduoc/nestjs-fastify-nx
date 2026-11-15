# modules

Every bounded context is a folder under `src/` — one Nx project, one workspace package. A context is created by dropping a folder (leaf or engine tier per `docs/domain-module-anatomy.md`) and adding an entry to this package's `exports` map; no project config, no install. Context-to-context imports are forbidden and enforced by the `modules-scale/no-cross-context-imports` ESLint rule. Design: `docs/superpowers/specs/2026-11-15-modules-scale-design.md`.
