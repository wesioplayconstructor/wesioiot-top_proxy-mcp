import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function buildOutputFile(filename, outputDir, extension) {
  const dir = outputDir || process.env.WESIOIOT_MCP_BASE_PATH || '/tmp';
  const ext = extension || 'mp3';
  const safeName = filename.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(dir, `${safeName}.${ext}`);
}

export function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function removeUndefinedFields(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map(removeUndefinedFields).filter(v => v !== undefined);
  }
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    const cleaned = removeUndefinedFields(v);
    if (cleaned !== undefined) {
      result[k] = cleaned;
    }
  }
  return result;
}
