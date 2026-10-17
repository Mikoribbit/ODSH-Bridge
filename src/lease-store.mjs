// Required authority, deliberately independent of optional sqlite-store auditing.
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

// Envelope deadline is independent of ownership lease TTL. Omission preserves legacy inputs.
export function envelopeDeadlineError(task, now = Date.now()) {
  if (task.expiresMs === undefined) return null;
  if (typeof task.expiresMs !== 'number' || !Number.isFinite(task.expiresMs)) return 'invalid envelope expiresMs';
  return task.expiresMs <= now ? 'envelope expired before execution' : null;
}
const PROTOCOL = 'odsh-lease/v1';
// Only these explicit input conflicts may be isolated by the scanner. SQLite errors are not conflicts.
export class TaskConflictError extends Error {}
const terminal = status => status !== 'running';
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const fingerprint = task => createHash('sha256').update(JSON.stringify(canonical(task))).digest('hex');
function review(id, reason) {
  return { schema: 'odsh-result/v1', taskId: id, status: 'needs-review', finishedMs: Date.now(), by: 'dsh', payload: { error: reason }, human: `task ${id} needs review: ${reason}`, error: { code: 'uncertain', message: reason } };
}
function atomic(file, value) {
  const tmp = file + '.' + randomUUID() + '.tmp';
  writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
  renameSync(tmp, file);
}
export function openLeaseStore({ bridge, dbPath = join(bridge, 'Input/.state/leases.db'), upgrade = process.env.BRIDGE_LEASE_UPGRADE, ttl = Number(process.env.BRIDGE_LEASE_MS || 30000) }) {
  if (!Number.isFinite(ttl) || ttl < 300 || ttl > 3600000) throw new Error('invalid lease TTL (300..3600000ms)');
  const stateDir = join(bridge, 'Input/.state'), output = join(bridge, 'Output');
  mkdirSync(stateDir, { recursive: true }); mkdirSync(output, { recursive: true });
  const marker = join(stateDir, 'lease-protocol.json');
  dbPath = resolve(dbPath);
  if (dbPath.startsWith('\\\\') || dbPath.startsWith('//')) throw new Error('network SQLite unsupported');
  // The marker binds an Input namespace to a single authority. Never silently recreate a lost DB.
  if (existsSync(marker) && !existsSync(dbPath)) throw new Error('authority DB missing; restore backup, do not recreate');
  if (!existsSync(marker) && upgrade !== 'all-consumers-stopped') throw new Error('stop ALL old consumers; set BRIDGE_LEASE_UPGRADE=all-consumers-stopped for migration');
  // Keep all authority files/sidecars in the protected state namespace.
  if (resolve(dirname(dbPath)) !== resolve(stateDir)) throw new Error('lease DB must be directly inside Input/.state');
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA busy_timeout=100; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;');
  const tx = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  const get = id => db.prepare('SELECT * FROM lease_tasks WHERE taskId=?').get(id);
  const clock = () => db.prepare("SELECT CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AS ms").get().ms;
  try {
    tx(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS lease_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS lease_tasks (taskId TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, status TEXT NOT NULL,
        owner TEXT, token TEXT, generation INTEGER NOT NULL DEFAULT 0, expiry INTEGER NOT NULL DEFAULT 0,
        retrySafe INTEGER NOT NULL DEFAULT 0, result TEXT);`);
      let meta = db.prepare("SELECT value FROM lease_meta WHERE key='identity'").get();
      if (!meta) {
        if (existsSync(marker)) throw new Error('authority identity absent');
        meta = { value: randomUUID() };
        db.prepare("INSERT INTO lease_meta VALUES ('identity',?)").run(meta.value);
        db.prepare("INSERT INTO lease_meta VALUES ('protocol',?)").run(PROTOCOL);
        // Conservative migration: never execute legacy processed/results without explicit reconciliation.
        const cachePath = join(stateDir, 'dsh-processed.json');
        const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')).processed : {};
        if (!cache || typeof cache !== 'object' || Array.isArray(cache)) throw new Error('legacy cache unreadable');
        const ids = new Set([...Object.keys(cache), ...readdirSync(output).filter(f => /^T-.*_result\.json$/.test(f)).map(f => f.slice(0, -12))]);
        for (const id of ids) {
          if (!/^T-[A-Za-z0-9_.-]+$/.test(id)) throw new Error('invalid legacy identity');
          const input = join(bridge, 'Input', id + '.json'), resultPath = join(output, id + '_result.json');
          let hash = 'legacy-unknown', r = review(id, 'legacy processed without verifiable result');
          if (existsSync(input)) { const t = JSON.parse(readFileSync(input, 'utf8')); hash = fingerprint(t); }
          if (existsSync(resultPath)) {
            const old = JSON.parse(readFileSync(resultPath, 'utf8'));
            if (old.taskId === id && ['done', 'failed', 'cancelled', 'needs-review'].includes(old.status) && (!cache[id] || cache[id] === old.status)) r = old;
            else r = review(id, 'legacy result/cache conflict');
          }
          db.prepare('INSERT INTO lease_tasks(taskId,fingerprint,status,result) VALUES (?,?,?,?)').run(id, hash, r.status, JSON.stringify(r));
        }
      }
      if (db.prepare("SELECT value FROM lease_meta WHERE key='protocol'").get()?.value !== PROTOCOL) throw new Error('incompatible lease protocol');
      // ASCII-only protocol IDs share one case-insensitive result namespace on EVERY platform.
      // Upgrade in the same write transaction, before any projection or execution. Never pick a winner.
      const ids = db.prepare('SELECT taskId FROM lease_tasks').all();
      if (ids.some(row => !/^T-[A-Za-z0-9_.-]+$/.test(row.taskId))) throw new Error('invalid authority identity; reconcile before migration');
      const aliases = db.prepare('SELECT lower(taskId) AS identity FROM lease_tasks GROUP BY taskId COLLATE NOCASE HAVING count(*)>1').all();
      if (aliases.length) throw new Error('result identity migration conflict; stop all consumers and reconcile aliases: ' + aliases.map(row => row.identity).join(', '));
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS lease_result_identity ON lease_tasks(taskId COLLATE NOCASE)');
      const identity = { protocol: PROTOCOL, identity: meta.value, dbPath: realpathSync(dbPath) };
      if (existsSync(marker)) {
        const old = JSON.parse(readFileSync(marker, 'utf8'));
        if (JSON.stringify(old) !== JSON.stringify(identity)) throw new Error('Input namespace bound to a different authority');
      } else atomic(marker, identity);
    });
  } catch (e) { db.close(); throw e; }
  const fenced = lease => db.prepare("SELECT * FROM lease_tasks WHERE taskId=? AND owner=? AND token=? AND generation=? AND status='running' AND expiry>?").get(lease.taskId, lease.owner, lease.token, lease.generation, clock());
  return {
    ttl,
    claim(id, task, owner) {
      if (!task || typeof task !== 'object' || Array.isArray(task) || !/^T-[A-Za-z0-9_.-]+$/.test(id) || (task.taskId !== undefined && task.taskId !== id) || (task.id !== undefined && task.id !== id)) throw new TaskConflictError('task identity conflicts with filename');
      return tx(() => {
        const alias = db.prepare('SELECT taskId FROM lease_tasks WHERE taskId=? COLLATE NOCASE').get(id);
        if (alias && alias.taskId !== id) throw new TaskConflictError('result identity alias: ' + id + ' conflicts with ' + alias.taskId);
        const hash = fingerprint(task); let row = get(id); const now = clock();
        if (row && row.fingerprint !== hash) throw new TaskConflictError('task content/identity conflict: ' + id);
        if (row && terminal(row.status)) return null;
        if (row && row.expiry > now) return null;
        if ((row && !row.retrySafe) || (!row && task.status === 'running')) {
          const r = review(id, row ? 'expired execution; effects unknown (timeout is not cancellation)' : 'legacy running has unknown holder');
          if (row) db.prepare('UPDATE lease_tasks SET status=?,result=? WHERE taskId=?').run(r.status, JSON.stringify(r), id);
          else db.prepare('INSERT INTO lease_tasks(taskId,fingerprint,status,result) VALUES (?,?,?,?)').run(id, hash, r.status, JSON.stringify(r));
          return null;
        }
        if (!['queued', undefined].includes(task.status)) {
          const r = review(id, 'legacy terminal input needs reconciliation');
          db.prepare('INSERT INTO lease_tasks(taskId,fingerprint,status,result) VALUES (?,?,?,?)').run(id, hash, r.status, JSON.stringify(r)); return null;
        }
        const deadlineError = envelopeDeadlineError(task, now);
        if (deadlineError) {
          const r = { schema: 'odsh-result/v1', taskId: id, status: 'failed', finishedMs: now, by: 'dsh', payload: { error: deadlineError }, human: `task ${id} failed: ${deadlineError}`, error: { code: 'envelope_deadline', message: deadlineError } };
          db.prepare(`INSERT INTO lease_tasks(taskId,fingerprint,status,result) VALUES (?,?,'failed',?)
            ON CONFLICT(taskId) DO UPDATE SET status='failed',result=excluded.result`).run(id, hash, JSON.stringify(r));
          return null;
        }
        const lease = { taskId: id, owner, token: randomUUID(), generation: (row?.generation || 0) + 1, expiry: now + ttl };
        db.prepare(`INSERT INTO lease_tasks(taskId,fingerprint,status,owner,token,generation,expiry,retrySafe) VALUES (?,?,'running',?,?,?,?,?)
          ON CONFLICT(taskId) DO UPDATE SET status='running',owner=excluded.owner,token=excluded.token,generation=excluded.generation,expiry=excluded.expiry`).run(id, hash, owner, lease.token, lease.generation, lease.expiry, task.retrySafe === true ? 1 : 0);
        return lease;
      });
    },
    renew(lease) { return tx(() => {
      if (!fenced(lease)) return false;
      lease.expiry = clock() + ttl;
      db.prepare('UPDATE lease_tasks SET expiry=? WHERE taskId=?').run(lease.expiry, lease.taskId); return true;
    }); },
    complete(lease, result) { return tx(() => {
      if (!fenced(lease)) return false;
      if (result.taskId !== lease.taskId || !['done', 'failed', 'needs-review', 'cancelled'].includes(result.status)) throw new Error('invalid completion');
      db.prepare('UPDATE lease_tasks SET status=?,result=? WHERE taskId=?').run(result.status, JSON.stringify(result), lease.taskId); return true;
    }); },
    // Serialize the entire projection with commits. Never check token then rename outside a transaction.
    project() { return tx(() => {
      const processed = {};
      for (const row of db.prepare("SELECT * FROM lease_tasks WHERE status!='running'").all()) {
        if (row.result) atomic(join(output, row.taskId + '_result.json'), JSON.parse(row.result));
        processed[row.taskId] = row.status;
      }
      atomic(join(stateDir, 'dsh-processed.json'), { protocol: PROTOCOL, processed });
    }); },
    close() { db.close(); }
  };
}
