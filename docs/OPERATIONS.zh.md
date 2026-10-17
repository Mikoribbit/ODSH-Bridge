# 运维：Cua 桌面、安全、故障排查

## 1. Windows 桌面执行（Cua Driver）

完整指引见 **[CUA-EXECUTION.md](CUA-EXECUTION.md)**。摘要：

- **为什么**：给 DSH 执行层在 Windows 宿主上提供桌面控制——
  截图、点击/键入、浏览器自动化（CDP）、拉起应用；通过 SSH 与 Cua Driver 执行。
- **怎么跑**：`src/oc-cua.mjs` 执行 `ssh -i <key> <user>@<host> "cua-driver call <tool> '<json>'"`。
- **安全姿态**：SSH 仅密钥（`BatchMode=yes`），Windows 侧只放行 DSH 容器的公钥；
  驱动使用宿主桌面会话。

---

## 2. 安全说明

1. **凭据管理**：OC_TOKEN 放在部署管理的环境文件中并限制访问。
2. **设备配对**：`deviceId` 是设备指纹（Ed25519 公钥的哈希）；批准即授予 operator 级权限——
   确保网络隔离，不要随意批准陌生设备。
3. **Origin 白名单**：开太宽会降低安全性；生产只放行你实际使用的 Origin；改白名单需重启网关。
4. **私钥权限**：JWK 文件以 `0600` 创建并存在 DSH-Workspace（另一容器不得修改）。
5. **run-command**：固定可执行文件白名单与字面量 argv，空白分词；允许的解释器仍可执行代码。仅授权受信生产者并配置 BRIDGE_ALLOW_REQUESTERS。
6. **Cua 通道**：SSH 密钥限定 DSH 身份；`CUA_SSH_*` 放受控环境变量（绝不入库）；
   宿主或容器失陷时立即吊销密钥。

---

## 3. 常见故障排查

| 症状 | 原因 | 解决 |
|---|---|---|
| `spawn <script> ENOENT` | 经 DSH 工具执行通道启动时命令/环境缺失 | 核对执行器命令、PATH 与容器进程监督配置，使用镜像内实际 Node 路径。 |
| `ECONNREFUSED / ENOTFOUND` | 网关不可达 | 确认两容器在同一 docker 网络、容器名正确（`docker exec openclaw getent hosts openclaw`） |
| `handshake rejected / non-101` | Origin 未放行 | 把所用 Origin 加入 `gateway.controlUi.allowedOrigins` 并重启网关（先备份 openclaw.json） |
| 容器 IP 变化后断连 | 硬编码了 IP | 全用容器名 DNS（默认 `OC_HOST=openclaw`） |
| `device signature invalid`（偶发） | 认领串时间戳与 device.signedAt 不一致 | 二者共用同一个 `const signedAt = Date.now()`（见 `gateway-client.mjs`） |
| `PAIRING_REQUIRED` | 设备未批准 | 在控制台批准对应 deviceId |
| 守护进程不处理信封 | 权威库已有终态、其他目标、截止已过或文件名不符 | 核对目标、权威库、截止时间与日志；确认副作用后再用新任务 ID，保留权威库与标记 |
| Cua：22 端口 `Connection refused` | sshd 未运行（服务管理器启动失败） | 用 `sshd.exe -d` 调试确认；若能跑，用计划任务兜底（见 CUA-EXECUTION.md §1.2） |
| Cua：`Permission denied (publickey)` | 公钥未在 `administrators_authorized_keys`（Administrators 用户） | 把 DSH 公钥放进去并 `icacls ... Administrators:F`；见 §1.4 |
| Cua：`cua-driver: not recognized` / 路径不对 | PATH / 安装位置不同 | 把 `CUA_BIN` 设为 `cua-driver.exe` 的真实完整路径 |

---


## 任务恢复与清理

按[租约指南](LEASES.md)迁移和恢复。needs-review 表示外部效果待确认；等待超时只停止等待，子进程、后代或远端操作仍可能继续。确认效果并停止相关工作后，用新任务 ID 提交。共享桌面使用单一资源执行器或外部资源锁。

清理器保护任务/结果 JSON、数据库及整个状态目录，仅清理符合年龄条件的辅助文件。先预览：

```bash
node src/bridge-cleanup.mjs --days 7 --dry-run
node src/dshtrigger.mjs purge --days 7 --dry-run
```
