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
