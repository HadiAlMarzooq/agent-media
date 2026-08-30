# @hadialmarzooq/agent-media-cli

JSON-first CLI for deterministic, verified media workflows.

## What it does

Command-line interface for [Agent Media](https://github.com/HadiAlMarzooq/agent-media). Every command outputs one JSON document to stdout. Optional progress is newline-delimited JSON on stderr — so automation never receives mixed output.

## Install

```bash
npm install -g @hadialmarzooq/agent-media-cli
```

Prerequisites: Node.js 22+, `ffmpeg` and `ffprobe` on `PATH`.

## Commands

```bash
# Inspect media metadata
agent-media inspect demo.mp4

# Five verified workflows
agent-media vertical demo.mp4 --output vertical.mp4 --max-size 25 --progress
agent-media optimize demo.mp4 --output web.mp4 --max-size 10 --progress
agent-media normalize demo.mp4 --output normalized.mp4
agent-media extract-audio demo.mp4 --output audio.m4a
agent-media extract-frame demo.mp4 --output frame.jpg --at 2

# Explicit plan → execute → verify pipeline
agent-media plan demo.mp4 --aspect 9:16 --max-size 25 --out plan.json
agent-media execute plan.json --output replay.mp4 --progress
agent-media verify replay.mp4 --against plan.json

# Detect local FFmpeg capabilities
agent-media capabilities
```

## Output format

Successes write JSON to stdout:

```json
{
  "path": "/abs/path/vertical.mp4",
  "kind": "video",
  "video": { "width": 1080, "height": 1920, "codec": "h264", "pixelFormat": "yuv420p" },
  "verification": { "passed": true, "checks": { ... }, "failures": [] }
}
```

Failures write structured JSON to stderr with stable `code`, `message`, `context`, and `suggestedActions`.

## Documentation

- [Full docs](https://github.com/HadiAlMarzooq/agent-media/tree/main/docs)
- [Getting started](https://github.com/HadiAlMarzooq/agent-media/blob/main/docs/getting-started.md)
- [API reference](https://github.com/HadiAlMarzooq/agent-media/blob/main/docs/api.md)
- [Errors and recovery](https://github.com/HadiAlMarzooq/agent-media/blob/main/docs/errors.md)

## License

MIT
