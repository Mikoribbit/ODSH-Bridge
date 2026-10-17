# ODSH Bridge - directory bridge (template)

Copy this whole directory to your chosen host path (e.g. C:/ODSH-bridge on Windows or /srv/odsh-bridge on Linux, or any dir you prefer),
then reference it in docker-compose.yml via ODSH_BRIDGE_HOST_DIR, or in your own compose.

| Zone | Purpose | Owner |
|------|---------|-------|
| Input/ | task envelopes (T-*.json) | shared |
| Output/ | results (<taskId>_result.json) | shared |
| DSH-Workspace/ | private DSH identity/drafts/logs/tools | deepseek-harness |
| Openclaw-Workspace/ | private OpenClaw memory/summaries | openclaw |

Protocol docs: docs/BRIDGE-SPEC.md (in the repo).

All task consumers require Node >=22.13 and the same physical local SQLite authority at Input/.state/leases.db. Initialize after stopping all old consumers; follow the [lease guide](../docs/LEASES.md) in the source checkout. Back up authority, marker and result projections together while offline. Generated runtime helpers live in DSH-Workspace/tools.
