# Architecture

Agent Media follows one directional pipeline:

```text
inspect → plan → versioned Media IR → compile/execute → verify
```

`@hadialmarzooq/agent-media-core` owns protocol-independent types, validation, planning and verification.
`@hadialmarzooq/agent-media-ffmpeg` owns process execution, probing and compilation. The CLI and
MCP packages are thin adapters over those packages. Core must never depend on MCP or raw
FFmpeg argument strings.

Media plans express semantic intent such as aspect ratio, quality and compatibility. Backend
choices belong to the compiler and are recorded as explainable decisions.

## Media IR v1

`MediaPlan` has `irVersion: "1"`, a source path, semantic constraints, ordered operations with
reasons, and verification expectations. It deliberately contains no FFmpeg flags or filter graphs.
Use `serializePlan` and `parsePlan` to move plans safely across interfaces.

Every public runtime boundary validates Media IR again. Plans require unique step IDs, and Media IR
v1 treats extraction and concatenation as terminal operations that cannot be mixed with transforms.
Rejecting an unsupported composition is preferable to silently dropping a step. Execution also
inspects the declared plan source itself unless a matching normalized metadata value is supplied.

The FFmpeg compiler translates that stable IR to arguments only at execution time. It does not
expose those arguments through the public planning API, CLI, or MCP adapter. The backend package
retains its compiled operation in execution results for local diagnostics.

Verification consumes a fresh normalized inspection of the output and returns checks plus
actionable failures. A process exit code alone never determines success.

## High-level workflows

High-level workflows live in the backend package when they require inspection and execution.
`makeVertical` composes the same public inspect, plan, serialize, execute, inspect, and verify
boundaries; it does not introduce another plan format or compiler. Its result exposes every semantic
artifact so agents can audit or replay the work.

This boundary keeps `core` independent from FFmpeg while allowing an opinionated workflow to provide
a one-call product experience. Future workflows must compile through Media IR rather than constructing
backend arguments directly.

## Progress

Execution adds FFmpeg's machine-readable `-progress` channel only at spawn time, leaving the compiled
operation deterministic and free of caller-specific observation settings. Chunk-safe parsing produces
monotonic `MediaProgress` events. Workflow phases wrap those execution events, the CLI sends them to
stderr as NDJSON, and MCP maps them to protocol progress notifications.

Progress callbacks are observational: callback exceptions are isolated and cannot alter the media
operation. Cancellation remains an explicit `AbortSignal` control.

## Reliability evidence

Tests prove API behavior; the reliability corpus proves representative end-to-end outcomes. CI
generates fixtures and runs the corpus separately on Ubuntu, macOS, and Windows. Because encoder bytes
are not reproducible across FFmpeg builds, the release gate compares a hash of normalized semantic
evidence instead of output file hashes.
