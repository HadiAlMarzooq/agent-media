<p align="center">
  <img src="assets/logo-pixel.png" width="192" alt="Agent Media pixel-art logo" />
</p>

<h1 align="center">Agent Media</h1>

<p align="center">
  <strong>Deterministic media workflows for software agents.</strong><br />
  Inspect intent. Replay plans. Verify outcomes.
</p>

Agent Media turns goals such as “make this vertical, broadly compatible, and under 25 MB” into a
versioned semantic plan. The plan can be inspected before execution, serialized across process
boundaries, replayed through FFmpeg, and verified against fresh output metadata afterward.

FFmpeg is the first backend. It is deliberately not the agent-facing abstraction.

> [!IMPORTANT]
> The repository is a private release candidate. Packages are not published to npm yet; install from
> source or use the tarballs attached to a GitHub prerelease.

## Why Agent Media

Most media wrappers stop after a subprocess exits successfully. Agent Media treats that as only one
step in a safer contract:

```text
semantic goal → inspect → versioned Media IR → execute → inspect again → verify
```

| Property             | What the agent gets                                                         |
| -------------------- | --------------------------------------------------------------------------- |
| Semantic planning    | Goals and reasons instead of raw FFmpeg flags                               |
| Portable Media IR    | Validated JSON that can be reviewed, persisted, and replayed                |
| Outcome verification | Structured checks for duration, geometry, size, audio, codec, and pixels    |
| Structured recovery  | Stable error codes and every failed verification check in one report        |
| Observable execution | Monotonic progress through SDK callbacks, CLI NDJSON, and MCP notifications |
| One implementation   | The SDK, JSON CLI, MCP server, and high-level workflows share the same core |

## Quick start

Prerequisites: Node.js 22+, pnpm 10, `ffmpeg`, and `ffprobe` on `PATH`.

```bash
git clone https://github.com/HadiAlMarzooq/agent-media.git
cd agent-media
pnpm install --frozen-lockfile
pnpm build
```

Create a verified vertical video with one SDK call:

```ts
import { makeVertical } from '@hadialmarzooq/agent-media-ffmpeg';

const result = await makeVertical({
  input: 'demo.mp4',
  output: 'vertical.mp4',
  maxSizeMB: 25,
  onProgress: ({ phase, percent }) => console.error(`${phase}: ${percent}%`),
});

console.log(result.plan); // portable Media IR v1
console.log(result.verification.passed); // true, or the workflow throws VERIFICATION_FAILED
```

`makeVertical` defaults to a 1080×1920, H.264/yuv420p, fast-start compatible output. It still
returns the inspected source, plan, serialized plan, freshly inspected output, and verification
report—convenience without hiding the contract.

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
agent-media plan demo.mp4 --aspect 9:16 --max-size 25 --out plan.json
agent-media execute plan.json --output replay.mp4 --progress
agent-media verify replay.mp4 --against plan.json
agent-media capabilities
```

Failures are JSON on stderr with a stable `code`, a human message, relevant context, and suggested
recovery actions.

## MCP

Run `agent-media-mcp` over stdio. It exposes six semantic tools:

- `inspect_media`
- `get_media_capabilities`
- `plan_media`
- `make_vertical`
- `execute_media_plan`
- `verify_media`

`make_vertical` and `execute_media_plan` send standard MCP progress notifications when the client
requests progress. Plan execution and verification accept either the plan object returned by
`plan_media` or serialized plan JSON. Tool failures set `isError` and carry the same structured error
body as the SDK and CLI.

## Reliability evidence

The reliability corpus covers a constrained-size transcode, malformed bytes, an audio-only visual
request, and incompatible concatenation streams:

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
