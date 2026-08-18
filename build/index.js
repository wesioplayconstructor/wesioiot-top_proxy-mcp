#!/usr/bin/env node
import { WesioiotMCPServer } from './mcp-server.js';

const server = new WesioiotMCPServer();
server.start().catch(err => {
  console.error('wesioiot-mcp fatal:', err.message);
  process.exit(1);
});
