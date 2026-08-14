## Summary

<!-- Describe the user-visible or maintenance change. Link the issue when applicable. -->

## Checklist

- [ ] The change remains within the same-process DSH runtime scope.
- [ ] No sibling harness repository or checkout was changed.
- [ ] `pnpm install --frozen-lockfile` passes.
- [ ] `pnpm run typecheck` passes.
- [ ] `pnpm test` passes.
- [ ] `pnpm run build` passes.
- [ ] `pnpm pack` passes.
- [ ] The packed-content check passes with `pnpm run check:packed -- <pack-directory>`.
- [ ] `README.md` and `README.zh.md` were reviewed for aligned status, installation, scope, and roadmap text.
- [ ] No credentials, local DSH homes, tarballs, or generated build artifacts are included.
- [ ] Compatibility with DSH `0.1.0-rc.6` was considered.

## Verification

<!-- List focused checks and any isolated DSH_HOME smoke test performed. -->
