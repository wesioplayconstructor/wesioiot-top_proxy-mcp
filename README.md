# wesioiot-mcp

MCP server for **MiniMax media** routed through the `wesioiot` proxy (`api.wesioiot.top`).

Provides 7 tools for AI agents:

| Tool | Function |
|------|----------|
| `text_to_audio` | TTS (PT-BR voices, hex-encoded audio) |
| `list_voices` | List 8 PT-BR voices available |
| `text_to_image` | Image generation (image-01) |
| `generate_video` | Video generation (Hailuo 2.3, async) |
| `query_video_generation` | Poll video task status |
| `music_generation` | Music generation (music-2.6, sync/async) |
| `query_music_generation` | Poll music task status |

## What is the wesioiot proxy?

`api.wesioiot.top` is an OpenAI-compatible proxy that fronts MiniMax's API. The proxy authenticates clients with `mmx-…` tokens (instead of MiniMax's direct `sk-cp-…` keys), enabling per-client rate limiting, audit logs, and quota tracking. This MCP server uses the proxy for all media calls, so the same token the chat provider uses also works here.

## Setup

### 1. Install dependencies

```bash
npm install
```

Requires Node.js 20+.

### 2. Get a proxy token

You need an `mmx-…` API key issued by the wesioiot proxy. If you run the proxy, create a key in the dashboard or via the SQLite database:

```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('/path/to/proxy/data/proxy.sqlite');
const k = db.prepare('SELECT key FROM api_keys WHERE label=?').get('your-label');
console.log(k.key);
"
```

### 3. Configure the MCP server

#### Option A — `hermes mcp add` (Hermes Agent)

```bash
printf "y\ny\n" | hermes mcp add wesioiot-mcp \
  --command node \
  --env WESIOIOT_API_KEY=mmx-... \
  --env WESIOIOT_API_HOST=https://api.wesioiot.top \
  --env WESIOIOT_MCP_BASE_PATH=/path/to/output \
  --args /absolute/path/to/wesioiot-mcp/build/index.js

# The `hermes mcp add --env` flag has a known bug — it only saves the last env var.
# Patch the missing env vars with:
hermes config set mcp_servers.wesioiot-mcp.env.WESIOIOT_API_KEY mmx-... --force
hermes config set mcp_servers.wesioiot-mcp.env.WESIOIOT_API_HOST https://api.wesioiot.top --force
hermes config set mcp_servers.wesioiot-mcp.enabled true --force
```

#### Option B — Generic stdio MCP client

Configure your client to launch:

```
node /absolute/path/to/wesioiot-mcp/build/index.js
```

with environment variables:

| Variable | Required | Default | Example |
|----------|----------|---------|---------|
| `WESIOIOT_API_KEY` | ✅ | — | `mmx-3dc90e8e...` |
| `WESIOIOT_API_HOST` | ❌ | `https://api.wesioiot.top` | custom proxy URL |
| `WESIOIOT_MCP_BASE_PATH` | ❌ | `/tmp` | `~/.cache/wesioiot-mcp` |

### 4. Verify

```bash
hermes mcp test wesioiot-mcp
# Expected: ✓ Connected (~20s) + 7 tools
```

## Tool parameters

### `text_to_audio`
- `text` (string, required) — text to synthesize
- `voiceId` (string) — voice ID (default: `Portuguese_FascinatingBoy`)
- `model` (string) — `speech-02-hd`, `speech-02-turbo`, `speech-2.6-hd`, `speech-2.8-turbo`
- `speed` (number 0.5–2.0) — speech rate
- `vol` (number 0.1–10.0) — volume
- `pitch` (number -12 to 12) — pitch shift
- `outputDirectory` (string) — where to save the MP3 (default: `WESIOIOT_MCP_BASE_PATH`)

### `text_to_image`
- `prompt` (string, required) — image description
- `aspectRatio` (string) — `1:1`, `16:9`, `9:16`, etc.
- `n` (number) — number of images (default 1)
- `outputDirectory` (string) — where to save

### `generate_video`
- `prompt` (string, required) — video description
- Returns a `taskId`. Use `query_video_generation` to poll.

### `music_generation`
- `lyrics` (string, required) — song lyrics
- `prompt` (string) — musical style description
- `title` (string) — song title
- `style` (string) — musical style
- `outputDirectory` (string) — where to save
- May return synchronously (direct audio) or async (task_id) depending on proxy.

## Available PT-BR voices

```
Portuguese_FascinatingBoy          (default)
Portuguese_SmartYoungGirl
Portuguese_ConfidentWoman
Portuguese_Wiselady
Portuguese_Deep-VoicedGentleman
Portuguese_Jovialman
Portuguese_ThoughtfulMan
Portuguese_Strong-WilledBoy
```

## Architecture

```
┌──────────────┐   stdio    ┌──────────────────┐   HTTPS    ┌──────────────────┐
│  MCP client  │ ─────────▶ │  wesioiot-mcp    │ ─────────▶ │ api.wesioiot.top │
│  (Hermes AI) │   JSON-RPC │  (Node.js stdio) │   Bearer   │  (proxy)         │
└──────────────┘            └──────────────────┘   mmx-...   └────────┬─────────┘
                                                                      │ upstream
                                                                      ▼
                                                            ┌──────────────────┐
                                                            │  api.minimax.io  │
                                                            │  (MiniMax)       │
                                                            └──────────────────┘
```

The proxy audits every call, applies per-key rate limits, and forwards to the upstream MiniMax API. Your `mmx-…` token is only valid against the proxy.

## Why a separate MCP?

MiniMax's official `minimax-mcp` package connects directly to `api.minimax.io` with a personal `sk-cp-…` key. This server:

- Uses your proxy token (`mmx-…`) so media goes through the same billing/audit pipeline as chat
- Drops `voice_clone`, `voice_design`, and `play_audio` (not exposed by the proxy)
- Keeps the same JSON-RPC / stdio interface, so any MCP-compatible client works

You can run both MCPs in parallel: `minimax-mcp` for cloning voices, `wesioiot-mcp` for everything that should be billed to the proxy.

## License

MIT
