# API guide

Agent Media deliberately separates semantic planning from the FFmpeg backend. Callers inspect the
source, create and optionally persist a plan, execute it, inspect the result, and verify the recorded
expectations.

## TypeScript pipeline

```ts
import { parsePlan, planMedia, serializePlan, verifyMedia } from '@hadialmarzooq/agent-media-core';
import { executePlan, getCapabilities, inspectMedia } from '@hadialmarzooq/agent-media-ffmpeg';

const source = await inspectMedia('demo.mp4');
const plan = planMedia({
  source,
  capabilities: await getCapabilities(),
  goals: {
    aspectRatio: '9:16',
    width: 1080,
    height: 1920,
    compatibility: 'high',
    maxSizeMB: 25,
  },
});

const persistedPlan = serializePlan(plan);
const execution = await executePlan(parsePlan(persistedPlan), { output: 'vertical.mp4' });
const output = await inspectMedia(execution.output);
const verification = verifyMedia(output, plan.expectations);

if (!verification.passed) throw new Error(verification.failures.join('\n'));
```

`executePlan` validates the plan again and inspects its declared source. Advanced embedders may pass
already-inspected `sourceMetadata`, but it must describe the exact planned source path.

## Media IR boundaries

- `planMedia(request)` creates Media IR v1 from normalized metadata and semantic goals.
- `validatePlan(value)` validates an unknown in-memory value and returns a typed plan.
- `serializePlan(plan)` validates and writes canonical indented JSON.
- `parsePlan(json)` parses and validates persisted JSON.

All four throw `MediaError` with code `INVALID_PLAN` for invalid input. Media IR v1 requires unique
step IDs. Extraction and concatenation are terminal operations and cannot be combined with other
steps; the planner rejects such requests rather than silently dropping work.

## Execution safety

Outputs never replace the source. Existing output files require `overwrite: true`, and embedders can
set `allowedOutputDirectory`. `timeoutMs` and `signal` support timeout and cancellation. Failed,
cancelled, and timed-out operations remove a partial output on a best-effort basis.

The backend SDK execution result includes the resolved output path and compiled operation for local
debugging. CLI and MCP responses intentionally omit raw FFmpeg arguments so agents stay on the
semantic surface.

## Verification

Verification always consumes a fresh `MediaMetadata` value. Depending on the plan, checks cover
duration, dimensions, aspect ratio, maximum bytes, audio presence, container, video codec, and pixel
format. Maximum-size checks allow 2% container/encoding tolerance. A report can fail without throwing,
so agents can inspect every failed constraint and choose a recovery.

## MCP plan handoff

`plan_media` returns a plan object. `execute_media_plan` and `verify_media` accept that object directly
or its serialized JSON form. Tool failures set `isError` and return the same structured error fields
as the SDK and CLI.
