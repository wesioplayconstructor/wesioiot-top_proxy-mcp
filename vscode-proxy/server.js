// VS Code MCP Proxy — stdio MCP → Streamable HTTP com bearer token
// Expor todos os MCPs do Hermes como multi-server.
//
// Arquitetura: 1 child process por server (long-lived). Por request:
//   1. Cliente faz POST /mcp/<name> com JSON-RPC
//   2. Proxy roteia a mensagem pro child via stdio (write JSON line no stdin)
//   3. Lê a resposta do stdout e devolve ao cliente HTTP
//
// Auth: Bearer token único em ~/.hermes/mcp-proxy/.token

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// === Config ===
const CONFIG_PATH = process.env.MCP_PROXY_CONFIG || path.join(os.homedir(), '.hermes/mcp-proxy/config.json');
const TOKEN_PATH = process.env.MCP_PROXY_TOKEN_FILE || path.join(os.homedir(), '.hermes/mcp-proxy/.token');
const PORT = parseInt(process.env.MCP_PROXY_PORT || '8182', 10);
const HOST = process.env.MCP_PROXY_HOST || '0.0.0.0';

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`[proxy] Config not found: ${CONFIG_PATH}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function loadToken() {
  if (!fs.existsSync(TOKEN_PATH)) {
    console.error(`[proxy] Token not found: ${TOKEN_PATH}`);
    process.exit(1);
  }
  return fs.readFileSync(TOKEN_PATH, 'utf-8').trim();
}

const config = loadConfig();
const EXPECTED_TOKEN = loadToken();

// === Stdio MCP server (long-lived child) ===
// Cada server roda como child process. A gente envia JSON-RPC via stdin (line-delimited JSON)
// e lê a resposta do stdout. Para HTTP, multiplexamos: correlacionamos request.id com response.id.

class StdioMCPServer {
  constructor(name, command, args, env, url) {
    this.name = name;
    this.command = command;
    this.args = args || [];
    this.env = env || {};
    this.url = url;  // for remote servers
    this.proc = null;
    this.tools = [];
    this.ready = false;
    this.pending = new Map(); // request_id → resolve/reject
    this.nextId = 1;
  }

  async start() {
    if (this.url) {
      // Remote HTTP MCP — fetch tools via initialize+listTools
      console.log(`[${this.name}] connecting remote: ${this.url}`);
      await this._initRemote();
      return;
    }
    console.log(`[${this.name}] spawning: ${this.command} ${this.args.join(' ')}`);
    this.proc = spawn(this.command, this.args, {
      env: { ...process.env, ...this.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.stderr.on('data', (d) => {
      process.stderr.write(`[${this.name}:stderr] ${d.toString()}`);
    });

    this.proc.on('exit', (code, signal) => {
      console.warn(`[${this.name}] exited code=${code} signal=${signal}`);
      this.ready = false;
      // Reject all pending
      for (const [id, p] of this.pending) {
        p.reject(new Error(`Server ${this.name} exited`));
      }
      this.pending.clear();
    });

    this.proc.on('error', (err) => {
      console.error(`[${this.name}] error:`, err.message);
    });

    // Buffer for stdout line-by-line
    let buf = '';
    this.proc.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          this._handleMessage(msg);
        } catch (e) {
          console.error(`[${this.name}] bad JSON in stdout: ${line}`);
        }
      }
    });

    // Initialize
    await this._send({
      jsonrpc: '2.0',
      id: this._next(),
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'vscode-mcp-proxy', version: '1.0.0' },
      },
    });

    // Send initialized notification
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

    // List tools
    const toolsRes = await this._send({
      jsonrpc: '2.0',
      id: this._next(),
      method: 'tools/list',
      params: {},
    });
    this.tools = toolsRes.result?.tools || [];
    this.ready = true;
    console.log(`[${this.name}] ready, ${this.tools.length} tools`);
  }

  async _initRemote() {
    // Skip for now — focus on local stdio
    throw new Error(`Remote HTTP MCP not supported in this minimal proxy: ${this.url}`);
  }

  _next() { return this.nextId++; }

  _handleMessage(msg) {
    if (msg.id != null) {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message || 'MCP error'));
        else p.resolve(msg);
      }
    } else {
      // Notification
      console.log(`[${this.name}] notification: ${msg.method}`);
    }
  }

  _send(msg) {
    return new Promise((resolve, reject) => {
      if (this.proc.killed) return reject(new Error('Process killed'));
      this.pending.set(msg.id, { resolve, reject });
      const line = JSON.stringify(msg) + '\n';
      this.proc.stdin.write(line, (err) => {
        if (err) {
          this.pending.delete(msg.id);
          reject(err);
        }
      });
      // Timeout 60s
      setTimeout(() => {
        if (this.pending.has(msg.id)) {
          this.pending.delete(msg.id);
          reject(new Error(`MCP request ${msg.id} timeout`));
        }
      }, 60000);
    });
  }

  async callTool(name, args) {
    if (!this.ready) throw new Error(`Server ${this.name} not ready`);
    return await this._send({
      jsonrpc: '2.0',
      id: this._next(),
      method: 'tools/call',
      params: { name, arguments: args || {} },
    });
  }

  listTools() {
    return { tools: this.tools };
  }

  stop() {
    if (this.proc) {
      this.proc.kill('SIGTERM');
      setTimeout(() => {
        if (this.proc && !this.proc.killed) this.proc.kill('SIGKILL');
      }, 2000);
    }
  }
}

// === HTTP app ===
function makeApp(servers) {
  const app = express();
  app.use(cors({ origin: '*' }));
  app.use(express.json({ limit: '10mb' }));

  function requireAuth(req, res, next) {
    const auth = req.headers['authorization'] || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (!token || token !== EXPECTED_TOKEN) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    next();
  }

  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      servers: Object.keys(servers).map((name) => ({
        name,
        ready: servers[name]?.ready || false,
        tools: (servers[name]?.tools || []).map((t) => t.name),
      })),
    });
  });

  app.get('/servers', requireAuth, (req, res) => {
    res.json({
      servers: Object.keys(servers).map((name) => ({
        name,
        url: `http://${req.headers.host}/mcp/${name}`,
        ready: servers[name]?.ready || false,
        tools: (servers[name]?.tools || []).map((t) => t.name),
      })),
    });
  });

  // MCP over HTTP. Two flavors:
  //   - POST /mcp/<name> with JSON-RPC body → forward to child, return response
  //   - GET  /mcp/<name> → SSE stream (not implemented in minimal proxy; for VS Code we use POST)
  app.post('/mcp/:name', requireAuth, async (req, res) => {
    const name = req.params.name;
    const server = servers[name];
    if (!server) return res.status(404).json({ error: 'server_not_found' });

    const body = req.body;
    if (!body || body.jsonrpc !== '2.0') {
      return res.status(400).json({ error: 'invalid_jsonrpc' });
    }

    try {
      // Map method → server call
      let result;
      if (body.method === 'initialize') {
        result = {
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: `vscode-mcp-proxy-${name}`, version: '1.0.0' },
          },
        };
      } else if (body.method === 'tools/list') {
        result = {
          jsonrpc: '2.0',
          id: body.id,
          result: server.listTools(),
        };
      } else if (body.method === 'tools/call') {
        const params = body.params || {};
        const r = await server.callTool(params.name, params.arguments || {});
        result = { jsonrpc: '2.0', id: body.id, result: r.result ?? r };
      } else if (body.method === 'notifications/initialized' || body.method?.startsWith('notifications/')) {
        // Acknowledge
        return res.status(204).end();
      } else {
        return res.status(400).json({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Method not implemented: ' + body.method } });
      }
      res.json(result);
    } catch (e) {
      res.status(500).json({
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32603, message: e.message },
      });
    }
  });

  // GET /mcp/<name> — return server info (VS Code uses POST mostly)
  app.get('/mcp/:name', requireAuth, (req, res) => {
    const name = req.params.name;
    const server = servers[name];
    if (!server) return res.status(404).json({ error: 'server_not_found' });
    res.json({
      name,
      ready: server.ready,
      tools: (server.tools || []).map((t) => t.name),
    });
  });

  return app;
}

// === Main ===
async function main() {
  console.log('VS Code MCP Proxy starting');
  console.log(`Port: ${PORT}, Host: ${HOST}`);
  console.log(`Config: ${CONFIG_PATH}`);

  const servers = {};
  for (const [name, cfg] of Object.entries(config.servers)) {
    const s = new StdioMCPServer(name, cfg.command, cfg.args, cfg.env, cfg.url);
    servers[name] = s;
    try {
      await s.start();
    } catch (e) {
      console.error(`[${name}] failed to start: ${e.message}`);
    }
  }

  const app = makeApp(servers);
  app.listen(PORT, HOST, () => {
    console.log(`Listening on http://${HOST}:${PORT}`);
    console.log('Endpoints:');
    for (const name of Object.keys(servers)) {
      console.log(`  POST http://${HOST}:${PORT}/mcp/${name}  (Bearer required)`);
    }
    console.log(`  GET  http://${HOST}:${PORT}/servers  (list)`);
    console.log(`  GET  http://${HOST}:${PORT}/health  (no auth)`);
  });

  process.on('SIGTERM', () => {
    console.log('SIGTERM, shutting down');
    for (const s of Object.values(servers)) s.stop();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
