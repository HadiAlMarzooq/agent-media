# Getting started

## Prerequisites

- Node.js 22 or newer
- pnpm 10
- FFmpeg with `ffmpeg`, `ffprobe`, `libx264`, and AAC support on `PATH`

Common FFmpeg installations:

```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt-get update && sudo apt-get install --yes ffmpeg

# Windows (elevated PowerShell)
choco install ffmpeg --yes
```

Confirm the tools are visible:

```bash
node --version
pnpm --version
ffmpeg -version
ffprobe -version
```

## Build from source

The npm packages are intentionally unpublished during the private release-candidate stage.

```bash
git clone https://github.com/HadiAlMarzooq/agent-media.git
cd agent-media
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

GitHub prereleases also attach installable package tarballs. They are built only after formatting,
linting, type checking, tests, the reliability corpus, and a production dependency audit pass.

## First CLI transformation

The built CLI can be invoked directly from the workspace:

```bash
node packages/cli/dist/index.js inspect demo.mp4
node packages/cli/dist/index.js vertical demo.mp4 \
  --output vertical.mp4 \
  --max-size 25 \
  --progress
```

The final result is JSON on stdout. Progress events are NDJSON on stderr. Redirect them independently
when building automation:

```bash
node packages/cli/dist/index.js vertical demo.mp4 \
  --output vertical.mp4 \
  --progress \
  1>result.json \
  2>progress.ndjson
```

## First SDK workflow

```ts
import { makeVertical } from '@hadialmarzooq/agent-media-ffmpeg';

const result = await makeVertical({
  input: 'demo.mp4',
  output: 'vertical.mp4',
  width: 720,
  height: 1280,
  maxSizeMB: 12,
  audio: 'preserve',
  timeoutMs: 120_000,
  onProgress: (event) => console.error(event),
});

if (!result.verification.passed) {
  throw new Error(result.verification.failures.join('\n'));
}
```

Custom width and height must be supplied together and must describe 9:16. Without them,
`makeVertical` uses 1080×1920. It chooses the high-compatibility H.264/yuv420p profile and preserves
audio when the source has audio unless `audio: "remove"` is explicit.

## First explicit plan

Use the lower-level pipeline when an agent must approve, persist, transmit, or modify intent before
execution:

```ts
import { parsePlan, planMedia, serializePlan, verifyMedia } from '@hadialmarzooq/agent-media-core';
import { executePlan, getCapabilities, inspectMedia } from '@hadialmarzooq/agent-media-ffmpeg';

const source = await inspectMedia('demo.mp4');
const plan = planMedia({
  source,
  capabilities: await getCapabilities(),
  goals: { aspectRatio: '9:16', width: 720, height: 1280, compatibility: 'high' },
});

const transported = serializePlan(plan);
const replayed = parsePlan(transported);
const execution = await executePlan(replayed, { output: 'vertical.mp4' });
const report = verifyMedia(await inspectMedia(execution.output), replayed.expectations);
```

## MCP setup

After building, point an MCP client at the generated executable:

```json
{
  "mcpServers": {
    "agent-media": {
      "command": "node",
      "args": ["/absolute/path/to/agent-media/packages/mcp/dist/index.js"]
    }
  }
}
```

Call `get_media_capabilities` first if the agent needs to know whether the local FFmpeg build can
satisfy high-compatibility planning. Then use either the `make_vertical` workflow or the explicit
`inspect_media` → `plan_media` → `execute_media_plan` → `verify_media` sequence.

## Next steps

- Learn how plans and recovery fit together in [Workflows](workflows.md).
- Review every public function and protocol operation in the [API reference](api.md).
- Handle failures using stable codes from [Errors and recovery](errors.md).
