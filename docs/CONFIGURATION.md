# Configuration & Directory Structure

## Directory structure

```
plugin-release/
├── README.md                  English overview
├── README.zh.md               Chinese version
├── AUTHORS.md                 Maintainer / contributors
├── CHANGELOG.md               Version history (Keep a Changelog)
├── MAINTENANCE.md             Troubleshooting and recovery
├── docs/
│   ├── PROTOCOL.md            Gateway handshake / frames / methods / errors / idempotency
│   ├── BRIDGE-SPEC.md         Bridge four zones / envelope schema / state machine / atomic write
│   └── CUA-EXECUTION.md       Windows desktop execution via Cua Driver (install/authorize/use)
├── skills/
│   └── odsh-interop/          OpenClaw-side skill (SKILL.md + install README)
├── src/
│   ├── env.mjs                .env loader
│   ├── gateway-client.mjs     Shared WS/Ed25519 pairing client
│   ├── oc-invoke.mjs          Invoke any gateway method
│   ├── oc-send.mjs            Send a message via gateway
│   ├── oc-client.mjs          Pairing wait / long-lived client
│   ├── oc-cua.mjs             (v1.1) SSH + Cua Driver desktop execution
│   ├── bridge-daemon.mjs      Envelope watcher/executor
│   └── bridge-cleanup.mjs     Retention cleanup tool
├── scripts/                   One-shot idempotent setup
│   ├── setup-windows.ps1      Windows host: Cua Driver + OpenSSH + firewall + key + connect json
│   └── setup-dsh.sh           DSH container: ssh client + key + .env + verify get_screen_size
├── config/                    Cordis plugin form (reference adapter)
├── docker-compose.yml         Runnable compose template (OpenClaw official image + DSH build/image)
├── bridge-template/           Copy-ready directory bridge: Input/ Output/ DSH-Workspace/ Openclaw-Workspace/
├── .env.example               Env template (environment configuration)
└── LICENSE  ·  package.json  ·  docker-compose.snippet.yml (legacy snippet)
```

---


## Runtime and environment behavior

Use Node >=22.13 (CI: 22.13 and 24). Environment files support comments outside quotes, preserve quoted # characters, and keep exported variables authoritative. Non-finite numeric gateway settings fall back to defaults; explicit invalid port/timeouts are rejected.

The DSH consumer accepts target dsh, both, or an omitted target; all other destinations remain untouched. Optional expiresMs must be a finite number (absolute Unix milliseconds): expired/invalid tasks fail before execution; omission keeps legacy behavior. This deadline is not the renewable ownership lease TTL. Unknown payload kinds fail. File paths use platform-aware confinement and real-path checks, including existing file links and missing ancestors.

Notifications stay disabled by default. Set ODSH_NOTIFY=1 explicitly, plus DISCORD_CHANNEL_ID and OC_TOKEN. The sender accepts only --action send or read; callers use text --channel ID. Trigger wait timeout exits nonzero but never cancels or removes work. Cua --version is an exact exception, not a relaxation of tool-name injection checks.

Compose mounts scripts as well as src and loads env_file. Generated bridges copy missing runtime helpers without overwriting customized tools; reconcile preserved old helpers before startup. Stop all old consumers and follow LEASES.md before first migration; the scaffold never auto-authorizes migration. Configure the image Node version, filesystem permissions and pnpm dsh web command for your deployment.

## Configuration entrypoints and timeouts

Gateway/Cua CLIs read .env from the working directory or OC_ENV_FILE. Exported variables take priority. Unquoted # starts a comment; quoted # is preserved. Daemon and trigger receive process environment directly; Compose injects env_file.

| Setting | Default | Scope |
|---|---|---|
| BRIDGE_PATH | /root/ODSH-bridge | Shared bridge root |
| BRIDGE_LEASE_DB | Input/.state/leases.db below bridge | Required common local authority |
| BRIDGE_LEASE_MS | 30000 | Lease TTL, 300..3600000 ms |
| BRIDGE_LEASE_UPGRADE | unset | all-consumers-stopped for explicit first initialization |
| BRIDGE_ALLOW_REQUESTERS | empty | Comma-separated trusted requesters; empty accepts all |
| BRIDGE_SQLITE / BRIDGE_SQLITE_DB | optional | Separate audit DB; see [leases](LEASES.md) |
| OC_HOST / OC_PORT | openclaw / 18789 | Gateway endpoint |
| OC_TOKEN | required for gateway | gateway.auth.token |
| OC_ORIGIN | http://host:port | Gateway origin allowlist |
| OC_KEYS | DSH-Workspace/openclaw-device.json below bridge | Persistent identity |
| OC_CONNECT_TIMEOUT_MS | 45000 | Gateway connection wait |
| OC_REPLY_TIMEOUT_MS | 20000 | Gateway request wait |
| OC_RETRY_MS | 8000 | Long-lived client reconnect interval |
| ODSH_INTERVAL_MS | 2000 | Entrypoint interval; direct daemon --interval-ms default 5000 |
| ODSH_NOTIFY | 0 | Set exactly 1 for entrypoint notifications |
| DISCORD_CHANNEL_ID | empty | Notification destination |
| CUA_TIMEOUT_MS | 60000 | SSH/Cua invocation wait |
| BRIDGE_ALLOW_ABS_PATHS | false | Absolute syntax remains confined to bridge root |
| OC_SEND_SCRIPT | sibling oc-send.mjs | Notification sender path |
| OC_NODE_SCRIPT | sibling oc-cua.mjs | Compatibility desktop-envelope runner |
| CUA_SSH_USER | required for Cua | Windows SSH account |
| CUA_SSH_HOST | host.docker.internal | Reachable Windows host |
| CUA_SSH_PORT | 22 | SSH port |
| CUA_SSH_KEY | /root/.ssh/id_ed25519 | Private key path |
| CUA_BIN | user-local Cua installation | Set actual Windows executable path |


run-command has a fixed 15000 ms timeout; compatibility desktop envelopes use a fixed 60000 ms child timeout and notifications 25000 ms. BRIDGE_RUN_TIMEOUT_MS and BRIDGE_INTERVAL_MS do not control these behaviors. trigger send defaults to --timeout 60000 and target openclaw; use --to dsh for a DSH echo. Waiting timeout exits nonzero and leaves the task in place.
