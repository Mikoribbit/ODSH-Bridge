# ODSH Bridge Directory-Bridge Spec (BRIDGE-SPEC)

Corresponds to `src/bridge-daemon.mjs` and the four-zone bridge at `/root/ODSH-bridge` in a local deployment. Principle: all cross-container collaboration happens via envelopes — machine-readable, retryable, traceable.

## 1. Directory Overview (Four Zones)

```
/root/ODSH-bridge/
├── Input/                 # [SHARED] task entry: T-*.json (envelopes)
├── Output/                # [SHARED] result exit: <taskId>_result.json
├── DSH-Workspace/         # [PRIVATE] DSH-private: identity JWK/drafts/logs (OpenClaw must not modify)
└── Openclaw-Workspace/    # [PRIVATE] OpenClaw-private: memory/summaries/dream-feed (DSH must not modify)
```

Both containers mount it to the same host directory (host path is operator-chosen and mounted to in-container `/root/ODSH-bridge`; see docker-compose.snippet.yml).

## 2. Envelope Format (Input/<taskId>.json)

```json
{
  "schema": "odsh-envelope/v1",
  "taskId": "T-260820-01",
  "type": "execute | query | notify | bridge-status | interop",
  "status": "queued",
  "requester": "dsh | openclaw | human",
  "target": "dsh | openclaw | both",
  "createdMs": 1787249900000,
  "trace_id": "1ac9e2f4-... (optional)",
  "parent_span_id": "f3e18c7b-... (optional, previous hop's span)",
  "span_id": "5c2a0d1e-... (optional, this hop's span)",
  "expiresMs": 1787336000000,
  "payload": { "kind": "echo", "text": "..." },
  "context": { "channel": "<discordChannelId>", "sessionKey": "<agentSessionKey>" },
  "result": null
}
```

Required: `taskId / type / status / requester / target / createdMs / payload`; `expiresMs / context / result / trace_id / span_id / parent_span_id` optional. The trace fields are optional cross-container tracing extensions (see §4.1) and never required for old envelopes.

> ⚠️ **target routing (v1.2.1+)** — the DSH-side daemon (`dshtrigger daemon`) only
> consumes envelopes whose `target` is `dsh`, `both`, or unset. Envelopes with
> `target: openclaw` are left in `Input/` untouched (without a DSH claim) so an
> OpenClaw-side consumer can pick them up — DSH never eats OpenClaw's mail. This
> makes the bridge symmetric: DSH avoids clobbering OpenClaw-bound tasks. An
> `OpenClaw`-side watcher is what consumes those.

## 3. State Machine

```
queued -> running -> done / failed / needs-review
             |
             +-> expired -> needs-review (default)
                        -> running (explicit retrySafe=true)
```

Advancement rules:

- Publish an immutable envelope; SQLite authority records progress and terminal results;
- The reader **must not modify the original Input file**; results go to `Output/<taskId>_result.json`;
- Atomic write: always write `.tmp` first, then `rename` (mv) to the final name, so the peer never reads a half-written file.
- zh: 原子写规则：先写 .tmp 再 rename 成正式名，防止对端读到半截文件。

## 4. Result Files (Output/<taskId>_result.json)

```json
{
  "schema": "odsh-result/v1",
  "taskId": "T-260820-01",
  "status": "done | failed | needs-review | cancelled",
  "finishedMs": 1787249903000,
  "by": "dsh | openclaw",
  "trace": { "trace_id": "...", "span_id": "...", "parent_span_id": null },
  "payload": { "...": "..." },
  "human": "Task T-260820-01 complete",
  "error": null
}
```

`human` is a human-readable summary that can be posted directly to a channel.

### 4.1 Cross-container tracing (optional, 1.3.1+)

The daemon keeps a lightweight trace through each envelope so a call chain can be
reconstructed across containers. Result files carry an extra `trace` object (three
fields, all optional):

- `trace_id` - a `crypto.randomUUID()` minted at the first hop and **passed through**
  unchanged on every later hop (an inbound envelope's `trace_id` is preserved verbatim).
- `span_id` - a fresh UUID generated on **this** hop (this container's span).
- `parent_span_id` - the previous hop's span: the inbound envelope's `parent_span_id`,
  else its `span_id`, else `null`.

Old envelopes lacking these fields remain fully compatible: the daemon synthesizes
`trace_id`/`span_id` and leaves `parent_span_id` null. No required envelope field is
touched, so existing producers are unaffected.
### 4.2 Review and recovery

Malformed envelopes and identity/content conflicts remain in Input for operator review. Handler errors produce failed results; uncertain execution produces needs-review. Authority or projection errors stop the current scan. See [leases](LEASES.md) for migration and recovery.

## 5. Naming & Conflict Avoidance

- Task ids: ASCII T-[A-Za-z0-9_.-]+, unique under ASCII case folding (for example T-260820-01); the daemon uses the **envelope filename basename** as the taskId (`T-*.json`).
- Results: same id + `_result.json`; attachments: `Output/<taskId>_att-<sequence>.<ext>`.
- DSH task ownership and terminal results are authoritative in `Input/.state/leases.db`; `dsh-processed.json` is a recoverable projection, not a lock or independent replay guard (see LEASES.md).

## 6. payload.kind (implemented by the DSH daemon)

| kind | payload fields | output |
|---|---|---|
| echo | `text` or `command` | `{echoed}` |
| notify | `text` / `items` | `{ack:true, from, text}` (recorded and acknowledged) |
| run-command | `command` | `{stdout}` or `{error,stderr}` |
| write-file | `args.{file,content}` | `{written}` |
| read-file | `args.file` | `{content}` (truncated to 4000 chars) |
| bridge-status | — | `{input,output}` file counts |

Operational details (execution behavior):

- `run-command`: fixed executable allowlist and literal argv (no shell), 15 s timeout, stdout truncated at 4000. Trusted producers are still required because allowed interpreters can execute code.
- `write-file / read-file`: relative paths resolve below the bridge root. BRIDGE_ALLOW_ABS_PATHS=true permits absolute syntax only within that root. Real-path checks enforce confinement; write-file protects Input, Output and the authority path.
- Scan interval: `--interval-ms` (default 5000); `--once` for a single pass; already-processed ids are skipped (idempotent).

## 7. Authority and result projection

Node >=22.13 and the common local Input/.state/leases.db are required. Claims are transactional; asynchronous execution renews every TTL/4 and immediately before execution. Renewal and completion require matching owner, token, generation, running state and an unexpired lease. Terminal state and result commit together. Output JSON and dsh-processed.json are rebuilt projections, written with unique temporary filenames under a serialized transaction.

Optional expiresMs is a finite absolute Unix-millisecond deadline checked before claim/execution, distinct from the renewable lease TTL. See [migration, retry safety and recovery](LEASES.md).

## 8. Security

- Four-zone ownership: DSH never enters Openclaw-Workspace, OpenClaw never enters DSH-Workspace; the identity JWK belongs exclusively to DSH-Workspace.
- `run-command` has execution capability: only open to trusted/whitelisted envelope requesters; the executable allowlist is not a sandbox, and production deployments should configure the requester whitelist.
- All files UTF-8 + LF; store credentials in deployment-managed files with restricted access.

---

## 9. Optional SQLite audit side-store (v1.3.1)

An additive, **non-required** auditing layer, separate from the required lease
SQLite authority (daemon requires Node >=22.13). JSON cache/result files are
recoverable projections, not the core authority. When `BRIDGE_SQLITE` is enabled,
the daemon additionally mirrors task rows into
`<BRIDGE>/DSH-Workspace/dsh.db` for queryable history, aggregates and audit.

- **Enable**: `new-bridge.sh` detects `node:sqlite` availability at setup and writes
  `BRIDGE_SQLITE=1` (or 0) into `.env`. You can also set it manually;
  `BRIDGE_SQLITE_DB` overrides the default db path.
- **Degradation**: if `node:sqlite` is unavailable or `BRIDGE_SQLITE=0`, the module
  no-ops and the daemon is completely unaffected (fail-soft, keeps zero-dependency).
- **Schema**: `dsh_envelopes` (one row per task, incl. `trace_id`/`span_id`),
  `dsh_events` (status-change log), `dsh_errors` (failed-task detail), and the
  `dsh_bridge_stats` view for aggregate metrics (total / completed / failed / running /
  first & last created).
- **Security**: the db lives in `DSH-Workspace/` (private zone, like the JWK); it is not
  git-tracked. Same fail-closed posture applies to envelope handling.
