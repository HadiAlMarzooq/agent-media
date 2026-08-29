# Contributing

This project is private during pre-public development. Use Node.js 22+ and pnpm 10.

1. Create a focused branch; never commit feature work directly to `main`.
2. Use Conventional Commits (for example, `feat(core): add semantic planner`).
3. Run `pnpm format:check && pnpm lint && pnpm typecheck && pnpm build && pnpm test`.
4. Add tests and documentation for behavior changes.
5. Add a Changeset for any package-facing change.

Changes that affect execution, inspection, planning constraints, or verification should also run
`pnpm benchmark:reliability`. Keep benchmark fingerprints semantic; do not assert encoded byte hashes
or timing thresholds across platforms.

Do not publish packages, change repository visibility, or add telemetry without owner approval.
