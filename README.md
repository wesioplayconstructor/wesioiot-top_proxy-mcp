# wesioiot-mcp

MCP server para mídia MiniMax (TTS, imagem, vídeo, música) roteada pelo proxy wesioiot (`api.wesioiot.top`).

## Tools disponíveis (7)

| Tool | Função | Custo aprox. |
|------|--------|--------------|
| `text_to_audio` | TTS (vozes PT-BR, áudio hex) | $0.10 / 1k chars |
| `list_voices` | Lista 8 vozes PT-BR disponíveis | grátis |
| `text_to_image` | Geração de imagem (image-01) | $0.02 / imagem |
| `generate_video` | Geração de vídeo (Hailuo 2.3, async) | $0.20–0.50 / vídeo |
| `query_video_generation` | Polling de job de vídeo | grátis |
| `music_generation` | Geração de música (music-2.6, sync/async) | $0.10 / música |
| `query_music_generation` | Polling de job de música | grátis |

## O que é o proxy wesioiot

`api.wesioiot.top` é um proxy OpenAI-compatible que faz frente à API da MiniMax. Ele autentica clientes com tokens `mmx-…` (em vez das chaves diretas `sk-cp-…` da MiniMax), permitindo rate-limit por cliente, log de auditoria e controle de cota. Este MCP usa o proxy para todas as chamadas de mídia, então o mesmo token que o chat usa funciona aqui.

## Instalação

### 1. Instalar dependências

```bash
npm install
```

Requer Node.js 20+.

### 2. Obter um token do proxy

Você precisa de uma chave `mmx-…` emitida pelo proxy wesioiot. Se você roda o proxy, crie a chave pelo dashboard ou direto no SQLite:

```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('/caminho/para/proxy/data/proxy.sqlite');
const k = db.prepare('SELECT key FROM api_keys WHERE label=?').get('seu-label');
console.log(k.key);
"
```

### 3. Configurar o MCP

#### Opção A — `hermes mcp add` (Hermes Agent)

```bash
printf "y\ny\n" | hermes mcp add wesioiot-mcp \
  --command node \
  --env WESIOIOT_API_KEY=mmx-... \
  --env WESIOIOT_API_HOST=https://api.wesioiot.top \
  --env WESIOIOT_MCP_BASE_PATH=/caminho/para/output \
  --args /caminho/absoluto/para/wesioiot-mcp/build/index.js

# Bug conhecido: o `hermes mcp add --env` só salva a última env var.
# Patchear as outras com:
hermes config set mcp_servers.wesioiot-mcp.env.WESIOIOT_API_KEY mmx-... --force
hermes config set mcp_servers.wesioiot-mcp.env.WESIOIOT_API_HOST https://api.wesioiot.top --force
hermes config set mcp_servers.wesioiot-mcp.enabled true --force
```

#### Opção B — Cliente MCP genérico (stdio)

Configure seu cliente para executar:

```
node /caminho/absoluto/para/wesioiot-mcp/build/index.js
```

Com as variáveis de ambiente:

| Variável | Obrigatório | Padrão | Exemplo |
|----------|-------------|--------|---------|
| `WESIOIOT_API_KEY` | ✅ | — | `mmx-3dc90e8e...` |
| `WESIOIOT_API_HOST` | ❌ | `https://api.wesioiot.top` | URL custom do proxy |
| `WESIOIOT_MCP_BASE_PATH` | ❌ | `/tmp` | `~/.cache/wesioiot-mcp` |

### 4. Validar

```bash
hermes mcp test wesioiot-mcp
# Esperado: ✓ Connected (~20s) + 7 tools
```

## Parâmetros das tools

### `text_to_audio`
- `text` (string, obrigatório) — texto a sintetizar
- `voiceId` (string) — ID da voz (padrão: `Portuguese_FascinatingBoy`)
- `model` (string) — `speech-02-hd`, `speech-02-turbo`, `speech-2.6-hd`, `speech-2.8-turbo`
- `speed` (number 0.5–2.0) — velocidade da fala
- `vol` (number 0.1–10.0) — volume
- `pitch` (number -12 a 12) — deslocamento de tom
- `outputDirectory` (string) — onde salvar o MP3 (padrão: `WESIOIOT_MCP_BASE_PATH`)

### `text_to_image`
- `prompt` (string, obrigatório) — descrição da imagem
- `aspectRatio` (string) — `1:1`, `16:9`, `9:16`, etc.
- `n` (number) — quantidade de imagens (padrão 1)
- `outputDirectory` (string) — onde salvar

### `generate_video`
- `prompt` (string, obrigatório) — descrição do vídeo
- Retorna um `taskId`. Use `query_video_generation` para checar.

### `music_generation`
- `lyrics` (string, obrigatório) — letra da música
- `prompt` (string) — descrição do estilo musical
- `title` (string) — título da música
- `style` (string) — estilo musical
- `outputDirectory` (string) — onde salvar
- Pode retornar sincronamente (áudio direto) ou assincronamente (task_id).

## Vozes PT-BR disponíveis

```
Portuguese_FascinatingBoy          (padrão)
Portuguese_SmartYoungGirl
Portuguese_ConfidentWoman
Portuguese_Wiselady
Portuguese_Deep-VoicedGentleman
Portuguese_Jovialman
Portuguese_ThoughtfulMan
Portuguese_Strong-WilledBoy
```

## Arquitetura

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

O proxy audita cada chamada, aplica rate-limit por chave e repassa para a API upstream da MiniMax. O token `mmx-…` só é válido contra o proxy.

## Por que um MCP separado

O pacote oficial `minimax-mcp` da MiniMax conecta direto no `api.minimax.io` com chave pessoal `sk-cp-…`. Este server:

- Usa seu token do proxy (`mmx-…`) — mídia passa pelo mesmo pipeline de billing/auditoria do chat
- Remove `voice_clone`, `voice_design` e `play_audio` (não expostos pelo proxy)
- Mantém a mesma interface JSON-RPC / stdio, então qualquer cliente MCP-compatível funciona

Você pode rodar os dois MCPs em paralelo: `minimax-mcp` para clonar vozes, `wesioiot-mcp` para tudo que deve ser cobrado do proxy.

## Licença

MIT
