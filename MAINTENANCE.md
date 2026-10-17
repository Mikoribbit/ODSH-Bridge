# Maintenance Notes

Operational symptoms, causes and recovery actions. For task ownership, migration and uncertain effects, use [leases](docs/LEASES.md).

## 1. `spawn bash ENOENT` — DSH tool-runner cannot start commands

- **Symptom**: in the DSH Web UI, every bash/node tool call fails immediately
  with `spawn bash ENOENT`; error logs say `spawn failed: Error: spawn bash ENOENT`.
  The container's own shell still works (`docker exec ... sh -c 'echo ok'` succeeds).
- **Cause**: the DSH agent session's *exec runner* lost its binding to the
  container's process namespace (not a missing `bash`: `/bin/bash` exists and is
  healthy).
- **Fix **:
  1. Restart the DSH web process (restart the DSH service through its configured supervisor). If still broken:
  2. **Fork / open a brand-new DSH session** — the fresh session gets a clean
     runner→container channel. A fresh session obtains a new runner binding.
- **Prevention**: keep tool scripts and identity on a persistent shared volume
  (e.g. the bridge) so a session loss does not lose work.

## 2. `device signature invalid` (intermittent, looks random)

- **Symptom**: gateway replies `INVALID_REQUEST / device signature invalid` during
  connect, but only *some* runs fail while others (same keyfile, same token) pass.
- **Cause **: the claim string was signed with
  `String(Date.now())` while `device.signedAt: Date.now()` took a *second* read.
  The two millisecond timestamps differ → the gateway rebuilds the claim from
  `device.signedAt` to verify → signature mismatch; only occasionally passes when
  both reads land in the same millisecond.
- **Fix **: take **one** `const signedAt =
  Date.now()` and use it for both the claim and `device.signedAt`. See current
  `src/gateway-client.mjs` and `docs/PROTOCOL.md §2.3`.

## 3. `origin not allowed` — Control UI / WS connect rejected

- **Symptom**: browser shows "Gateway rejected this page origin" or the WS
  connect returns `CONTROL_UI_ORIGIN_NOT_ALLOWED` /
  `origin not allowed (open the Control UI from the gateway host or allow it in gateway.controlUi.allowedOrigins)`.
- **Cause**: OpenClaw's gateway validates the HTTP `Origin` header against a
  whitelist (`gateway.controlUi.allowedOrigins`); an unlisted origin is dropped
  even when `allowInsecureAuth: true`.
- **Fix **: add the exact origin(s) you connect from to
  `gateway.controlUi.allowedOrigins` in `openclaw.json`:
  ```json
  "allowedOrigins": ["http://localhost:18789", "http://openclaw:18789"]
  ```
  then reload the gateway (hot reload) / restart. In our setup the DNS container
  name origin (`http://openclaw:18789`) is what the DSH tools send.

## 4. Container IP changed after restart → connections fail

- **Symptom**: everything worked, then after a `docker compose down/up` (or plain
  restart) both containers are healthy but DSH→OpenClaw connects are refused /
  destination unreachable.
- **Cause **: Docker may reassign container IPs when container addresses change.
- **Fix **: never address the peer by IP. Use the **docker network DNS
  container name** (`openclaw`), and build the `Origin` from the host dynamically
  (`http://${OC_HOST}:${OC_PORT}`). This is already the default in the published
  tooling. Container start order no longer matters.

## 5. `node:net` ESM has no `Socket.close()`

- **Symptom**: after a clean disconnect a script crashes with
  `Error: sock.close is not a function` (or the socket never closes cleanly).
- **Cause **: the ESM `node:net` `Socket` API exposes
  `destroy()`/`resetAndDestroy()` but **not** `.close()` (older CJS-style code
  uses `.close()`).
- **Fix **: use a `safeClose()` helper that prefers `.close()`, falls
  back to `.destroy()`, then `.resetAndDestroy()`. All close sites in
  `src/gateway-client.mjs` use it.


## Release / version workflow

1. Edit code/docs in the working copy.
2. `npm run check` (syntax-checks all `.mjs`).
3. Update [CHANGELOG.md](CHANGELOG.md) (Keep a Changelog format).
4. Commit, tag: `git tag v1.0.x` and `git push origin v1.0.x`.
5. Keep [README.md](README.md) (EN) and `README.zh.md` (ZH) in structural parity.

## 7. Cross-mount permission mismatch (UID/GID) — WSL2 footgun

- **Symptom**: both containers share the bridge, but one side gets `EACCES` /
  permission-denied when writing into `Input/` or `Output/`, even though the
  other side writes fine.
- **Cause**: on WSL2-hosted docker (or any cross-host mount), if the two
  containers run as **different users** (e.g. one `root`, one `node`/non-root),
  the file ownership/umask written by one side blocks the other.
- **Fix **: align the users explicitly — add `user: "${UID}:${GID}"`
  to **both** services in `docker-compose.snippet.yml`, or once on the host run
  `chmod -R 770 <bridge-host-dir>` after aligning ownership and group membership. Align UID/GID or shared group membership and directory ownership.

## 8. Bridge retention — stale files accumulate

- **Symptom**: `Input/` and `Output/` accumulate old envelopes/results over time.
- **Fix**: run the bundled cleanup tool (`src/bridge-cleanup.mjs`) on a schedule
  (e.g. cron) — it removes auxiliary files older than N days (default 7), retaining task/result JSON, databases, state directories, README and dotfiles:
  ```bash
  node src/bridge-cleanup.mjs --days 7          # real delete
  node src/bridge-cleanup.mjs --days 7 --dry-run # preview
  ```
