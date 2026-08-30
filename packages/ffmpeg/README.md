# @hadialmarzooq/agent-media-ffmpeg

Safe FFmpeg execution, progress reporting, and verified media workflows for software agents.

## What it does

The FFmpeg backend for [Agent Media](https://github.com/HadiAlMarzooq/agent-media). Compiles semantic Media IR plans into deterministic FFmpeg invocations, executes them with progress reporting, and inspects outputs for verification.

### Five high-level workflows

All workflows share the same contract: **inspect → plan → serialize → execute → verify**. Each returns `{ source, plan, serializedPlan, output, verification }`.

```ts
import {
  makeVertical,
  optimizeForWeb,
  normalize,
  extractAudio,
  extractFrame,
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
});

// Normalized high-compatibility copy
const norm = await normalize({ input: 'demo.mp4', output: 'normalized.mp4' });

// Extract audio
const audio = await extractAudio({ input: 'demo.mp4', output: 'audio.m4a' });

// Extract a still frame
const frame = await extractFrame({ input: 'demo.mp4', output: 'frame.jpg', atSeconds: 2 });
```

### Explicit plan and replay

```ts
import { inspectMedia, executePlan, getCapabilities } from '@hadialmarzooq/agent-media-ffmpeg';
import { planMedia, serializePlan, parsePlan, verifyMedia } from '@hadialmarzooq/agent-media-core';

const source = await inspectMedia('demo.mp4');
const plan = planMedia({
  source,
  capabilities: await getCapabilities(),
  goals: { aspectRatio: '9:16', compatibility: 'high', maxSizeMB: 25 },
});

// Save and replay
const json = serializePlan(plan);
const replayed = parsePlan(json);
const result = await executePlan(replayed, { output: 'vertical.mp4' });
const output = await inspectMedia(result.output);
const report = verifyMedia(output, replayed.expectations);
```

## Install

```bash
npm install @hadialmarzooq/agent-media-core @hadialmarzooq/agent-media-ffmpeg
```

Prerequisites: Node.js 22+, `ffmpeg` and `ffprobe` on `PATH`.

## Safety

- Rejects source overwrite, output collisions, and directory escape
- Cancellation and timeout controls with partial cleanup
- Concatenation preflight rejects incompatible streams before execution
- Progress is monotonic and isolated — UI callbacks can't change execution semantics

## Documentation

- [Full docs](https://github.com/HadiAlMarzooq/agent-media/tree/main/docs)
- [Workflows](https://github.com/HadiAlMarzooq/agent-media/blob/main/docs/workflows.md)
- [API reference](https://github.com/HadiAlMarzooq/agent-media/blob/main/docs/api.md)
- [Reliability](https://github.com/HadiAlMarzooq/agent-media/blob/main/docs/reliability.md)

## License

MIT
