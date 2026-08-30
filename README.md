<p align="center">
  <img src="assets/logo-pixel.png" width="192" alt="Agent Media pixel-art logo" />
</p>

<h1 align="center">Agent Media</h1>

<p align="center">
  <strong>Deterministic media workflows for software agents.</strong><br />
  Inspect intent. Replay plans. Verify outcomes. Zero silent failures.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@hadialmarzooq/agent-media-core"><img src="https://img.shields.io/npm/v/@hadialmarzooq/agent-media-core?label=core" alt="core npm version" /></a>
  <a href="https://www.npmjs.com/package/@hadialmarzooq/agent-media-ffmpeg"><img src="https://img.shields.io/npm/v/@hadialmarzooq/agent-media-ffmpeg?label=ffmpeg" alt="ffmpeg npm version" /></a>
  <a href="https://www.npmjs.com/package/@hadialmarzooq/agent-media-cli"><img src="https://img.shields.io/npm/v/@hadialmarzooq/agent-media-cli?label=cli" alt="cli npm version" /></a>
  <a href="https://www.npmjs.com/package/@hadialmarzooq/agent-media-mcp"><img src="https://img.shields.io/npm/v/@hadialmarzooq/agent-media-mcp?label=mcp" alt="mcp npm version" /></a>
  <a href="https://github.com/HadiAlMarzooq/agent-media/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/HadiAlMarzooq/agent-media/ci.yml?label=CI" alt="CI status" /></a>
  <a href="https://github.com/HadiAlMarzooq/agent-media/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@hadialmarzooq/agent-media-core" alt="MIT license" /></a>
</p>

<p align="center">
  <img src="examples/demo.gif" alt="Agent Media recovery demo" />
</p>

Agent Media turns goals such as "make this vertical, broadly compatible, and under 25 MB" into a
versioned semantic plan. The plan can be inspected before execution, serialized across process
boundaries, replayed through FFmpeg, and verified against fresh output metadata afterward.

FFmpeg is the first backend. It is deliberately not the agent-facing abstraction.

## Install

```bash
npm install @hadialmarzooq/agent-media-core @hadialmarzooq/agent-media-ffmpeg
# CLI
npm install -g @hadialmarzooq/agent-media-cli
# MCP server
npm install @hadialmarzooq/agent-media-mcp
```

Prerequisites: Node.js 22+, `ffmpeg` and `ffprobe` on `PATH`.

Point an agent at it in one command:

```bash
claude mcp add agent-media -- agent-media-mcp
```

Or, in any MCP client's config:

```json
{
  "mcpServers": {
    "agent-media": { "command": "agent-media-mcp" }
  }
}
```

Then ask for the outcome, not the flags — _"make talk.mp4 vertical for shorts, under 25 MB"_ — and
the agent gets a plan it can show you, an execution, and a verification that either passed or names
what failed.

**New here? Read the [usage guide](docs/usage.md).** It covers all three surfaces task by task.

## Why Agent Media

Most media wrappers stop after a subprocess exits successfully. Agent Media treats that as only one
step in a safer contract:

```text
semantic goal → inspect → versioned Media IR → execute → inspect again → verify
```

| Property               | What the agent gets                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| Semantic planning      | Goals and reasons instead of raw FFmpeg flags                                                |
| Portable Media IR      | Validated JSON that can be reviewed, persisted, and replayed                                 |
| Outcome verification   | Structured checks for duration, geometry, size, audio, codec, and pixels                     |
| Structured recovery    | Stable error codes and every failed verification check in one report                         |
| Observable execution   | Monotonic progress through SDK callbacks, CLI NDJSON, and MCP notifications                  |
| One implementation     | The SDK, JSON CLI, MCP server, and high-level workflows share the same core                  |
| 6 high-level workflows | `makeVertical`, `optimizeForWeb`, `normalize`, `extractAudio`, `extractFrame`, `concatenate` |

## Quick start

```bash
npm install @hadialmarzooq/agent-media-core @hadialmarzooq/agent-media-ffmpeg
```

Create a verified vertical video with one SDK call:

```ts
import {
  makeVertical,
  optimizeForWeb,
  normalize,
  extractAudio,
  extractFrame,
  concatenate,
} from '@hadialmarzooq/agent-media-ffmpeg';

// 9:16 vertical, H.264/yuv420p, faststart, size-constrained
const vertical = await makeVertical({
  input: 'demo.mp4',
  output: 'vertical.mp4',
  maxSizeMB: 25,
  onProgress: ({ phase, percent }) => console.error(`${phase}: ${percent}%`),
});

// Web-optimized: balanced quality, H.264, faststart
const web = await optimizeForWeb({
  input: 'demo.mp4',
  output: 'web.mp4',
  maxSizeMB: 10,
  quality: 'balanced',
});

// Normalize to high-compat copy without changing dimensions
const norm = await normalize({ input: 'demo.mp4', output: 'normalized.mp4' });

// Extract audio
const audio = await extractAudio({ input: 'demo.mp4', output: 'audio.m4a' });

// Extract a still frame
const frame = await extractFrame({ input: 'demo.mp4', output: 'frame.jpg', atSeconds: 2 });

// Concatenate multiple sources — every clip, in playback order
const joined = await concatenate({
  inputs: ['demo.mp4', 'clip2.mp4'],
  output: 'joined.mp4',
});

console.log(vertical.verification.passed); // true, or throws VERIFICATION_FAILED
```

Every workflow returns the same `{ source, plan, serializedPlan, output, verification }` structure
(MCP omits `serializedPlan`, which is a verbatim copy of `plan`).
The plan is inspectable before execution, serializable to portable JSON, and the output is verified
against the plan's expectations. Convenience without hiding the contract.

## Usage at a glance

The [usage guide](docs/usage.md) is the full tour. Three things worth seeing up front:

**A plan is reviewable before anything is written.** Each step carries the reason it exists:

```jsonc
// agent-media plan talk.mp4 --aspect 9:16 --max-size 25
{
  "id": "reframe-1",
  "operation": "reframe",
  "aspectRatio": "9:16",
  "strategy": "center",
  "reason": "The requested output aspect ratio differs from the source.",
}
```

**A failure is evidence, not a stack trace.** Every error carries a stable code and what to do next:

```json
{
  "code": "VERIFICATION_FAILED",
  "message": "The workflow completed, but the output did not satisfy its plan.",
  "context": {
    "verification": { "failures": ["maxFileSize: Output exceeds the requested maximum file size."] }
  },
  "suggestedActions": ["Inspect the failed checks, adjust the semantic goals, and retry."]
}
```

That is enough for an agent to loosen the one constraint that failed and retry, which is exactly
what `pnpm demo` does.

**A retried step is idempotent.** Write a receipt once, and resuming from it re-encodes nothing when
the output still satisfies the plan:

```bash
agent-media execute plan.json --output out.mp4 --write-receipt
agent-media resume out.mp4.receipt.json   # → { "resumed": true }
```

## See the full agent loop

Run the self-contained demonstration; it generates its own media fixture:

```bash
pnpm demo
```

The demo deliberately requests an impossible 1 KB output, then shows an agent:

1. inspect the source;
2. create and serialize Media IR;
3. parse and replay it;
4. receive a failed `maxFileSize` verification check;
5. derive a new semantic constraint from the structured evidence; and
6. serialize, replay, and verify the recovered plan.

Plans, media, and the JSON transcript are written to `artifacts/demo/`. Read the
[demo walkthrough](docs/workflows.md#structured-recovery-demo) or inspect the executable
[agent-recovery example](examples/agent-recovery.mjs).

## CLI

Every successful command writes one JSON document to stdout. Optional progress is newline-delimited
JSON on stderr, so automation never receives mixed output.

```bash
agent-media inspect demo.mp4
agent-media vertical demo.mp4 --output vertical.mp4 --max-size 25 --progress
agent-media optimize demo.mp4 --output web.mp4 --max-size 10 --progress
agent-media normalize demo.mp4 --output normalized.mp4
agent-media extract-audio demo.mp4 --output audio.m4a
agent-media extract-frame demo.mp4 --output frame.jpg --at 2
agent-media concatenate demo.mp4 --inputs clip2.mp4 clip3.mp4 --output joined.mp4 --progress
agent-media plan demo.mp4 --aspect 9:16 --max-size 25 --out plan.json
agent-media validate-plan plan.json
agent-media repair-plan plan.json --out repaired.json
agent-media execute plan.json --output replay.mp4 --write-receipt --progress
agent-media resume replay.mp4.receipt.json
agent-media receipt replay.mp4.receipt.json
agent-media verify replay.mp4 --against plan.json
agent-media schema
agent-media capabilities
```

Failures are JSON on stderr with a stable `code`, a human message, relevant context, and suggested
recovery actions.

## MCP

Run `agent-media-mcp` over stdio. It exposes sixteen semantic tools:

- `inspect_media` (read-only)
- `get_media_capabilities` (read-only)
- `plan_media` (read-only)
- `validate_plan` (read-only) — detect mechanical plan issues against a real source
- `repair_plan` (read-only) — clamp and reconcile plans with a structured repair report
- `get_media_plan_schema` (read-only) — canonical JSON Schema generated from the runtime
- `make_vertical`
- `optimize_for_web`
- `normalize_media`
- `extract_audio`
- `extract_frame`
- `concatenate_media` — all clips in one ordered `inputs` list
- `execute_media_plan` — supports `writeReceipt` and idempotent `resume`
- `resume_execution` — continue from a saved receipt
- `inspect_receipt` (read-only) — validate and read a saved receipt
- `verify_media` (read-only)

Read-only tools are annotated with `readOnlyHint`; writer tools with `destructiveHint` so clients
like Claude Code can distinguish safe inspections from overwrite-capable calls. Every tool declares
an `outputSchema` and returns `structuredContent`, so results arrive typed rather than as text a
client has to parse.

`make_vertical`, `optimize_for_web`, `normalize_media`, `extract_audio`, `extract_frame`, and
`execute_media_plan` send standard MCP progress notifications when the client requests progress.
Plan execution and verification accept either the plan object returned by `plan_media` or serialized
plan JSON. Tool failures set `isError` and carry the same structured error body as the SDK and CLI.

## Plan repair

Plans arrive from outside the planner — hand-written by an agent, or replayed against a different
source — and mechanical problems in them should be caught before FFmpeg sees them. `validate_plan`
reports issues without executing; `repair_plan` fixes the repairable ones and says exactly what it
changed:

- Trims that start past the source, or end before they start.
- Frame timestamps beyond the end of the source.
- Resize dimensions that contradict the reframed aspect ratio.
- Concatenation inputs that disagree on stream layout. This one is reported, not repaired:
  reconciling it means re-encoding other files, so the issue carries a ready-to-run normalization
  plan per conflicting clip instead of a silent fix.

Repairs are never silent. Every change is reported as `{ field, action, from, to }`, and anything
that cannot be repaired mechanically fails with `INVALID_PLAN` rather than being guessed at.

## Receipts and resumability

Set `writeReceipt` (`--write-receipt`) and an execution leaves a durable, versioned JSON record
next to its output: the plan, its fingerprint, the source fingerprint, the backend, the executed
steps, the output, and the full verification report. Failed runs write one too, carrying the error
code — so a later run can tell "never executed" from "executed and did not satisfy the plan".

`resume_execution` (`agent-media resume`) takes a receipt and continues from it. When the recorded
output still exists and still satisfies the same plan against an unchanged source, the work is
skipped and nothing is re-encoded. When the source, the plan, or the output has changed, the plan
is executed again.

Checkpointing is at plan granularity because a plan compiles to a single FFmpeg invocation: there
is no intermediate state between steps to resume from, and introducing one would mean writing and
re-encoding intermediate files on every run.

## Content verification

Metadata verification proves an output is the right shape. It cannot prove there is a picture in
it. Opt into content checks — on any workflow, or on `executePlan` — and the output is decoded once
and inspected for what it actually contains:

- `blackFrames` — fully black stretches.
- `silence` — silent stretches, with a tunable threshold.
- `freeze` — frozen frames.
- `completeness` — every expected stream decodes end to end.

Custom checks plug in through `verifyMedia`'s `customChecks` hook, and any check can be listed in
`warnOnly` to warn without failing the report. A custom check that throws is isolated: it is
recorded as a warning and never as a silent pass.

## Reliability evidence

The reliability corpus covers 13 scenarios across all workflows and safety guards:

- Size-limited vertical conversion with verification
- Web optimization with H.264/yuv420p and size constraints
- Normalize to high-compatibility copy
- Audio extraction verification
- Frame extraction verification
- Trim duration verification
- Square reframe verification
- Malformed-file classification with structured recovery
- Audio-only vertical rejection with structured recovery
- Incompatible concatenation preflight with structured recovery
- Compatible concatenation (video-only and audio-only)
- Output collision rejection
- Source overwrite rejection

```bash
pnpm benchmark:reliability
```

CI executes the corpus on Ubuntu, macOS, and Windows, uploads every report, and compares a semantic
fingerprint across platforms. It intentionally compares observable behavior—not encoded-file hashes,
which vary by FFmpeg build. See [Reliability](docs/reliability.md) for the current baseline and
methodology.

## Packages

| Package                             | Responsibility                                              |
| ----------------------------------- | ----------------------------------------------------------- |
| `@hadialmarzooq/agent-media-core`   | Media types, IR validation, planning, and verification      |
| `@hadialmarzooq/agent-media-ffmpeg` | Inspection, capabilities, compilation, execution, workflows |
| `@hadialmarzooq/agent-media-cli`    | JSON-first command-line adapter                             |
| `@hadialmarzooq/agent-media-mcp`    | MCP stdio adapter                                           |

## Documentation

- [Documentation index](docs/README.md)
- [Usage guide](docs/usage.md)
- [Getting started](docs/getting-started.md)
- [Workflows and recovery](docs/workflows.md)
- [API and protocol reference](docs/api.md)
- [Reliability methodology](docs/reliability.md)
- [Errors and recovery](docs/errors.md)
- [Releasing](docs/releasing.md)
- [Architecture](ARCHITECTURE.md)
- [Security](SECURITY.md)
- [Roadmap](ROADMAP.md)

## Safety defaults

Execution rejects source overwrite, refuses existing outputs unless `overwrite` is explicit, can
confine writes to an allowed directory, accepts cancellation and timeout controls, and removes
partial outputs after failure on a best-effort basis. Concatenation inputs are inspected before
execution and rejected when their stream layouts are incompatible.

## Development

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm benchmark:reliability
pnpm audit:prod
```

Contributions use focused branches, Conventional Commits, tests, documentation, and Changesets. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
