# Quick Start

## 1. Prerequisites

- **Docker** (Docker Desktop on Windows/macOS, or Docker Engine + compose on Linux; the supplied examples use Compose). ODSH Bridge is a two-container idea:
  OpenClaw (brain / gateway) + DeepSeek Harness (DSH, execution layer) on one docker network.
- **Two images**:
  - OpenClaw — official `openclaw/openclaw:latest` (Docker Hub).
  - DSH — **no public image**; build it from the official repo:
    ```bash
    git clone https://github.com/deepseek-ai/deepseek-harness.git dsh-src && cd dsh-src
    docker build -t deepseek-harness:local .
    ```
- Both containers on the same docker network (this repo's example name `agent-mesh`), each able to
  reach the other by container name.
- OpenClaw gateway allowed origins must include the origin you use (see [docs/PROTOCOL.md](PROTOCOL.md) §2.1).

## 2. Scaffold the bridge — interactive wizard (recommended)

One command walks you through every value with a visual prompt; **press Enter to accept the
bracketed default**, type to override, and answer yes/no prompts.

```bash
cd ODSH-Bridge
chmod +x scripts/new-bridge.sh
./scripts/new-bridge.sh          # interactive wizard
```

You'll be asked, in order:

| Prompt | Default | Notes |
|---|---|---|
| bridge host dir | `C:/ODSH-bridge` | where the four zone folders live on the host |
| container mount path | `/root/ODSH-bridge` | the in-container path both sides agree on |
| OpenClaw service name | `openclaw` | container / service name |
| DSH service name | `deepseek-harness` | container / service name |
| gateway port | `18789` | OpenClaw gateway port |
| OC_TOKEN | placeholder | paste the key from `openclaw.json → gateway.auth.token` |
| Discord channel id | *(none)* | for completion notifications (optional) |
| generate docker-compose.yaml? | `y` | writes a ready-to-run compose into the bridge dir |
| enable Cua Desktop channel? | `n` | optional Windows desktop execution (see §5) |
| SQLite audit store | y when node:sqlite is available | Optional audit; task authority is required separately |
| Windows SSH username | `id -un` | only if Cua enabled |

The wizard copies the four zones (`Input/ Output/ DSH-Workspace/ Openclaw-Workspace/`), writes a
`.env` with `BRIDGE_PATH` pointed at your mount path, and (if chosen) a `docker-compose.yaml`
whose volumes mount `<host-dir>` → `<bind>`. Choose /srv/odsh-bridge for the commands below.

> **Non-interactive one-liner** still works (no prompts; add --no-compose to manage Compose yourself):
> ```bash
> ./scripts/new-bridge.sh /srv/odsh-bridge
> ```

## First initialization and paths

Use Node >=22.13 and a reliable local filesystem with SQLite process locks. All consumers share the same physical authority DB and container mount path. The supported topology is local to one host; SMB/NFS and cross-host sharing are outside that scope.

Commands below assume /srv/odsh-bridge on the host and /root/ODSH-bridge in containers; substitute your Windows host path as needed. The wizard writes .env and docker-compose.yaml in the bridge directory and copies helpers into DSH-Workspace/tools. Rerunning rewrites the environment and generated compose while preserving existing tools; back up configuration and reconcile customized helpers first. Substitute service names too if customized.

Before startup, fill OC_TOKEN and confirm the image provides Node and the entrypoint command pnpm dsh web. For first initialization or migration, stop all consumers and supervisors, back up Input, Output and state together, then temporarily set BRIDGE_LEASE_UPGRADE=all-consumers-stopped in the generated .env. Remove it after initialization and recreate the DSH service. See [lease migration](LEASES.md).

## 3. Bring up the containers

```bash
docker compose -f /srv/odsh-bridge/docker-compose.yaml up -d
```

- The **DSH container auto-starts the bridge daemon** via its `entrypoint` (self-starting, no manual step).
- Verify it is alive:
```bash
docker compose -f /srv/odsh-bridge/docker-compose.yaml exec deepseek-harness node /root/ODSH-bridge/DSH-Workspace/tools/dshtrigger.mjs status        # shows health: { running: true, pid: … }
```

## 4. Pair once + verify

```bash
# Run from the host; approve the device in the OpenClaw Control UI.
docker compose -f /srv/odsh-bridge/docker-compose.yaml exec deepseek-harness node /root/ODSH-bridge/DSH-Workspace/tools/oc-client.mjs connect
#   first run prints "device not approved" → approve that deviceId in the OpenClaw Control UI.
```

The pairing client holds its connection; use another terminal for the task round-trip:

```bash
docker compose -f /srv/odsh-bridge/docker-compose.yaml exec deepseek-harness node /root/ODSH-bridge/DSH-Workspace/tools/dshtrigger.mjs send --to dsh --kind echo --text "hello"     # drop an envelope, get a result
```

## 5. Optional — Windows desktop execution (Cua Driver)

> Full guide: [docs/CUA-EXECUTION.md](CUA-EXECUTION.md). Fastest path — two idempotent one-shot scripts:

```powershell
.\scripts\setup-windows.ps1 -BridgePath C:\ODSH-bridge
```
Run the following from the source checkout inside the DSH container (mount or copy the checkout first).

```bash
./scripts/setup-dsh.sh --bridge /root/ODSH-bridge --host host.docker.internal
```

Each script detects what is already set up and skips it; they write `windows-connect.json` /
`.env` for each other, and the DSH side ends with a live `get_screen_size` verification.

## 6. Next

- **Config / `.env` fields / directory**: [docs/CONFIGURATION.md](CONFIGURATION.md)
- **Standalone vs Cordis-plugin**: [docs/INTEGRATIONS.md](INTEGRATIONS.md)
- **Real ops, security, troubleshooting**: [docs/OPERATIONS.md](OPERATIONS.md)
