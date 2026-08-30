# API and protocol reference

Agent Media deliberately separates semantic planning from its FFmpeg backend. The stable path is:

```text
inspectMedia → planMedia → serializePlan/parsePlan → executePlan → inspectMedia → verifyMedia
```

For the opinionated use cases, five high-level workflows compose that same path without bypassing
Media IR: `makeVertical`, `optimizeForWeb`, `normalize`, `extractAudio`, `extractFrame`.

## Core package

Import from `@hadialmarzooq/agent-media-core`.

### `planMedia(request)`

Creates validated Media IR v1 from normalized source metadata and semantic goals.

```ts
interface PlanRequest {
  source: MediaMetadata;
  goals: MediaGoals;
  capabilities?: FfmpegCapabilities;
}
```

Supported `MediaGoals`:

| Goal               | Type                                   | Notes                                 |
| ------------------ | -------------------------------------- | ------------------------------------- |
| `trimStartSeconds` | `number`                               | non-negative                          |
| `trimEndSeconds`   | `number`                               | mutually exclusive with duration      |
| `durationSeconds`  | `number`                               | requires known source duration        |
| `aspectRatio`      | `"width:height"`                       | positive integer components           |
| `width`, `height`  | `number`                               | positive integers, supplied together  |
| `maxSizeMB`        | `number`                               | positive, requires known duration     |
| `compatibility`    | `"high" \| "balanced"`                 | high records codec/pixel expectations |
| `quality`          | `"high" \| "balanced" \| "small"`      | selects an encode profile             |
| `audio`            | `"preserve" \| "remove"`               | preserve requires source audio        |
| `extractAudio`     | `{ format?: "m4a" \| "mp3" \| "wav" }` | terminal operation                    |
| `extractFrame`     | `{ atSeconds?, format? }`              | terminal operation                    |
| `concatenate`      | `string[]`                             | terminal; paths after declared source |

Terminal operations cannot be mixed with transformation goals in Media IR v1. Conflicts and
impossible goals throw `MediaError` with `INVALID_PLAN`.

### Media IR boundaries

```ts
validatePlan(value: unknown): MediaPlan
serializePlan(plan: MediaPlan): string
parsePlan(serialized: string): MediaPlan
```

All three validate at runtime. Media IR v1 requires:

- `irVersion: "1"`;
- a non-empty source path;
- unique step IDs;
- no duplicate operation types;
- transform order of trim → reframe → resize → encode;
- terminal extraction/concatenation as the only step;
- first concatenation input equal to the declared source;
- size constraints consistent with encode and byte expectations; and
- high compatibility consistent with H.264/yuv420p expectations.

Use the committed [JSON Schema](media-plan.schema.json) in non-TypeScript systems. The runtime Zod
schema remains authoritative.

### `verifyMedia(output, expectations)`

Returns a `VerificationReport`; normal constraint failure does not throw.

```ts
interface VerificationReport {
  passed: boolean;
  checks: Record<
    string,
    {
      passed: boolean;
      expected: unknown;
      actual: unknown;
      message: string;
    }
  >;
  failures: string[];
}
```

Possible checks are duration (±0.25 seconds), aspect ratio, width, height, maximum file size (2%
tolerance), audio presence, container, video codec, and pixel format.

### Errors

`MediaError` extends `Error`, exposes stable fields, and has `toJSON()`. See
[Errors and recovery](errors.md) for every code and the recommended branching strategy.

## FFmpeg package

Import from `@hadialmarzooq/agent-media-ffmpeg`.

### `inspectMedia(input, options?)`

Runs ffprobe and returns normalized `MediaMetadata`:

```ts
interface MediaMetadata {
  path: string; // resolved absolute path
  kind: 'video' | 'audio' | 'image' | 'unknown';
  durationSeconds?: number;
  container?: string;
  sizeBytes: number;
  video?: {
    width: number;
    height: number;
    aspectRatio: string;
    fps?: number;
    codec?: string;
    pixelFormat?: string;
    rotationDegrees?: number;
  };
  audio: {
    present: boolean;
    codec?: string;
    sampleRate?: number;
    channels?: number;
  };
}
```

`FfmpegOptions` can override `ffmpegPath`, `ffprobePath`, and `timeoutMs`.

### `getCapabilities(options?)`

Reports the FFmpeg version, usable H.264/HEVC/AV1/AAC encoders, hardware accelerators, and relevant
filters. H.264 is true only when `libx264` is available because that is what the current compiler
emits.

### `compilePlan(plan, source, output)`

Deterministically compiles semantic Media IR into `{ executable, args }`. This is a backend-level
diagnostic surface. Do not send its raw arguments to an untrusted agent.

### `executePlan(plan, options)`

```ts
interface ExecuteOptions extends FfmpegOptions {
  output: string;
  sourceMetadata?: MediaMetadata;
  overwrite?: boolean;
  allowedOutputDirectory?: string;
  signal?: AbortSignal;
  onProgress?: (event: MediaProgress) => void;
}
```

Execution validates Media IR again. By default it inspects the declared source; supplied
`sourceMetadata` must resolve to exactly the same path. Concatenation preflights every input and
reports incompatible stream fields before spawning the final encode.

The result contains the resolved output and compiled backend operation. CLI and MCP intentionally
omit raw arguments. Source overwrite and permitted-directory escape are rejected. Existing outputs
require `overwrite: true`. Failure, timeout, and cancellation trigger best-effort partial cleanup.

### Progress

```ts
interface MediaProgress {
  phase: 'inspecting' | 'planning' | 'executing' | 'verifying' | 'completed';
  percent: number;
  message: string;
  processedSeconds?: number;
  totalSeconds?: number;
  speed?: number;
}
```

`executePlan` emits the `executing` phase. All five workflows emit the full lifecycle. Percentages
are monotonic, and completion is exactly 100. Intermediate timing fields are optional.

### High-level workflows

All five workflows share `WorkflowOptions` (input, output, overwrite, allowedOutputDirectory,
signal, onProgress) and return `{ source, plan, serializedPlan, output, verification }`.

#### `makeVertical(options)`

9:16 vertical, H.264/yuv420p, faststart. Defaults to 1080×1920. Custom dimensions must be supplied
together and match 9:16.

```ts
interface MakeVerticalOptions extends WorkflowOptions {
  width?: number; // default 1080
  height?: number; // default 1920
  trimStartSeconds?: number;
  durationSeconds?: number;
  maxSizeMB?: number;
  audio?: 'preserve' | 'remove';
}
```

#### `optimizeForWeb(options)`

Web-optimized: balanced quality, H.264/yuv420p, faststart, optional size ceiling.

```ts
interface OptimizeForWebOptions extends WorkflowOptions {
  trimStartSeconds?: number;
  durationSeconds?: number;
  maxSizeMB?: number;
  audio?: 'preserve' | 'remove';
  quality?: 'high' | 'balanced' | 'small';
}
```

#### `normalize(options)`

Normalized high-compatibility copy without changing dimensions or aspect ratio.

```ts
interface NormalizeOptions extends WorkflowOptions {
  trimStartSeconds?: number;
  durationSeconds?: number;
  audio?: 'preserve' | 'remove';
}
```

#### `extractAudio(options)`

Audio extraction from any media source.

```ts
interface ExtractAudioOptions extends WorkflowOptions {
  format?: 'm4a' | 'mp3' | 'wav';
  trimStartSeconds?: number;
  durationSeconds?: number;
}
```

#### `extractFrame(options)`

Still frame extraction from a video source.

```ts
interface ExtractFrameOptions extends WorkflowOptions {
  atSeconds?: number;
  format?: 'jpg' | 'png';
}
```

A failed final report in any workflow becomes `VERIFICATION_FAILED`.

## Complete TypeScript pipeline

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

const persisted = serializePlan(plan);
const replayed = parsePlan(persisted);
const execution = await executePlan(replayed, {
  output: 'vertical.mp4',
  onProgress: console.error,
});
const output = await inspectMedia(execution.output);
const verification = verifyMedia(output, replayed.expectations);
```

## CLI reference

| Command                                            | Purpose                                   |
| -------------------------------------------------- | ----------------------------------------- |
| `inspect <input>`                                  | normalized metadata                       |
| `capabilities`                                     | installed FFmpeg features                 |
| `plan <input> [goals]`                             | create Media IR; optionally write `--out` |
| `vertical <input> --output`                        | complete high-level vertical workflow     |
| `optimize <input> --output`                        | complete web optimization workflow        |
| `normalize <input> --output`                       | complete normalization workflow           |
| `extract-audio <input> --output`                   | complete audio extraction workflow        |
| `extract-frame <input> --output`                   | complete frame extraction workflow        |
| `concatenate <input> --inputs <paths...> --output` | complete concatenation workflow           |
| `execute <plan> --output`                          | replay persisted Media IR                 |
| `verify <output> --against`                        | verify media against persisted Media IR   |

`vertical`, `optimize`, `normalize`, `extract-audio`, `extract-frame`, `concatenate`, and `execute` accept
`--progress`. Successful result JSON is stdout; progress NDJSON and structured failures are stderr.

## MCP reference

| Tool                     | Input summary                                        |
| ------------------------ | ---------------------------------------------------- |
| `inspect_media`          | `input` (read-only)                                  |
| `get_media_capabilities` | none (read-only)                                     |
| `plan_media`             | `input`, semantic `goals` (read-only)                |
| `make_vertical`          | input/output, geometry, trim, size, audio, overwrite |
| `optimize_for_web`       | input/output, trim, size, quality, audio, overwrite  |
| `normalize_media`        | input/output, trim, audio, overwrite                 |
| `extract_audio`          | input/output, format, trim, overwrite                |
| `extract_frame`          | input/output, timestamp, format, overwrite           |
| `concatenate_media`      | `inputs[]` in playback order, output, overwrite      |
| `execute_media_plan`     | plan object or JSON, output, overwrite               |
| `verify_media`           | output, plan object or JSON (read-only)              |

MCP plan handoff does not require manual stringification. Failures use `isError: true` and the same
structured error shape; `execute_media_plan` fails that way when the output does not satisfy the
plan, matching the workflow tools rather than returning a success envelope with `passed: false`.
Every tool declares an `outputSchema` and returns `structuredContent` alongside the text result. All writer tools honor request cancellation and emit standard progress
notifications when requested by the client. Read-only tools are annotated with `readOnlyHint`;
writer tools with `destructiveHint`.
