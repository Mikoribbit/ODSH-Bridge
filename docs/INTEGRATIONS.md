# Integration Approaches

## 1. Standalone CLI / daemon (recommended deployment)

- Zero build, zero npm dependencies, run `node src/bridge-daemon.mjs` directly; export daemon settings in the process environment.
- **Self-starting daemon (v1.2+)**: the DSH container boots the bridge daemon automatically via
  `scripts/dsh-entrypoint.sh` → `src/dshtrigger.mjs daemon` (a self-healing supervisor that restarts a
  crashed child). No manual `node` invocation is required on a normal boot.
- One tool manages everything: the daemon, send, status, once and purge modes of [dshtrigger](../src/dshtrigger.mjs). `status` also reports live daemon health.
- The underlying watcher is `src/bridge-daemon.mjs` (the same envelope executor) — you can still run it
  directly as `node src/bridge-daemon.mjs --notify --interval-ms 5000` if you manage it yourself.

### B. Mounted into DSH as a Cordis plugin (reference adapter)

- `config/odsh-bridge.ts`: `export function apply(ctx, config)` shape, spawns `bridge-daemon.mjs`
  inside `ctx.effect()`, reclaiming with SIGTERM on unload/hot-reload . `config/cordis.yml` is an `insert:` merge snippet.

---


## Lifecycle and deployment

Both entrypoints require Node >=22.13, the common local SQLite authority and [explicit migration](LEASES.md). Daemon and trigger use process environment. The plugin merges parent environment with config.env; bridgePath overrides the bridge root. It sends SIGTERM on disposal; use the standalone supervisor for crash-restart policy.

Repository Compose mounts source and entrypoint below /opt/odsh-bridge. The scaffold copies helpers into bridge DSH-Workspace/tools and writes Compose in the host bridge directory. Configure image entrypoints and reconcile preserved customized tools. Notifications require explicit ODSH_NOTIFY=1, CLI --notify or plugin notify=true, plus channel and gateway credentials.
