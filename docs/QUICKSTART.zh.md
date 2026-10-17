# 快速开始

## 1. 前置条件

- **Docker**（Windows/macOS 用 Docker Desktop；Linux 用 Docker Engine + compose；示例使用 Compose）——ODSH Bridge 本质是「两个容器」：
  OpenClaw（大脑/网关）+ DeepSeek Harness（DSH，执行层）在同一 docker 网络。
- **两张镜像**：
  - OpenClaw——官方 `openclaw/openclaw:latest`（Docker Hub）。
  - DSH——**无公开镜像**，从官方仓库自建：
    ```bash
    git clone https://github.com/deepseek-ai/deepseek-harness.git dsh-src && cd dsh-src
    docker build -t deepseek-harness:local .
    ```
- 两个容器位于同一 docker 网络（本仓库示例名 `agent-mesh`），彼此能用容器名互通。
- OpenClaw 网关 allowed origins 需包含你使用的 origin（见 [docs/PROTOCOL.md](PROTOCOL.md) §2.1）。

## 2. 生成桥目录——交互式向导（推荐）

一条命令以可视化提示引导你填写每一项；**直接回车保留方括号内的默认值**，键入则覆盖，
y/n 回答可选项。

```bash
cd ODSH-Bridge
chmod +x scripts/new-bridge.sh
./scripts/new-bridge.sh          # 交互式向导
```

按顺序会依次询问：

| 提示 | 默认值 | 说明 |
|---|---|---|
| 桥宿主目录 | `C:/ODSH-bridge` | 四个分区文件夹在宿主上的位置 |
| 容器挂载路径 | `/root/ODSH-bridge` | 两侧容器内统一的路径 |
| OpenClaw 服务名 | `openclaw` | 容器/服务名 |
| DSH 服务名 | `deepseek-harness` | 容器/服务名 |
| 网关端口 | `18789` | OpenClaw 网关端口 |
| OC_TOKEN | 占位符 | 粘贴 `openclaw.json → gateway.auth.token` 的值 |
| Discord 频道 ID | *（无）* | 完成通知用（可选） |
| 生成 docker-compose.yaml？ | `y` | 在桥目录写入可运行的 compose |
| 启用 Cua 桌面通道？ | `n` | 可选 Windows 桌面执行（见 §5） |
| SQLite 审计库 | node:sqlite 可用时为 y | 可选审计，与必需任务权威库分离 |
| Windows SSH 用户名 | `id -un` | 仅启用 Cua 时需要 |

向导会复制四个分区（`Input/ Output/ DSH-Workspace/ Openclaw-Workspace/`）、写入 `.env`
（`BRIDGE_PATH` 自动指向你的挂载路径），并按需生成 `docker-compose.yaml`（挂载 `<宿主目录>` → `<挂载点>`）。下方命令以 /srv/odsh-bridge 为宿主目录。

> **非交互一键式** 仍可用（无提示；自行管理 Compose 时可加 --no-compose）：
> ```bash
> ./scripts/new-bridge.sh /srv/odsh-bridge
> ```

## 首次初始化与路径

使用 Node >=22.13 和支持 SQLite 进程锁的可靠本地文件系统。全部消费者须使用同一物理权威库与相同容器挂载路径；支持范围为单主机本地部署，SMB/NFS 与跨主机共享超出该范围。

以下命令假设桥宿主目录为 /srv/odsh-bridge，容器挂载为 /root/ODSH-bridge；Windows 请替换宿主路径。向导在桥目录写入 .env 和 docker-compose.yaml，运行文件复制到 DSH-Workspace/tools。重跑会重写环境配置与生成的 Compose，保留已有工具；先备份并核对定制文件。选择自定义服务名时也须替换命令中的服务名。

启动前填写 OC_TOKEN，确认镜像内 Node 版本及入口所需 pnpm dsh web 命令。首次初始化或旧版迁移前，停止全部消费者与监督器，备份 Input、Output 和状态，在生成的 .env 临时设置 BRIDGE_LEASE_UPGRADE=all-consumers-stopped。初始化成功后移除此项，再重新创建 DSH 服务。详见[租约迁移](LEASES.md)。

## 3. 拉起容器

```bash
docker compose -f /srv/odsh-bridge/docker-compose.yaml up -d
```

- **DSH 容器通过入口脚本自动拉起桥守护进程**（自启，无需手动）。
- 验证它活着：
```bash
docker compose -f /srv/odsh-bridge/docker-compose.yaml exec deepseek-harness node /root/ODSH-bridge/DSH-Workspace/tools/dshtrigger.mjs status        # 显示 health: { running: true, pid: … }
```

## 4. 配对一次 + 验证

```bash
# 在宿主运行；于 OpenClaw 控制台批准设备。
docker compose -f /srv/odsh-bridge/docker-compose.yaml exec deepseek-harness node /root/ODSH-bridge/DSH-Workspace/tools/oc-client.mjs connect
#   首次运行打印 "device not approved" → 在 OpenClaw 控制台批准该 deviceId。
```

配对客户端保持连接；另开终端执行任务往返：

```bash
docker compose -f /srv/odsh-bridge/docker-compose.yaml exec deepseek-harness node /root/ODSH-bridge/DSH-Workspace/tools/dshtrigger.mjs send --to dsh --kind echo --text "hello"     # 投信封、取结果
```

## 5. 可选——Windows 桌面执行（Cua Driver）

> 完整指南：[docs/CUA-EXECUTION.md](CUA-EXECUTION.md)。最快路径——两个幂等的一键脚本：

```powershell
.\scripts\setup-windows.ps1 -BridgePath C:\ODSH-bridge
```
以下命令在 DSH 容器内的源码检出目录执行，先挂载或复制源码。

```bash
./scripts/setup-dsh.sh --bridge /root/ODSH-bridge --host host.docker.internal
```

每个脚本会检测已完成部分并跳过；互写 `windows-connect.json` / `.env`，DSH 侧以实际调用
`get_screen_size` 验证收尾。

## 6. 下一步

- **配置 / `.env` 字段 / 目录**：`docs/CONFIGURATION.zh.md`
- **独立 vs Cordis 插件**：`docs/INTEGRATIONS.zh.md`
- **真实运维 / 安全 / 故障排查**：`docs/OPERATIONS.zh.md`
