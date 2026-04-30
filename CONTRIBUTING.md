# Contributing

## Setup

```bash
pnpm install
cp .env.example .env
docker compose -f docker/compose.yml up -d
pnpm prisma migrate dev
```

## Commit Convention

Uses [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new feature
- `fix:` — bug fix
- `chore:` — maintenance, no runtime impact
- `test:` — add/update tests
- `docs:` — documentation only
- `refactor:` — refactor without feature/fix
- `ci:` — CI/CD changes
- `perf:` — performance improvement
- `build:` — build system changes

Git hooks (lefthook) enforce commitlint and lint-staged automatically on commit.

## Creating a New Module

```bash
pnpm nx g @nestjs-fastify-nx/tools-generators:module --name=your-module
```

See [Creating a Module](docs/creating-a-module.md) for details.

## Pull Request Process

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Write tests first (TDD)
4. Commit with conventional commits
5. Push and open a PR
6. CI must pass before merge

## Running Tests

```bash
# Unit tests
pnpm nx run-many --target=test --all

# Integration tests (requires Docker)
pnpm nx run modules-users:test --testPathPattern=integration

# E2E tests (requires Docker)
pnpm nx run api:e2e
```
