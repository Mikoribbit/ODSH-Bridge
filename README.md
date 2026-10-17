# ODSH-Bridge for Docker — OpenClaw × DeepSeek Harness connectivity bridge (Docker edition)

<div align="center">

[**English**](https://github.com/Mikoribbit/ODSH-Bridge/blob/main/README.md) ·
[**中文**](https://github.com/Mikoribbit/ODSH-Bridge/blob/main/README.zh.md)

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Node](https://img.shields.io/badge/Node-%3E%3D22.13-green.svg)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)
![Platform](https://img.shields.io/badge/platform-Docker%2Fagent--mesh-blue.svg)

</div>

> **One-line positioning**: lets DeepSeek Harness (DSH, the execution layer) reach the OpenClaw (brain/persona layer)
> gateway over WebSocket, hand off tasks reliably between the two containers through a shared directory bridge
> (envelope + daemon), and — since **v1.1** — operate a **real Windows desktop** on the host machine via
> **SSH + [Cua Driver](https://github.com/trycua/cua)** (SSH + Cua Driver execution path).


---

## Navigation

[Quick Start](docs/QUICKSTART.md) · [Configuration](docs/CONFIGURATION.md) · [Operations](docs/OPERATIONS.md) · [Leases and migration](docs/LEASES.md)

---

## 1. Architecture (text version)

```
┌────────────────────────────── agent-mesh (docker network) ────────────────────────────────┐
│                                                                                           │
│   deepseek-harness (DSH)                        openclaw (OpenClaw)                │
│   ├─ oc-invoke.mjs  ──┐                                                                    │
│   ├─ oc-send.mjs   ───┼── WebSocket(:18789) ─────▶ gateway (Device Pairing +          │
│   ├─ oc-client.mjs ───┘   explicit Origin / Ed25519   JSON-RPC-style methods)           │
│   │                      signed pairing / tools.invoke ├─ agents.list / status            │
│   └─ bridge-daemon.mjs                                ├─ doctor.memory.* (dreaming)      │
│         │                                             └─ message (Discord send/recv)      │
│   └─ oc-cua.mjs ─── SSH(:22, ed25519) ──────────────▶ Windows host                     │
│         │                                             └─ Cua Driver (cua-driver serve)    │
│         └── shared bridge mount: Input/ Output/ DSH-Workspace/ Openclaw-Workspace/         │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

There are three data flows:

1. **Realtime channel**: A DSH script connects to the OpenClaw gateway on 18789 as a "paired device"
   (HTTP Upgrade + origin allowlist + Ed25519 signature pairing + `connect.challenge` → `hello-ok`),
   then calls methods in a JSON-RPC style.
2. **Async bridge**: Either side writes a task envelope to `Input/T-*.json` → the daemon watches and
   executes it → atomically writes back `Output/<taskId>_result.json`, optionally notifying a Discord
   channel via `oc-send`.
3. **Windows desktop execution (v1.1+)**: DSH calls `oc-cua.mjs` → `ssh` into the Windows host →
   invokes `cua-driver call <tool> '<json>'` → the driver operates the real desktop (snapshot,
   click/type/hotkey, browser via CDP, app launch) **through the host desktop session**.

---

## 2. Features

- Gateway access with explicit Origin and a persistent Ed25519 identity; permissions are controlled by gateway approval.
- Required shared local SQLite authority: atomic claims, renewal during asynchronous execution, conditional terminal commits and recoverable JSON result projections.
- Echo, notification acknowledgement, trusted commands, bridge-confined file access and status; SSH + Cua Driver for desktop operations.
- Node >=22.13. Stop all old consumers before first initialization or upgrade and follow [lease migration](docs/LEASES.md).
- Shared browsers/desktops require one resource executor or external resource coordination; task leases govern task ownership and result commits.

## 3. Deployment

Requires: **Docker** + two images — OpenClaw (official `openclaw/openclaw:latest`) and DSH
(no public image; build `deepseek-harness:local` from the [DeepSeek Harness repo](https://github.com/deepseek-ai/deepseek-harness)).

Follow [Quick Start](docs/QUICKSTART.md) to configure images, scaffold the bridge, initialize the authority and start containers. Enable notifications explicitly with ODSH_NOTIFY=1.



## Documentation

Choose a guide for your task:

| Page | Covers |
|------|--------|
| [**Quick Start**](docs/QUICKSTART.md) | getting the project, bring up containers, deploy the daemon, optional Cua |
| [**Configuration**](docs/CONFIGURATION.md) | `.env` fields + directory structure |
| [**Integrations**](docs/INTEGRATIONS.md) | standalone daemon vs Cordis plugin |
| [**Operations**](docs/OPERATIONS.md) | Cua Windows desktop, security notes, troubleshooting |
| [**Roadmap**](ROADMAP.md) | phase-gated long-term plan (ClawHub, plugin ecosystem, event bus) |
| [**Protocol**](docs/PROTOCOL.md) | gateway handshake / JSON-RPC details |
| [**Leases**](docs/LEASES.md) | local authority, migration and recovery |
| [**Bridge Spec**](docs/BRIDGE-SPEC.md) | envelope format, state machine, zones |
| [**Maintenance**](MAINTENANCE.md) | maintenance and recovery |

---

## Support

If this project helps you, consider supporting its maintainer:

<a href="https://www.buymeacoffee.com/mikoribbit" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-orange.png" alt="Buy Me A Coffee" height="45" width="auto"></a>

> ☕ [buymeacoffee.com/mikoribbit](https://www.buymeacoffee.com/mikoribbit)

---

## 4. Docs quick index (one-liner)

- **New to ODSH Bridge?** → start with [Quick Start](docs/QUICKSTART.md).
- **Anything about config/paths?** → [Configuration](docs/CONFIGURATION.md).
- **Cua Windows desktop, security, errors?** → [Operations](docs/OPERATIONS.md).

---

## 5. Credits

- **odsh-interop (ClawHub)** — the OpenClaw-side skill is published on
  [ClawHub](https://clawhub.openclaw.com) (package: `odsh-interop`); install with
  `openclaw skills install odsh-interop`.
- **Cua** — this project's Windows desktop execution layer is powered by
  [Cua Driver](https://github.com/trycua/cua) (by the trycua team). Huge thanks for an open, cross-platform,
  focus-safe computer-use driver that lets agents drive desktop apps without stealing the user's cursor.
  The Cua Driver is independently licensed by their authors — see their repository for details.

---

> Maintained by: ODSH Bridge contributors · License: MIT · Node >=22.13 · Zero-dependency ESM
