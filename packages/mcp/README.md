# @hadialmarzooq/agent-media-mcp

MCP server for semantic, replayable, and verified media transformations.

## What it does

A [Model Context Protocol](https://modelcontextprotocol.io) stdio server that exposes [Agent Media](https://github.com/HadiAlMarzooq/agent-media) to AI agents. Sixteen semantic tools covering the full inspect → plan → execute → verify contract, plus plan repair, durable receipts, and content checks.

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
| `validate_plan`          | Report mechanical plan issues without executing         |
| `repair_plan`            | Repair a plan and report every change made              |
| `get_media_plan_schema`  | The canonical Media IR JSON Schema                      |
| `make_vertical`          | Verified 9:16 vertical workflow with progress           |
| `optimize_for_web`       | Verified web optimization workflow with progress        |
| `normalize_media`        | Verified high-compatibility normalization with progress |
| `extract_audio`          | Verified audio extraction with progress                 |
| `extract_frame`          | Verified still frame extraction with progress           |
| `concatenate_media`      | Verified concatenation of two or more clips             |
| `execute_media_plan`     | Execute a serialized or object Media IR plan            |
| `resume_execution`       | Continue from a saved execution receipt                 |
| `inspect_receipt`        | Validate and read a saved receipt                       |
| `verify_media`           | Verify output against plan expectations                 |

Every tool declares an `outputSchema` and returns `structuredContent`. Read-only tools carry
`readOnlyHint`; writer tools carry `destructiveHint`.

## Usage

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agent-media": {
      "command": "agent-media-mcp",
      "env": { "AGENT_MEDIA_ALLOWED_OUTPUT_DIR": "/Users/you/Movies/agent-output" }
    }
  }
}
```

### Claude Code

```bash
claude mcp add agent-media -- agent-media-mcp
```

### Any MCP client

```bash
agent-media-mcp
```

The server runs over stdio. Workflows send standard MCP `notifications/progress` when the client
supplies a progress token, and honour client cancellation. Plan execution and verification accept
either a plan object or serialized plan JSON. Tool failures set `isError: true` and carry the same
structured error body as the SDK and CLI.

## Limits the operator sets

Limits come from the environment, so they belong to whoever runs the server rather than to the model
calling it. No tool accepts them as an argument, so nothing the model sends can widen them.

| Variable                         | Effect                                                    |
| -------------------------------- | --------------------------------------------------------- |
| `AGENT_MEDIA_ALLOWED_OUTPUT_DIR` | writes outside this tree fail with `PATH_NOT_ALLOWED`     |
| `AGENT_MEDIA_TIMEOUT_MS`         | any FFmpeg run beyond this fails with `OPERATION_TIMEOUT` |
| `AGENT_MEDIA_FFMPEG_PATH`        | an `ffmpeg` that is not on `PATH`                         |
| `AGENT_MEDIA_FFPROBE_PATH`       | an `ffprobe` that is not on `PATH`                        |

Without a timeout override, probes get 30 seconds and encodes get 30 minutes.

## Why this instead of raw FFmpeg MCP wrappers

- **Semantic workflows** instead of an FFmpeg-shaped tool per flag
- **Verification** — outputs are re-inspected and checked against plan expectations, not just "exit code 0"
- **Content checks** — black frames, silence, frozen video, and whether every stream decodes
- **Portable plans** — serialize, persist, replay, audit; each step records why it exists
- **Receipts** — a durable record of every run, so a retry skips work that is already correct
- **Structured errors** — stable codes with recovery suggestions, not stderr noise

## Documentation

- [Usage guide](https://github.com/HadiAlMarzooq/agent-media/blob/main/docs/usage.md)
- [Full docs](https://github.com/HadiAlMarzooq/agent-media/tree/main/docs)
- [Workflows](https://github.com/HadiAlMarzooq/agent-media/blob/main/docs/workflows.md)
- [API reference](https://github.com/HadiAlMarzooq/agent-media/blob/main/docs/api.md)
- [Errors and recovery](https://github.com/HadiAlMarzooq/agent-media/blob/main/docs/errors.md)

## License

MIT
