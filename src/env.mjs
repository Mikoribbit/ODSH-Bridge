#!/usr/bin/env node
// env.mjs — zero-dependency .env loader (a plumbing helper added for the release, not handshake logic).
// Rules:
//   - Reads .env from the current working directory by default; override the path with OC_ENV_FILE;
//   - Already-set process environment variables take priority (variables exported in the shell are not overridden by .env);
//   - Supports comments outside quotes and single-line quoted values; no multi-line values.
import { existsSync, readFileSync } from 'node:fs';

export function loadEnvFile(file = process.env.OC_ENV_FILE || '.env') {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0];
      let end = 1;
      while (end < value.length) {
        if (quote === '"' && value[end] === '\\') { end += 2; continue; }
        if (value[end] === quote) break;
        end++;
      }
      if (end >= value.length || !/^\s*(?:#.*)?$/.test(value.slice(end + 1))) throw new Error('invalid quoted environment value: ' + key);
      value = value.slice(1, end);
      if (quote === '"') value = value.replace(/\\([\\"nr])/g, (_, c) => c === 'n' ? '\n' : c === 'r' ? '\r' : c);
    } else value = value.split('#', 1)[0].trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

// Read an environment variable; an empty string is treated as unset (falls back to the default).
export function envStr(name, def = '') {
  const v = process.env[name];
  return v === undefined || v === '' ? def : v;
}

export function envInt(name, def) {
  const v = envStr(name, '');
  if (!v) return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}