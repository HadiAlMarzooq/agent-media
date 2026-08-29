# Roadmap

Status is updated as each scoped phase is completed. This repository remains private until the
owner explicitly approves publication.

| Phase | Scope                                              | Dependencies | Acceptance criteria                                                         | Status   |
| ----- | -------------------------------------------------- | ------------ | --------------------------------------------------------------------------- | -------- |
| 0     | Foundation: workspace, gates, governance, branding | None         | Strict TypeScript, deterministic lockfile, CI, tests, Changesets, templates | Complete |
| 1     | Inspection and capabilities                        | 0            | Normalized metadata, typed errors, real ffprobe integration tests           | Pending  |
| 2     | Versioned Media IR and semantic planner            | 1            | Serializable schema, validation, reasons, conflict tests                    | Pending  |
| 3     | FFmpeg execution                                   | 2            | Focused operations compile and execute with integration tests               | Pending  |
| 4     | Verification                                       | 3            | Structured checks inspect outputs, including failed constraints             | Pending  |
| 5     | Agent interfaces                                   | 4            | CLI and MCP reuse core; examples, JSON output and schemas                   | Pending  |
| 6     | Hardening                                          | 5            | Timeouts, cleanup, collision and path safety; security review               | Pending  |
| 7     | Pre-public review                                  | 6            | API, docs, release, licensing and readiness audit                           | Pending  |

## Phase tasks

### Phase 0

- [x] Create pnpm TypeScript workspace and package boundaries.
- [x] Add lint, formatting, build, typecheck and test commands.
- [x] Add governance, contribution and automation files.
- [x] Add release/versioning plumbing and original branding.

### Phase 1–7

Detailed checklists are kept adjacent to each implementation and completed with their phase.
