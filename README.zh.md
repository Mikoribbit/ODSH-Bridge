# ODSH-Bridge for Docker — OpenClaw × DeepSeek Harness 互联桥（Docker 版）

<div align="center">

[**English**](https://github.com/Mikoribbit/ODSH-Bridge/blob/main/README.md) ·
[**中文**](https://github.com/Mikoribbit/ODSH-Bridge/blob/main/README.zh.md)

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Node](https://img.shields.io/badge/Node-%3E%3D22.13-green.svg)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)
![Platform](https://img.shields.io/badge/platform-Docker%2Fagent--mesh-blue.svg)

</div>

> **一句话定位**：让 DeepSeek Harness（DSH，执行层）通过 WebSocket 连接 OpenClaw（大脑/人格层）网关，
> 借助共享目录桥（信封 + 守护进程）在两侧容器间可靠交接任务；**自 v1.1 起**，还能通过
> **SSH + [Cua Driver](https://github.com/trycua/cua)** 操作**宿主机上的真实 Windows 桌面**
> （截图 / 点击 / 浏览器 / 系统操作）。


---

## 导航

[快速开始](docs/QUICKSTART.zh.md) · [配置](docs/CONFIGURATION.zh.md) · [运维](docs/OPERATIONS.zh.md) · [租约与迁移](docs/LEASES.md)

---

## 1. 架构（文字版）

```
┌────────────────────────────── agent-mesh（docker 网络）─────────────────────────────────┐
│                                                                                           │
│   deepseek-harness (DSH)                        openclaw (OpenClaw)                │
│   ├─ oc-invoke.mjs  ──┐                                                                    │
│   ├─ oc-send.mjs   ───┼── WebSocket(:18789) ─────▶ 网关（设备配对 +                 │
│   ├─ oc-client.mjs ───┘   显式 Origin / Ed25519 签名   JSON-RPC 风格方法）             │
│   │                      配对 / tools.invoke         ├─ agents.list / status             │
│   └─ bridge-daemon.mjs                                ├─ doctor.memory.*（dreaming）     │
│         │                                             └─ message（Discord 收发）           │
│   └─ oc-cua.mjs ─── SSH(:22, ed25519) ──────────────▶ Windows 宿主                   │
│         │                                             └─ Cua Driver（cua-driver serve）  │
│         └── 共享桥挂载：Input/ Output/ DSH-Workspace/ Openclaw-Workspace/                  │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

共有三条数据流：

1. **实时通道**：DSH 脚本作为"配对设备"连接 18789 上的 OpenClaw 网关
   （HTTP Upgrade + Origin 白名单 + Ed25519 签名配对 + `connect.challenge` → `hello-ok`），
   再以 JSON-RPC 风格调用网关方法。
2. **异步桥**：任一侧写入任务信封 `Input/T-*.json` → 守护进程监视并执行 → 原子写回
   `Output/<taskId>_result.json`，可选经 `oc-send` 通知 Discord 频道。
3. **Windows 桌面执行（v1.1+）**：DSH 调用 `oc-cua.mjs` → `ssh` 进入 Windows 宿主 →
   执行 `cua-driver call <tool> '<json>'` → 驱动操作真实桌面（截图、点击/键入/热键、
   浏览器 CDP、拉起应用），使用宿主桌面会话。

---

## 2. 能力

- 网关连接使用显式 Origin 和持久化 Ed25519 身份；权限由网关审批控制。
- 任务经必需的共用本地 SQLite 权威库原子领取，在异步执行期间续租，条件提交终态后生成 JSON 结果投影。
- 支持回显、通知确认、受信命令、桥内文件读写和桥状态；桌面操作使用 SSH + Cua Driver。
- 要求 Node >=22.13；首次初始化和升级先停止全部旧消费者，再按[租约指南](docs/LEASES.md)显式迁移。
- 共享浏览器或桌面使用单一资源执行器或外部资源协调；任务租约约束任务所有权和结果提交。

## 3. 部署

前置：**Docker** + 两张镜像——OpenClaw（官方 `openclaw/openclaw:latest`）与 DSH
（无公开镜像；从 [DeepSeek Harness 仓库](https://github.com/deepseek-ai/deepseek-harness) 自建 `deepseek-harness:local`）。

先按[快速开始](docs/QUICKSTART.zh.md)配置镜像、生成桥目录、完成首次初始化并启动容器。通知通过 ODSH_NOTIFY=1 显式开启。



## 文档

按任务选择指南：

| 页面 | 覆盖 |
|------|------|
| [**快速开始**](docs/QUICKSTART.zh.md) | 获取项目 / 拉起容器 / 部署守护 / 可选 Cua |
| [**配置**](docs/CONFIGURATION.zh.md) | .env 字段 + 目录结构 |
| [**集成方式**](docs/INTEGRATIONS.zh.md) | 独立守护 vs Cordis 插件 |
| [**运维**](docs/OPERATIONS.zh.md) | Cua Windows 桌面、安全、故障排查 |
| [**路线图**](ROADMAP.md) | 分阶段长期计划（ClawHub / 插件生态 / 事件总线）|
| [**协议**](docs/PROTOCOL.md) | 网关握手 / JSON-RPC 细节 |
| [**租约与恢复**](docs/LEASES.md) | 本地权威、迁移与恢复 |
| [**桥规范**](docs/BRIDGE-SPEC.md) | 信封格式 / 状态机 / 分区 |
| [**维护笔记**](MAINTENANCE.md) | 维护与恢复 |

---

## 支持

如果你觉得这个项目有帮助，可以考虑支持维护者：

<a href="https://www.buymeacoffee.com/mikoribbit" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-orange.png" alt="Buy Me A Coffee" height="45" width="auto"></a>

> ☕ [buymeacoffee.com/mikoribbit](https://www.buymeacoffee.com/mikoribbit)

---

## 致谢

- **odsh-interop**：OpenClaw 侧互操作技能，参见[安装说明](skills/odsh-interop/README.md)。

- **Cua** — 本项目的 Windows 桌面执行层由
  [Cua Driver](https://github.com/trycua/cua)（trycua 团队）提供支持。感谢他们开源了一个跨平台、不抢焦点的
  computer-use 驱动，让 agent 可以在不抢走用户鼠标的情况下操作桌面应用。
  Cua Driver 由其作者独立许可——详见其仓库。

---

> 维护：ODSH Bridge contributors · 许可证：MIT · Node >=22.13 · 零依赖 ESM
