# ODSH Bridge Communication Protocol (PROTOCOL)

Describes gateway connection, pairing, frames and retries. Task coordination is documented in [leases](LEASES.md).

## 1. Topology & Addressing

```
agent-mesh (docker network)
  deepseek-harness (DSH)                  openclaw (OpenClaw)
  ├ oc-invoke.mjs                         ├ gateway :18789
  ├ oc-send.mjs   ──WebSocket──▶          ├ device pairing (Ed25519 fingerprint)
  ├ oc-client.mjs    (explicit Origin)     └ JSON-RPC-style methods (agents.list, etc.)
  └ bridge-daemon.mjs
         shared bridge mounts: Input/ Output/ DSH-Workspace/ Openclaw-Workspace/
```

- Address by container-name DNS (default `OC_HOST=openclaw`); do not hardcode container IPs. Docker may reassign addresses after restart; container DNS follows the service name.
- Origin is built dynamically: `http://${OC_HOST}:${OC_PORT}`, never a fixed IP.

## 2. Connection Establishment (Pairing Handshake)

### 2.1 HTTP Upgrade (with explicit Origin)

```
GET / HTTP/1.1
Host: openclaw:18789
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: <16 random bytes base64>
Sec-WebSocket-Version: 13
Sec-WebSocket-Protocol: json
Origin: http://openclaw:18789
```

Gateway configuration must allow the exact Origin in use. Back up and edit gateway.controlUi.allowedOrigins, then restart the gateway. Use manual per-device approval and an isolated network: this client uses plain TCP WebSocket, so credentials travel in plaintext on that network. TLS protection requires a deployment-level tunnel or proxy arrangement compatible with this client.

### 2.2 Keys & Fingerprint

- Ed25519 keypair stored as a JWK file: `{version:1, createdAtMs, jwk:{kty:"OKP", crv:"Ed25519", x, d}}` (in the bridge's DSH-Workspace).
- Fingerprint: `deviceId = hex(SHA-256(raw bytes of the Ed25519 public key x))`, 64 hex characters.
- Public key unchanged → deviceId constant → reusable while gateway approval remains valid. The JWK must be persisted: generated on first run, reused afterwards.

### 2.3 challenge → sign → connect

1. Server sends: `{"type":"event","event":"connect.challenge","payload":{"nonce":"<uuid>","ts":1787251465376}}`
2. Claim (order fixed — 9 segments joined by `|`):

```
v2|<deviceId>|<clientId>|<clientMode>|<role>|<scopes(comma-joined)>|<signedAtMs>|<token>|<nonce>
```

3. Ed25519-sign the UTF-8 bytes of the claim, base64url-encoded.

The signed claim timestamp and device.signedAt use the same signedAt value.

4. Send connect (client field structure):

```json
{"type":"req","id":"<uuid>","method":"connect","params":{"minProtocol":4,"maxProtocol":4,"client":{"id":"openclaw-control-ui","version":"control-ui","platform":"web","mode":"webchat","instanceId":"<dsh-ts>"},"role":"operator","scopes":["operator.admin","operator.read","operator.write","operator.approvals","operator.pairing"],"device":{"id":"<deviceId>","publicKey":"<x>","signature":"<sig>","signedAt":<ms>,"nonce":"<nonce>"},"caps":["tool-events"],"auth":{"token":"<OC_TOKEN>"},"userAgent":"DSH","locale":"en"}}
```

The client sends locale=en and userAgent=DSH with the pairing fields.

### 2.4 Approval (mandatory on first connect)

- Not approved: `{"type":"res","ok":false,"error":{"code":"PAIRING_REQUIRED","message":"..."}}`
- Approve that `deviceId` in the OpenClaw Control UI (operator role + the 5 operator scopes).
- `oc-client.mjs connect` retries automatically every `OC_RETRY_MS` (default 8 s) until approved.

### 2.5 Connection Success

```json
{"type":"res","ok":true,"payload":{"type":"hello-ok","protocol":4,
 "server":{"version":"2026.7.1-2","connId":"..."},
 "features":{"methods":["health","diagnostics.stability","doctor.memory.status", "crestodian.chat", ...]}}}
```

- Criterion: `payload.type === "hello-ok"`.
- `payload.features.methods` is the full list of gateway methods advertised by the gateway — usable for capability discovery.

## 3. Frame Format

Bidirectional JSON text frames (WS opcode 0x1; fresh random four-byte client mask per frame):

| Direction | Shape | Notes |
|---|---|---|
| Client → | `{"type":"req","id":"<uuid>","method":"<method>","params":{...}}` | id regenerated per request |
| Server → | `{"type":"res","id":"<uuid>","ok":true,"payload":{...}}` | id matches the request |
| Server → | `{"type":"res","id":"<uuid>","ok":false,"error":{"code":...}}` | failure |
| Server → | `{"type":"event","event":"<name>","payload":{...}}` | event (e.g. connect.challenge) |

## 4. Gateway methods

| Method | params example | Notes |
|---|---|---|
| agents.list | `{}` | returns the list of agents |
| doctor.memory.status | `{}` | dreaming memory-system status |
| status | `{}` | runtime status |
| crestodian.chat | `{"message":"hello"}` | banner-guard conversation |
| tools.invoke | `{"name":"message","args":{"action":"send","channel":"discord","to":"channel:<id>","text":"hi"}}` | tool name in `name`, arguments in `args` |

- tools.invoke message tool: `reply.ok===true && reply.payload.ok===true` counts as DELIVERED; delivery details is in `payload.output.delivered` / `payload.output.deliveryStatus`.
- Read requests use action=read, channel=discord and to=channel:<id>; response contents depend on gateway capabilities.

## 5. Error Handling

| Symptom | Meaning | Client action |
|---|---|---|
| HTTP response ≠ 101 | origin not allowed / gateway unreachable | report an error, prompt to check allowedOrigins |
| error.code === PAIRING_REQUIRED | device not approved | oc-client retries automatically; CLI prompts you to approve |
| Device signature invalid | Claim timestamp, nonce, token or key differs from signed fields | Keep claim and device.signedAt identical; check gateway policy and identity |
| ok:false + error{code,message} | business error | surface code/message, exit code non-zero |
| close frame (op8) | gateway disconnected | clean up pending, trigger onClose (oc-client reconnects) |
| request timeout | OC_REPLY_TIMEOUT_MS default 20 s | reject that request; caller decides whether to retry |

## 6. Message Idempotency & Retry

- Each request uses a fresh random ID. Reconcile effects before retrying non-idempotent methods, including message delivery; request IDs alone provide no deduplication contract.
- Bridge envelopes use the required local SQLite lease authority for `taskId` ownership and replay prevention; `.state/dsh-processed.json` is only a recoverable projection (see LEASES.md and BRIDGE-SPEC.md).
- After a disconnect, oc-client backs off and reconnects every `OC_RETRY_MS`; addressing uses DNS container names, so restarts / IP swaps need no config change.

## 7. Security Checklist

1. `OC_TOKEN` is only written to `.env` (never committed); its value = `openclaw.json → gateway.auth.token`.
2. JWK private-key file permissions 600 (the release build creates it with 0600), never in git (.gitignore excludes *.jwk).
3. Prefer container-name origins; if an IP really needs to be allowed, sync the gateway allowedOrigins after restarting the container and restart the gateway for it to take effect.
4. `run-command` envelope tasks are restricted to trusted sources (see the Security section of BRIDGE-SPEC).
## CLI and timeouts

```bash
node src/oc-client.mjs connect
node src/oc-client.mjs node health '{}'
node src/oc-invoke.mjs health '{}' --timeout 20000 --raw
node src/oc-send.mjs "hello" --channel CHANNEL_ID --action send
node src/oc-send.mjs --channel CHANNEL_ID --action read --raw
```

Gateway/Cua CLIs load the working-directory .env or OC_ENV_FILE; exported variables take priority. Connection timeout defaults to 45000 ms, reply timeout to 20000 ms and reconnect interval to 8000 ms. Request timeout describes the caller wait, not cancellation of remote effects. HTTP upgrade reads complete headers up to 64 KiB, validates status 101 and Sec-WebSocket-Accept, and preserves trailing frame bytes.
