# @hadialmarzooq/agent-media-core

Versioned media planning and structured verification primitives for software agents.

## What it does

Core package for [Agent Media](https://github.com/HadiAlMarzooq/agent-media) — a deterministic media transformation runtime. This package provides:

- **Media IR v1** — a versioned, serializable, validated semantic plan schema
- **planMedia()** — turns semantic goals into inspectable, portable plans with reasons
- **verifyMedia()** — structured verification of output metadata against plan expectations
- **serializePlan() / parsePlan()** — portable JSON serialization with full validation at every boundary
- **MediaError** — stable, machine-readable error codes with context and recovery suggestions

## Install

```bash
npm install @hadialmarzooq/agent-media-core
```

## Quick start

```ts
import { planMedia, serializePlan, verifyMedia } from '@hadialmarzooq/agent-media-core';

const plan = planMedia({
  source: metadata,
  goals: { aspectRatio: '9:16', compatibility: 'high', maxSizeMB: 25 },
});

const serialized = serializePlan(plan); // portable JSON — save it, send it, replay it

const report = verifyMedia(outputMetadata, plan.expectations);
// { passed: true, checks: { ... }, failures: [] }
```

## The contract

```text
inspect → plan → versioned Media IR → execute → inspect again → verify
```

Plans are inspectable before execution, serializable across process boundaries, and outputs are verified against fresh metadata — not just "FFmpeg exited 0."

## Documentation

- [Full docs](https://github.com/HadiAlMarzooq/agent-media/tree/main/docs)
- [API reference](https://github.com/HadiAlMarzooq/agent-media/blob/main/docs/api.md)
- [Errors and recovery](https://github.com/HadiAlMarzooq/agent-media/blob/main/docs/errors.md)

## License

MIT
