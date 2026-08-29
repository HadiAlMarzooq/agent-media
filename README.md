# Agent Media

> A deterministic media transformation runtime for software agents.

Agent Media lets software inspect, plan, execute, and verify media transformations through a
small semantic API. FFmpeg is the first backend, not the public abstraction.

## Status

Private pre-public development. Packages are not published and the API is intentionally evolving.

## Development

```bash
pnpm install
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

See [ROADMAP.md](ROADMAP.md) for delivery status and [ARCHITECTURE.md](ARCHITECTURE.md) for
design boundaries.

## CLI

Every command emits JSON suitable for automation:

```bash
agent-media inspect demo.mp4
agent-media plan demo.mp4 --aspect 9:16 --max-size 25 --out plan.json
agent-media execute plan.json --output vertical.mp4
agent-media verify vertical.mp4 --against plan.json
agent-media capabilities
```

## MCP

Run `agent-media-mcp` over stdio. It exposes five semantic tools: `inspect_media`, `plan_media`,
`execute_media_plan`, `verify_media`, and `get_media_capabilities`.

## Safety

Execution never overwrites an existing file unless `overwrite` is explicit, and it always rejects
using the source path as output. Embedders can restrict results with `allowedOutputDirectory`, and
can stop a run with an `AbortSignal` or a timeout. Size verification permits a documented 2%
tolerance because encoding output cannot be estimated exactly.
