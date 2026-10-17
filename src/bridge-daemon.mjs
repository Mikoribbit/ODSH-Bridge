#!/usr/bin/env node
// ODSH Bridge Daemon (C-1) — DSH side persistent watcher.
// Watches Input/ for new T-*.json envelopes, executes supported kinds,
// writes Output/<taskId>_result.json, optionally notifies the Discord channel.
// Usage: node dsh_bridge.mjs [--once] [--interval-ms N] [--notify]
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, realpathSync, lstatSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, basename, dirname, resolve, isAbsolute, relative, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { openLeaseStore, TaskConflictError, envelopeDeadlineError } from './lease-store.mjs';
const execAsync = promisify(execFile);
const owner = randomUUID();
let authority;
import { initSqlite, recordEnvelope } from './sqlite-store.mjs';

const BRIDGE = process.env.BRIDGE_PATH || '/root/ODSH-bridge';
// SECURITY: read-file/write-file honor this flag. Default false => ONLY relative paths below BRIDGE;
// absolute paths and any path escaping BRIDGE are rejected (prevents .env / JWK / authorized_keys exfiltration).
const ALLOW_ABS_PATHS = process.env.BRIDGE_ALLOW_ABS_PATHS === 'true';
// requester allowlist (F-4): leave empty to accept anyone; set e.g. 'openclaw,dsh' to restrict.
const ALLOW_REQUESTERS = (process.env.BRIDGE_ALLOW_REQUESTERS || '').split(',').map(s => s.trim()).filter(Boolean);
const INPUT = join(BRIDGE, 'Input');
const OUTPUT = join(BRIDGE, 'Output');
const STATE = join(INPUT, '.state');
const NOTIFY = process.argv.includes('--notify');
const ONCE = process.argv.includes('--once');
const idxi = process.argv.indexOf('--interval-ms');
const INTERVAL_MS = Number(idxi >= 0 ? process.argv[idxi + 1] : 5000) || 5000;
const CHANNEL = process.env.DISCORD_CHANNEL_ID || ''; // override via .env; if empty, notifications are skipped
const SEND_SCRIPT = process.env.OC_SEND_SCRIPT || fileURLToPath(new URL('./oc-send.mjs', import.meta.url));
// Back-compat: routes commands to a paired node via gateway node.invoke.
// This is NOT the recommended desktop path anymore — use docs/CUA-EXECUTION.md
// (oc-cua.mjs over SSH + Cua Driver). Kept for envelopes that still target it.
const NODE_SCRIPT = process.env.OC_NODE_SCRIPT || fileURLToPath(new URL('./oc-cua.mjs', import.meta.url));

mkdirSync(STATE, { recursive: true });

function log(...a) { console.log(new Date().toISOString(), ...a); }


// Trace linkage (cross-container): pass through an inbound trace_id, else mint a
// fresh one. span_id is always a fresh UUID for this hop; parent_span_id records
// the previous hop's span (the inbound envelope's parent_span_id, else its span_id,
// else null). Old envelopes without any trace fields stay fully compatible.
function resolveTrace(task) {
  const trace_id = (typeof task.trace_id === 'string' && task.trace_id) || randomUUID();
  const parent_span_id = (typeof task.parent_span_id === 'string' && task.parent_span_id)
    || (typeof task.span_id === 'string' && task.span_id) || null;
  const span_id = randomUUID();
  return { trace_id, span_id, parent_span_id };
}

function envelopeCandidates() {
  return readdirSync(INPUT).filter(f => /^T-.*\.json$/.test(f));
}

// Restricted executor for supported payload kinds (DSH local execution)
// Resolve a file path safely: relative paths are confined under BRIDGE; absolute paths only when
// ALLOW_ABS_PATHS=true (and even then must not traverse with '..'). Rejects anything escaping BRIDGE.
function resolveTarget(file, mode) {
  const rawPath = String(file||'');
  if (!rawPath || rawPath.includes('\0')) return { error: 'invalid path' };
  const rel = !isAbsolute(rawPath);
  if (rel && rawPath.split(/[\\/]/).includes('..')) return { error: 'path traversal not allowed: ' + rawPath };
  const candidate = rel ? join(BRIDGE, rawPath) : (ALLOW_ABS_PATHS ? rawPath : null);
  if (!candidate) return { error: 'absolute path not allowed (set BRIDGE_ALLOW_ABS_PATHS=true to enable) - path: ' + rawPath };
  try {
    const bridgeRp = realpathSync(BRIDGE);
    const inside = p => { const r = relative(bridgeRp, p); return r !== '..' && !r.startsWith('..' + sep) && !isAbsolute(r); };
    if (!inside(resolve(candidate))) return { error: 'path escapes bridge: ' + rawPath };
    // Resolve the file itself as well as ancestors: existing file symlinks must not escape.
    let ancestor = resolve(candidate);
    while (!lstatSync(ancestor, { throwIfNoEntry: false })) {
      const parent = dirname(ancestor);
      if (parent === ancestor) throw new Error('missing ancestor');
      ancestor = parent;
    }
    if (!inside(realpathSync(ancestor))) return { error: 'path escapes bridge: ' + rawPath };
    if (mode === 'read' && !existsSync(candidate)) return { error: 'not found: ' + rawPath };
  } catch (e) { return { error: 'cannot resolve path: ' + rawPath }; }
  return { path: candidate };
}

async function executePayload(task, signal) {
  const p = task.payload || {};
  const kind = p.kind || 'echo';
  switch (kind) {
    case 'echo':
      return { echoed: p.text ?? p.command ?? null };
    case 'notify':
      // ack/notification envelope (e.g. the peer confirming something) — record and acknowledge
      return {
        ack: true,
        from: task.requester || 'unknown',
        text: typeof p.text === 'string' ? p.text.slice(0, 2000) : (p.items ? 'items:' + p.items.length : null)
      };
    case 'run-command': {
      // SECURITY (v1.1.0 hardening): no /bin/sh -c. Only a fixed argv allowlist is executed.
      // Command strings are split on whitespace; the tool must be in the allowlist below,
      // and every arg is passed as a literal argv element (no shell interpretation).
      const ALLOWED_BINS = {
        node: 'node',
        python3: 'python3',
        git: 'git',
        ls: '/bin/ls',
        cat: '/bin/cat',
        echo: '/bin/echo',
        date: '/bin/date',
        pwd: '/bin/pwd',
        wc: '/usr/bin/wc',
        grep: '/usr/bin/grep',
        wget: '/usr/bin/wget',
        curl: '/usr/bin/curl',
      };
      const tokens = String(p.command || '').trim().split(/\s+/).filter(Boolean).slice(0, 64);
      if (!tokens.length) return { error: 'empty command' };
      const binKey = tokens[0];
      const binPath = ALLOWED_BINS[binKey];
      if (!binPath) return { error: 'command not allowed: ' + binKey };
      try {
        const { stdout } = await execAsync(binPath, tokens.slice(1), { timeout: 15000, encoding: 'utf8', signal });
        const out = stdout.slice(0, 4000);
        return { stdout: out };
      } catch (e) {
        return { error: e.message, uncertain: true, stderr: String(e.stderr || '').slice(0, 2000) };
      }
    }
    // run-command is only for trusted envelope sources; its first-word charset check (rejects ;, &, |, and backtick) refuses unsafe commands
    // 中文：run-command 仅限可信信封来源；首词字符集校验（禁 ; & | 反引号）拒绝不安全的命令。
    case 'write-file': {
      const { file, content } = p.args || {};
      if (!file) return { error: 'no file' };
      const dest = resolveTarget(file, 'write');
      if (dest.error) return { error: dest.error };
      const normalized = resolve(dest.path).replaceAll('\\', '/').toLowerCase();
      const protectedPaths = [INPUT, OUTPUT, process.env.BRIDGE_LEASE_DB || join(STATE, 'leases.db')];
      if (protectedPaths.some(p => { const n = resolve(p).replaceAll('\\', '/').toLowerCase(); return normalized === n || normalized.startsWith(n + '/'); })) return { error: 'bridge coordination paths are protected' };
      mkdirSync(dirname(dest.path), { recursive: true });
      writeFileSync(dest.path, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
      return { written: dest.path };
    }
    case 'read-file': {
      const { file } = p.args || {};
      if (!file) return { error: 'no file' };
      const src = resolveTarget(file, 'read');
      if (src.error) return { error: src.error };
      if (!existsSync(src.path)) return { error: 'not found: ' + src.path };
      return { content: readFileSync(src.path, 'utf8').slice(0, 4000) };
    }
    // Back-compat node envelope: kept so old envelopes still route, but the desktop execution
    // path is now docs/CUA-EXECUTION.md (oc-cua.mjs over SSH + Cua Driver).
    // Envelope: payload.kind = "run-node" | "windows-node"; payload.args = { nodeId?, command, params? }
    case 'run-node':
    case 'windows-node': {
      const { command = '', params = {} } = p.args || {};
      const cmd = String(command).trim();
      if (!cmd) return { error: 'no node command' };
      try {
        const { stdout: out } = await execAsync(process.execPath, [NODE_SCRIPT, cmd, JSON.stringify(params)], {
          timeout: 60000, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, signal,
        });
        return { node: 'cua', command: cmd, reply: out.slice(0, 3000) };
      } catch (e) {
        return {
          error: e.message, uncertain: true,
          stderr: String(e.stderr || '') + String(e.stdout || '').slice(0, 2000)
        };
      }
    }
    case 'bridge-status':
      return { input: envelopeCandidates().length, output: readdirSync(OUTPUT).length };
    default:
      return { error: 'unsupported payload kind: ' + kind, unsupportedKind: kind };
  }
}

async function notifyChannel(text) {
  if (!NOTIFY || !CHANNEL || !existsSync(SEND_SCRIPT)) {
    if (NOTIFY && !CHANNEL) log('notify skipped: DISCORD_CHANNEL_ID not set');
    return false;
  }
  try {
    const { stdout: out } = await execAsync(process.execPath, [SEND_SCRIPT, text, '--channel', CHANNEL], { timeout: 25000, encoding: 'utf8' });
    log('notify ok', out.slice(0, 200));
    return true;
  } catch (e) { log('notify failed', e.message.slice(0, 200)); return false; }
}

let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try { await innerTick(); }
  catch (e) { log('authority/scan failure; execution closed:', e.message); process.exitCode = 1; }
  finally { ticking = false; }
}
async function innerTick() {
  authority.project();
  for (const f of envelopeCandidates()) {
    const taskId = basename(f, '.json');
    let task;
    try { task = JSON.parse(readFileSync(join(INPUT, f), 'utf8')); }
    catch (e) { log('invalid envelope retained for review', f, e.message); continue; }
    // Missing target is the legacy DSH default; both includes this DSH consumer.
    // Other destinations (including reserved windows-node) stay untouched.
    if (task?.target !== undefined && !['dsh', 'both'].includes(task.target)) continue;
    let lease;
    try { lease = authority.claim(taskId, task, owner); }
    catch (e) {
      if (!(e instanceof TaskConflictError)) throw e;
      log('task conflict retained for review', f, e.message);
      continue;
    }
    if (!lease) { authority.project(); continue; }
    let lost = false, renewalError;
    const controller = new AbortController();
    const renew = () => {
      try { if (!authority.renew(lease)) lost = true; }
      catch (e) { lost = true; renewalError = e; log('renew failed; no completion permitted', taskId, e.message); }
      if (lost) controller.abort(); // best effort only: remote work/descendants may continue
    };
    // Refresh immediately before starting work, not merely when scanning/claiming.
    renew();
    if (renewalError) throw renewalError;
    if (lost) continue;
    const timer = setInterval(renew, Math.max(50, Math.floor(authority.ttl / 4)));
    const trace = resolveTrace(task);
    let r;
    try {
      if (ALLOW_REQUESTERS.length && !ALLOW_REQUESTERS.includes(task.requester)) r = { error: 'requester not allowed' };
      else if (envelopeDeadlineError(task)) r = { error: envelopeDeadlineError(task) };
      else r = await executePayload(task, controller.signal);
    } catch (e) { r = { error: e.message, uncertain: true }; }
    finally { clearInterval(timer); }
    if (renewalError) throw renewalError;
    if (lost) { log('lost lease; discard result', taskId); continue; }
    const status = r.uncertain ? 'needs-review' : r.error ? 'failed' : 'done';
    const result = { schema: 'odsh-result/v1', taskId, status, finishedMs: Date.now(), by: 'dsh',
      trace, payload: r.error ? { error: r.error } : r,
      human: r.error ? `task ${taskId} ${status}: ${r.error}` : `task ${taskId} done`,
      error: r.error ? { code: r.uncertain ? 'uncertain' : 'exec_failed', message: r.error } : null };
    if (!authority.complete(lease, result)) { log('stale completion rejected', taskId); continue; }
    authority.project();
    recordEnvelope(task, result, trace);
    await notifyChannel(result.human);
    log('done', taskId, status);
  }
}
try {
  authority = openLeaseStore({ bridge: BRIDGE, dbPath: process.env.BRIDGE_LEASE_DB });
  if (process.env.BRIDGE_SQLITE_DB && resolve(process.env.BRIDGE_SQLITE_DB) === resolve(process.env.BRIDGE_LEASE_DB || join(STATE, 'leases.db'))) throw new Error('audit DB must differ from authority DB');
  await initSqlite(process.env.BRIDGE_SQLITE_DB);
  await tick();
  if (!ONCE) setInterval(() => { void tick(); }, INTERVAL_MS);
  else authority.close();
} catch (e) { log('authority unavailable; refusing execution:', e.message); process.exitCode = 1; }