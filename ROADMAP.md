# Roadmap

Status is updated as each scoped phase is completed. The repository is public at v0.1.0.

| Phase | Scope                                              | Dependencies | Acceptance criteria                                                         | Status   |
| ----- | -------------------------------------------------- | ------------ | --------------------------------------------------------------------------- | -------- |
| 0     | Foundation: workspace, gates, governance, branding | None         | Strict TypeScript, deterministic lockfile, CI, tests, Changesets, templates | Complete |
| 1     | Inspection and capabilities                        | 0            | Normalized metadata, typed errors, real ffprobe integration tests           | Complete |
| 2     | Versioned Media IR and semantic planner            | 1            | Serializable schema, validation, reasons, conflict tests                    | Complete |
| 3     | FFmpeg execution                                   | 2            | Focused operations compile and execute with integration tests               | Complete |
| 4     | Verification                                       | 3            | Structured checks inspect outputs, including failed constraints             | Complete |
| 5     | Agent interfaces                                   | 4            | CLI and MCP reuse core; examples, JSON output and schemas                   | Complete |
| 6     | Hardening                                          | 5            | Timeouts, cleanup, collision and path safety; security review               | Complete |
| 7     | Pre-public review                                  | 6            | API, docs, release, licensing and readiness audit                           | Complete |
| 8     | Evidence-driven release hardening                  | 7            | Public-boundary dogfood and verified plan integrity                         | Complete |
| 9     | Standout release evidence                          | 8            | Recovery demo, corpus parity, vertical workflow, progress, docs, artifacts  | Complete |
| 10    | Standout polish                                    | 9            | All 5 workflows, 13-scenario corpus, visual demo GIF, expanded docs         | Complete |

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

### Phase 4

- [x] Verify output metadata against plan expectations.
- [x] Report dimensions, aspect ratio, duration, size, container and audio checks structurally.
- [x] Document and apply a 2% maximum-size verification tolerance.
- [x] Cover passing and failing verification, including real transformed output.

### Phase 5

- [x] Add JSON-first inspect, plan, execute, verify and capabilities CLI commands.
- [x] Add MCP stdio adapter with the same five semantic operations.
- [x] Add a versioned Media Plan JSON Schema and executable examples.
- [x] Expand llms.txt and README usage guidance.

### Phase 6

- [x] Support cancellation and classify timeout failures.
- [x] Reject source overwrite, output collisions and configurable output-directory escape.
- [x] Avoid temporary concat list files; document process and dependency security boundaries.
- [x] Add Linux, macOS and Windows CI coverage with FFmpeg installation.

### Phase 7

- [x] Complete the pre-public readiness review without changing visibility or publishing packages.

### Phase 8

- [x] Validate Media IR at serialization, parsing, planning, and execution boundaries.
- [x] Reject unsupported operation combinations and mismatched source metadata.
- [x] Dogfood real FFmpeg through the SDK, serialized IR, CLI, and MCP protocol.
- [x] Verify H.264/pixel-format compatibility and maximum-size output constraints.
- [x] Return structured MCP failures and accept plan objects without manual stringification.
- [x] Classify still images correctly and clean up partial failed outputs.

### Phase 9

- [x] Add an inspectable `makeVertical` workflow across SDK, CLI, and MCP.
- [x] Report monotonic progress through SDK callbacks, CLI NDJSON, and MCP notifications.
- [x] Run a representative reliability corpus and compare semantic fingerprints across CI platforms.
- [x] Demonstrate failed verification followed by plan serialization, replay, and structured recovery.
- [x] Replace placeholder documentation with task-focused guides and an original pixel-art identity.
- [x] Produce installable, validated GitHub release artifacts through an automated release workflow.

### Phase 10

- [x] Add `optimizeForWeb`, `normalize`, `extractAudio`, and `extractFrame` verified workflows.
- [x] Expand reliability corpus to 13 scenarios covering all workflows and safety guards.
- [x] Create a visual terminal demo GIF of the structured recovery flow.
- [x] Update README, docs, CLI, and MCP with all five high-level workflows.

Detailed private evidence and competitor tracking remain outside version control.

| 11 | Public release | 10 | npm publish, public repo, v0.1.0 | Complete |

## Future phases

The product thesis stays narrow: a deterministic media runtime where `inspect → validate → plan → execute → verify → receipt` is the full contract. The following phases sharpen that thesis — they do not expand into editor-product breadth (timeline editing, color grading, beat-sync, transcription, compositing, or 150+ tools).

### Phase 12 — Plan validation and repair helpers

Mechanical plan issues should be detected and repaired before execution, not discovered as FFmpeg
failures. Inspiration: videopython's `check` / `repair` / dimension normalization pattern.

- [x] Clamp impossible trims (start beyond duration, end before start).
- [x] Normalize concatenation constraints (detect stream mismatches, suggest normalization steps).
- [x] Detect dimension and aspect-ratio conflicts before compilation.
- [x] Report exactly what was repaired and why — structured, not silent.
- [x] CLI and MCP surface for `validate-plan` and `repair-plan`.

### Phase 13 — Execution and verification receipts

Every execution should produce a versioned, durable JSON artifact that can power resume, replay,
and reproducibility.

- [x] Define a receipt schema: plan ID/version, source fingerprints and metadata, backend and
      capabilities used, executed steps, output paths, verification checks, warnings, and
      failure/recovery state.
- [x] Emit receipts from `executePlan` and all workflows, including a failure receipt when a run
      does not complete.
- [x] CLI `receipt` command to inspect a saved receipt, and `resume` to replay from one.
- [x] MCP `inspect_receipt` and `resume_execution` tools. (Named for the existing `inspect_*`
      convention rather than the `get_execution_receipt` sketched here.)
- [x] Receipt-based replay: skip execution when the recorded output still satisfies the same plan
      against an unchanged source.

### Phase 14 — Strict LLM-facing JSON Schema

Generate machine-consumable schemas directly from the canonical plan and operation models so agent
tooling cannot drift from the runtime.

- [x] Export Media IR v1 JSON Schema from the Zod models, not a hand-maintained file.
- [x] Publish the schema as a package artifact (`@hadialmarzooq/agent-media-core/schema.json`) and
      a GitHub-hosted URL (`mediaPlanSchemaId`).
- [x] MCP tool descriptions reference the canonical schema URL.
- [x] Version the schema alongside Media IR and reject mismatched versions at boundaries.

### Phase 15 — Workflow state and resumability

Support persisted plan state and idempotent execution checkpoints, especially for multi-step
transforms and long-running operations.

- [n/a] Checkpoint after each step (trim, reframe, resize, encode). A plan compiles to a single
  FFmpeg invocation with one filter chain, so there is no intermediate state between steps to
  checkpoint. Splitting it would mean writing and re-encoding intermediate files on every run —
  slower, and a generation loss the single-pass design exists to avoid. Checkpointing is at
  plan granularity instead, which is what the receipt records.
- [x] Idempotent re-execution: if a receipt exists and the source hasn't changed, skip.
- [x] Resume after failure or cancellation: failed runs write a receipt carrying the error code, so
      a resume can tell "never executed" from "executed and did not satisfy the plan".
- [x] CLI and MCP `resume` commands that accept a receipt.

### Phase 16 — Extensible verification

The verification model should be extensible enough to support content-quality checks beyond
metadata — not immediately, but the architecture should not block it.

- [x] Plugin or hook system for custom verification checks (`verifyMedia` `customChecks`).
- [x] Black-frame detection.
- [x] Silence detection.
- [x] Freeze detection.
- [x] Output package completeness (all expected streams present and playable).
- [x] Warnings vs. failures: a check can warn without failing the whole report, and a custom check
      that throws is isolated as a warning rather than a silent pass.

### Not on the roadmap

The following move toward editor-product breadth and away from the clean runtime thesis:

- Beat-sync editing
- LUT / color grading presets
- 150+ MCP tools
- AI-driven editing inside the library
- Full timeline editing
- Whisper / transcription
- Heavy compositing
