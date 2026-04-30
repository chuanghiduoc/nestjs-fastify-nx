<!--
Thanks for opening a pull request! Please fill in the sections below so
reviewers can land your change quickly.
-->

## Summary

<!-- What does this PR do? Why is it needed? -->

## Type of change

- [ ] feat — new feature
- [ ] fix — bug fix
- [ ] refactor — no behavior change
- [ ] perf — performance improvement
- [ ] docs — documentation only
- [ ] test — tests only
- [ ] chore / build / ci — tooling, infra, dependencies

## Affected scope

<!-- Which apps / libs / scopes are touched? e.g. apps/api, libs/modules/users -->

## Checklist

- [ ] Conventional Commits in branch history (`feat:`, `fix:`, `chore:`, …)
- [ ] `pnpm nx affected -t lint test build` passes locally
- [ ] Updated relevant `.md` files (README, docs/, CHANGELOG)
- [ ] No `TODO` / `FIXME` left in production code
- [ ] No JWT / refresh-token plumbing reintroduced (auth is Better Auth cookies)
- [ ] Module boundaries respected (`scope:modules` does not import another `scope:modules`)
- [ ] Added/updated tests where it makes sense

## Screenshots / logs (optional)

<!-- Drop screenshots, curl traces, or log excerpts that help review. -->

## Related issues

<!-- Closes #123, refs #456 -->
