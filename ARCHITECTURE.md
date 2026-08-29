# Architecture

Agent Media follows one directional pipeline:

```text
inspect → plan → versioned Media IR → compile/execute → verify
```

`@agent-media/core` owns protocol-independent types, validation, planning and verification.
`@agent-media/ffmpeg` owns process execution, probing and compilation. `@agent-media/cli` and
`@agent-media/mcp` are thin adapters over those packages. Core must never depend on MCP or raw
FFmpeg argument strings.

Media plans express semantic intent such as aspect ratio, quality and compatibility. Backend
choices belong to the compiler and are recorded as explainable decisions.

## Media IR v1

`MediaPlan` has `irVersion: "1"`, a source path, semantic constraints, ordered operations with
reasons, and verification expectations. It deliberately contains no FFmpeg flags or filter graphs.
Use `serializePlan` and `parsePlan` to move plans safely across interfaces.
