# Pre-public readiness review

Reviewed: 2026-08-30. Updated for public release v0.1.0. The repository is now public and packages
are published to npm under `@hadialmarzooq`.

## Product and API audit

- The end-to-end path works: inspect → plan → Media IR v1 → execute → verify.
- Public intent remains semantic. FFmpeg arguments only exist in the backend compiler.
- `MediaPlan` is explicitly versioned as `"1"`, validated with Zod, serializable, and documented
  with a JSON Schema.
- The first pre-public API deliberately remains `0.0.x`; no compatibility guarantee is made.
- CLI and MCP expose the same compact five-operation surface and return JSON.
- SDK, persisted JSON, CLI, and MCP now run the same real-FFmpeg dogfood path in tests.
- Every plan boundary returns stable `INVALID_PLAN` errors, and unsupported Media IR v1 operation
  combinations are rejected rather than partially executed.

## Competitive and naming audit

Existing projects commonly expose a direct FFmpeg MCP interface or a large tool catalogue. Agent
Media's retained differentiation is the portable semantic plan, explicit reasons, backend
independence, and verification. The generic `agent-media` npm name is already occupied, so this
repository uses the unclaimed pre-public package names under `@hadialmarzooq` instead. A registry
lookup is not a reservation: confirm scope ownership before any publication.

## Release, quality, and licensing audit

- `pnpm --filter './packages/*' pack` produced only each package's `dist` files and `package.json`.
- Format, lint, strict typecheck, build, real-FFmpeg integration tests, and production dependency
  audit pass locally.
- CI validates Linux, macOS, and Windows and installs FFmpeg where needed.
- Compatibility verification checks the actual H.264 codec and `yuv420p` pixel format, not only
  process success.
- MIT licensing, third-party dependency review, security reporting policy, contribution guidance,
  Code of Conduct, Changesets, and release tags are present.

## Release status

The repository is public at v0.1.0. All four packages are published to npm with `access: public`.
The release workflow packs, validates, and attaches artifacts to GitHub releases on every tag.
