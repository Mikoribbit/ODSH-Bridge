# Operations: Cua Desktop, Security, Troubleshooting

## 1. Windows desktop execution (Cua Driver)

See **[CUA-EXECUTION.md](CUA-EXECUTION.md)** for the full guide. Summary:

- **Why**: gives the DSH execution layer desktop control on the Windows host —
  screenshot, click/type, browser automation (CDP), app launch — through SSH and Cua Driver.
- **How it works**: `src/oc-cua.mjs` runs `ssh -i <key> <user>@<host> "cua-driver call <tool> '<json>'"`.
- **Security posture**: SSH is key-only (`BatchMode=yes`), the Windows side whitelists exactly the DSH
  container's public key; the driver operates the real desktop but uses the host desktop session.

---

## 2. Security notes

1. **Credentials**: store OC_TOKEN in deployment-managed environment files with restricted access.
2. **Device pairing**: `deviceId` is a device fingerprint (a hash of the Ed25519 public key); approving it
   grants operator-level permissions — make sure your network is isolated and do not approve unknown devices
   casually.
3. **Origin allowlist**: broad openings lower security; in production only allow the origin you actually use;
   changing the allowlist requires a gateway restart.
4. **Private key permissions**: the JWK file is created `0600` and lives in DSH-Workspace (the other container
   must not modify it).
5. **run-command**: fixed executable allowlist and literal argv, split on whitespace. Allowed interpreters can execute code. Use trusted producers and configure BRIDGE_ALLOW_REQUESTERS.
6. **Cua channel**: SSH key is limited to the DSH identity; keep `CUA_SSH_*` in controlled env vars (never
   commit). Revoke the key immediately if the Windows host or container is compromised.

---

## 3. Troubleshooting (common failures)

| Symptom | Cause | Fix |
|---|---|---|
| `spawn <script> ENOENT` | Command/environment missing when launched through DSH's tool-runner exec channel | Check the configured runner executable, PATH and container process supervisor; use the image-provided Node path. |
| `ECONNREFUSED / ENOTFOUND` | Cannot reach the gateway | Check both containers on the same docker network and the container name (`docker exec openclaw getent hosts openclaw`) |
| `handshake rejected / non-101` | origin not allowed | Add the origin to `gateway.controlUi.allowedOrigins` and restart the gateway (back up openclaw.json first) |
| Connection breaks after container IP swap | An IP was hardcoded | Use container-name DNS everywhere (default `OC_HOST=openclaw`) |
| `device signature invalid` (intermittent) | Claim signature timestamp differs from device.signedAt | Use a single `const signedAt = Date.now()` for both (see `gateway-client.mjs`) |
| `PAIRING_REQUIRED` | Device not approved | Approve that deviceId in the Control UI |
| daemon does not process envelopes | Terminal authority record, other target, expired deadline or invalid filename | Inspect target, authority, deadline and logs; reconcile effects before using a new task ID. Preserve authority and marker. |
| Cua: `Connection refused` on 22 | sshd not running (service-manager start fails) | Use `sshd.exe -d` debug-check; if that works, use the scheduled-task fallback (see CUA-EXECUTION.md §1.2) |
| Cua: `Permission denied (publickey)` | Key not in `administrators_authorized_keys` (Administrators user) | Put the DSH pubkey there with `icacls ... Administrators:F`; see CUA-EXECUTION.md §1.4 |
| Cua: `cua-driver: not recognized` or wrong path | PATH / install location differs | Set `CUA_BIN` to the real full path of `cua-driver.exe` |

---


## Task recovery and retention

Follow [leases](LEASES.md) for migration and recovery. needs-review means external effects require reconciliation. Waiting timeout stops waiting only; children, descendants or remote work may continue. Establish effects and stop relevant work before submitting a new task ID. Use one resource executor or external locks for shared desktops.

Cleanup protects task/result JSON, databases and the entire state directory; age-based deletion applies to auxiliary files. Preview first:

```bash
node src/bridge-cleanup.mjs --days 7 --dry-run
node src/dshtrigger.mjs purge --days 7 --dry-run
```
