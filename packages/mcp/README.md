# @hadialmarzooq/agent-media-mcp

MCP server for semantic, replayable, and verified media transformations.

## What it does

A [Model Context Protocol](https://modelcontextprotocol.io) stdio server that exposes [Agent Media](https://github.com/HadiAlMarzooq/agent-media) to AI agents. Ten semantic tools covering the full inspect → plan → execute → verify contract.

## Install

```bash
npm install -g @hadialmarzooq/agent-media-mcp
```

Prerequisites: Node.js 22+, `ffmpeg` and `ffprobe` on `PATH`.

## Tools

| Tool                     | Description                                             |
| ------------------------ | ------------------------------------------------------- |
| `inspect_media`          | Inspect normalized media metadata                       |
| `get_media_capabilities` | Detect local FFmpeg capabilities                        |
| `plan_media`             | Create an inspectable versioned Media IR plan           |
| `make_vertical`          | Verified 9:16 vertical workflow with progress           |
| `optimize_for_web`       | Verified web optimization workflow with progress        |
| `normalize_media`        | Verified high-compatibility normalization with progress |
| `extract_audio`          | Verified audio extraction with progress                 |
| `extract_frame`          | Verified still frame extraction with progress           |
| `execute_media_plan`     | Execute a serialized or object Media IR plan            |
| `verify_media`           | Verify output against plan expectations                 |

## Usage

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agent-media": {
      "command": "agent-media-mcp"
    }
  }
}
```

### Any MCP client

```bash
agent-media-mcp
```

The server runs over stdio. Workflows send standard MCP `notifications/progress` when the client supplies a progress token. Plan execution and verification accept either a plan object or serialized plan JSON. Tool failures set `isError: true` and carry the same structured error body as the SDK and CLI.

## Why this instead of raw FFmpeg MCP wrappers

- **5 semantic workflows** instead of 40+ FFmpeg-shaped tools
- **Verification** — outputs are inspected and checked against plan expectations, not just "exit code 0"
- **Portable plans** — serialize, persist, replay, audit
- **Structured errors** — stable codes with recovery suggestions, not stderr noise

## Documentation

- [Full docs](https://github.com/HadiAlMarzooq/agent-media/tree/main/docs)
- [Workflows](https://github.com/HadiAlMarzooq/agent-media/blob/main/docs/workflows.md)
- [API reference](https://github.com/HadiAlMarzooq/agent-media/blob/main/docs/api.md)
- [Errors and recovery](https://github.com/HadiAlMarzooq/agent-media/blob/main/docs/errors.md)

## License

MIT
