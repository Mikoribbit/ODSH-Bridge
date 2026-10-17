# Authoritative task leases / 权威任务租约

## Deployment contract

The daemon now requires Node >=22.13 with built-in node:sqlite. Optional audit settings do NOT disable the required authority. Every consumer of the same Input namespace must open the **same physical database**, directly in Input/.state (default leases.db). Use a reliable local filesystem with working SQLite process locks. SMB/NFS, cross-host sharing and per-container private SQLite files are unsupported. A Docker volume is suitable only when it truly maps all consumers to the same local database and lock domain; sharing Input alone is insufficient.

Stop **all old consumers**, supervisors and peer tools that rewrite task state before migration. Back up Input, Output and state together. Explicitly set BRIDGE_LEASE_UPGRADE=all-consumers-stopped for first initialization, then remove that setting. The persistent lease-protocol.json binds the Input namespace to the DB identity/path/protocol; missing/mismatched authority fails closed. Do not delete the marker or DB to reset tasks. If first initialization crashes between marker creation and DB commit, startup may deliberately remain blocked: restore a consistent offline backup rather than deleting the marker blindly.

Old binaries do not understand this marker and cannot be remotely fenced by this patch. **Mixed-version operation is prohibited and requires deployment-level exclusion** (stop/revoke old executables and shared-directory access). The flag is an operator attestation, not automatic proof that old consumers are absent. Do not downgrade while unresolved work exists.

## Configuration

- BRIDGE_LEASE_DB: default <BRIDGE_PATH>/Input/.state/leases.db; must reside directly in that state directory. Keep mount paths identical across consumers.
- BRIDGE_LEASE_MS: default 30000 ms; supported 300..3600000. Production TTL must exceed worst local scheduling/storage latency. Renewal runs every TTL/4 and immediately before execution.
- BRIDGE_LEASE_UPGRADE: first migration only, exact value all-consumers-stopped. Export environment variables to the daemon; do not assume the daemon itself loads .env.
- BRIDGE_SQLITE / BRIDGE_SQLITE_DB remain optional audit controls, with a distinct DB. Audit failure may degrade; authority failure never does.

## Semantics

BEGIN IMMEDIATE serializes claims. Each execution has random owner/token, increasing generation and a separate lease expiry (not envelope expiresMs). Renew/complete require current owner/token/generation, running state and unexpired DB-clock lease. Completion stores terminal state and result in one transaction. Output results and dsh-processed.json are recoverable projections, serialized against commits with unique temporary names. Projection failure cannot authorize replay. Startup rebuilds projections; it does not trust them over an existing authority.

Input v1 and result v1 fields are preserved. New needs-review status explicitly means uncertain execution, not success/failure/cancellation. Immutable task fingerprint includes all envelope fields; taskId/id must match filename. A typed task identity/content conflict retains input, original authority/result/cache and a review log, skips that task, and continues scanning unrelated tasks. SQLite/transaction/projection failures are not task conflicts: they stop the whole scan; renewal DB errors abort work best-effort and stop the scan without completion. Use a new task ID after deliberate reconciliation, not edited reuse.

### Result identity and offline migration

Protocol IDs remain ASCII T-[A-Za-z0-9_.-]+ and retain their original spelling in filenames, envelopes, results and cache keys. Their unique result identity is ASCII case-folded across ALL platforms: T-A and T-a cannot coexist, even after the first input is removed. A SQLite NOCASE unique index enforces this namespace inside the claim transaction; an alias is rejected, not renamed or silently merged.

Startup installs the index transactionally before any execution/projection, including existing v1 databases and legacy cache/result imports. No-collision databases upgrade without rewriting IDs or results. Existing case aliases cause a global migration refusal and transaction rollback; no winner is selected and no projection is rewritten. Stop every consumer (including older v1 binaries), back up Input/Output/state together, inspect all conflicting DB rows and external effects, then reconcile offline under operator control. Preserve conflicting evidence outside the live namespace and restore a consistent authority/projection set; do not delete the authority/marker or use automatic ID reuse to bypass refusal. Legacy cache/result aliases receive the same refusal. Keep old executables excluded: the unchanged v1 wire protocol does not make mixed old/new code safe.

中文：结果身份统一按 ASCII 大小写折叠唯一，但保留原 ID 拼写及 v1 协议。历史库或旧缓存存在别名时整体拒绝迁移，不自动挑选胜者、合并或覆盖；必须停全体消费者、完整备份并人工离线核对副作用及冲突证据。普通任务内容/身份冲突只保留证据跳过，其他任务继续；真正数据库错误仍关闭整个扫描。

By default expired executions and legacy running envelopes become needs-review. Only an explicit top-level retrySafe=true assertion permits expired running work to be claimed again. This assertion is a trusted sender contract that repetition and overlap with a paused old execution are safe; never use it for non-idempotent browser actions. Legacy processed without a verifiable result is quarantined; compatible existing results are imported, conflicting result/cache pairs become needs-review. Malformed inputs remain in place for manual review instead of unsafe concurrent DLQ deletion.

Execution is asynchronous. Lost renewal discards completion and aborts the local child best-effort; descendants/remote work may continue. Execution timeout also yields needs-review. Waiting timeout in dshtrigger only stops waiting. Notification delivery is best-effort after commit and is not transactional/exactly-once.

Task leases fence **task coordination and result writes only**. They do not serialize different tasks using one browser/desktop, sandbox trusted run-command, or guarantee exactly-once external effects. No resource lock/distributed coordinator is implemented. Use one resource executor or external resource-level fencing for shared browsers. Arbitrary trusted commands/filesystem administrators can still bypass coordination and are outside the trust boundary.

Cleanup/purge conservatively retain task/result JSON and all state-directory data, including active and expired leases. No automatic DB compaction, task-ID reuse, needs-review reset or authority deletion is provided. Offline review must establish external effects and stop all relevant work before submitting a new task. Back up the authority with consumers stopped; do not copy only JSON projections.

SQLite uses the same host wall clock; clock jumps, event-loop pauses or slow projection transactions can lose leases. Short busy timeout errs toward closed execution. Full projections scale linearly and are intended for small local bridges, not high-throughput distributed queues. Select host storage and offline backup procedures appropriate to durability requirements.

## 中文运维摘要

1. 全停旧消费者及监督器、备份桥输入/输出/状态；要求 Node >=22.13，所有消费者同一可靠本地 DB、同一路径。禁止 SMB/NFS/跨主机/容器私有 DB 冒充互斥。
2. 首次显式导出 BRIDGE_LEASE_UPGRADE=all-consumers-stopped，初始化后撤掉；默认权威 DB 为 Input/.state/leases.db。协议标记绑定 DB，丢库不得直接重建，需离线恢复一致备份。
3. 原信封/结果结构兼容，新增 needs-review 表示执行不明；只有顶层 retrySafe=true 的受信安全任务可过期恢复。超时、失租、杀父进程都不证明外部副作用停止。
4. 旧缓存无结果、遗留 running 保守待确认；内容/身份改变拒绝复用。现有权威不受 JSON 反向覆盖，删除投影可重建。
5. 禁止旧版混跑依赖部署隔离，旧程序自身不识别新协议，不能声称标记能拦住旧二进制。任务锁不等于不同任务的浏览器资源锁。
6. 清理器不再按年龄删除任务/结果/协调数据；不提供自动清除待确认、删除 DB 或降级重放。需人工核实副作用后以新任务 ID 提交。
