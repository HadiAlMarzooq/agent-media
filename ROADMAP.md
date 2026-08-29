# Roadmap

Status is updated as each scoped phase is completed. This repository remains private until the
owner explicitly approves publication.

| Phase | Scope                                              | Dependencies | Acceptance criteria                                                         | Status   |
| ----- | -------------------------------------------------- | ------------ | --------------------------------------------------------------------------- | -------- |
| 0     | Foundation: workspace, gates, governance, branding | None         | Strict TypeScript, deterministic lockfile, CI, tests, Changesets, templates | Complete |
| 1     | Inspection and capabilities                        | 0            | Normalized metadata, typed errors, real ffprobe integration tests           | Complete |
| 2     | Versioned Media IR and semantic planner            | 1            | Serializable schema, validation, reasons, conflict tests                    | Complete |
| 3     | FFmpeg execution                                   | 2            | Focused operations compile and execute with integration tests               | Complete |
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

### Phase 1

- [x] Normalize ffprobe stream, format and file-size metadata.
- [x] Detect FFmpeg encoders, filters and hardware acceleration.
- [x] Return stable structured errors with recovery suggestions.
- [x] Cover inspection and capabilities with generated real-FFmpeg fixtures.

### Phase 2

- [x] Define a serializable, validated Media IR version 1.
- [x] Plan semantic trim, framing, resize, encoding and extraction intent.
- [x] Record explicit reasons and expected output constraints.
- [x] Reject conflicting or unavailable requests with stable errors.

### Phase 3

- [x] Compile semantic plans into deterministic FFmpeg operations.
- [x] Execute trim, reframe, resize, transcode/compress, audio/frame extraction and concatenation.
- [x] Return structured execution failures instead of backend-only output.
- [x] Test representative operations against generated media with real FFmpeg.

### Phase 4–7

Detailed checklists are kept adjacent to each implementation and completed with their phase.
