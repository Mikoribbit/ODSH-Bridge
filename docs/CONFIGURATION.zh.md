# 配置与目录结构

## 配置（.env 字段）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `OC_HOST` | `openclaw` | 网关容器名（用 DNS 不要用 IP） |
| `OC_PORT` | `18789` | 网关端口 |
| `OC_TOKEN` | （必填） | `openclaw.json → gateway.auth.token` 的值 |
| `OC_ORIGIN` | `http://<host>:<port>` | 动态生成；须被网关 allowedOrigins 放行 |
| `OC_KEYS` | `<BRIDGE_PATH>/DSH-Workspace/openclaw-device.json` | 设备身份 JWK（自动生成/复用） |
| `BRIDGE_PATH` | `/root/ODSH-bridge` | 桥根路径 |
| `DISCORD_CHANNEL_ID` | （空） | 通知/发送目标频道 |
| `OC_RETRY_MS` | `8000` | oc-client 配对等待/重连间隔 |
| `OC_CONNECT_TIMEOUT_MS` | `45000` | 连接（握手+配对）超时 |
| `OC_REPLY_TIMEOUT_MS` | `20000` | 单次请求超时 |
| `BRIDGE_ALLOW_ABS_PATHS` | `false` | 允许绝对路径语法，仍限制在桥根内 |
| `OC_NODE_SCRIPT` | `oc-cua.mjs`（与 daemon 同目录） | 兼容桌面信封执行器 |
| `OC_SEND_SCRIPT` | `src/oc-send.mjs` | 通知用发送脚本路径 |
| `CUA_SSH_USER` | （必填，无默认） | Cua 通道的 Windows 用户名 |
| `CUA_SSH_HOST` | `host.docker.internal` | 容器可达的 Windows 宿主 |
| `CUA_SSH_PORT` | `22` | Windows SSH 端口 |
| `CUA_SSH_KEY` | `/root/.ssh/id_ed25519` | SSH 私钥 |
| `CUA_BIN` | `C:/Users/<user>/AppData/Local/Programs/Cua/cua-driver/bin/cua-driver.exe` | Windows 端 cua-driver 完整路径 |
| `CUA_TIMEOUT_MS` | `60000` | 单次调用超时 |

---

## 目录结构

```
plugin-release/
├── README.md                  英文概览（中文见 README.zh.md）
├── AUTHORS.md                 维护者 / 贡献者
├── CHANGELOG.md               版本历史（Keep a Changelog）
├── MAINTENANCE.md             故障排查与恢复
├── docs/
│   ├── PROTOCOL.md            网关握手/帧/方法/错误/幂等
│   ├── BRIDGE-SPEC.md         桥四区/信封 schema/状态机/原子写
│   └── CUA-EXECUTION.md       Windows 桌面执行（安装/授权/使用）
├── skills/
│   └── odsh-interop/          OpenClaw 侧 skill（SKILL.md + 安装 README）
├── src/
│   ├── env.mjs                .env 加载器
│   ├── gateway-client.mjs     共享 WS/Ed25519 配对客户端
│   ├── oc-invoke.mjs          调用任意网关方法
│   ├── oc-send.mjs            经网关发消息
│   ├── oc-client.mjs          配对等待 / 长连客户端
│   ├── oc-cua.mjs             （v1.1）SSH + Cua Driver 桌面执行
│   ├── bridge-daemon.mjs      信封监视/执行器
│   └── bridge-cleanup.mjs     留存清理工具
├── scripts/                   一键幂等部署
│   ├── setup-windows.ps1      Windows 宿主：Cua Driver + OpenSSH + 防火墙 + 公钥 + 连接信息
│   └── setup-dsh.sh           DSH 容器：ssh 客户端 + 密钥 + .env + 验证 get_screen_size
├── config/                    Cordis 插件形态（参考适配器）
├── docker-compose.yml         可运行的 compose 模板（OpenClaw 官方镜像 + DSH 构建/自定义镜像）
├── bridge-template/           可直接复制的目录桥：Input/ Output/ DSH-Workspace/ Openclaw-Workspace/
├── .env.example               环境变量模板（环境配置）
└── LICENSE  ·  package.json  ·  docker-compose.snippet.yml（旧片段）
```

---


## 运行环境与配置行为

守护进程使用 Node >=22.13，CI 覆盖 22.13 和 24。环境文件支持引号外行尾注释，保留引号内井号，已导出的进程变量优先。网关非有限数值配置回退默认值；显式非法端口和超时被拒绝。

DSH 领取 target 为 dsh、both 或缺省的信封，其他目标保持不动。可选 expiresMs 必须为有限数值的 Unix 毫秒绝对截止时间，过期或非法值在执行前失败；省略时兼容旧信封。该截止时间不是可续期的所有权租约 TTL。未知任务类型失败。文件访问使用跨平台相对路径与真实路径边界检查，校验文件链接及最近存在祖先。

通知默认关闭，仅显式 ODSH_NOTIFY=1 且配置频道与令牌才开启。发送器只接受 send/read 动作，调用格式为正文加 --channel ID。触发器等待超时返回非零，但不会取消任务或删除信封。桌面工具仅精确放行 --version，不放松工具名注入防护。

Compose 同时挂载源码和启动脚本并加载环境文件。脚手架复制缺失运行文件，不覆盖用户定制工具；启动前须人工核对被保留的旧工具。首次迁移必须先停止全部旧消费者并遵循 LEASES.md，脚手架不自动授权迁移。按部署配置镜像 Node 版本、文件权限和 pnpm dsh web 命令。

## 配置入口与超时

网关/Cua CLI 从当前工作目录读取 .env，OC_ENV_FILE 可指定文件；已导出的变量优先。引号外 # 开始注释，引号内 # 保留。daemon 与 trigger 直接接收进程环境，Compose 通过 env_file 注入。

| 变量 | 默认值 | 用途 |
|---|---|---|
| BRIDGE_PATH | /root/ODSH-bridge | 共享桥根目录 |
| BRIDGE_LEASE_DB | Input/.state/租约指南.db （相对桥根） | 必需的共用本地权威库 |
| BRIDGE_LEASE_MS | 30000 | 租约有效期, 300..3600000 ms |
| BRIDGE_LEASE_UPGRADE | 空 | 首次显式初始化设为 all-consumers-stopped |
| BRIDGE_ALLOW_REQUESTERS | 空 | Comma-separated trusted requesters; 空 accepts all |
| BRIDGE_SQLITE / BRIDGE_SQLITE_DB | 可选 | 独立审计库，参见 [租约指南](LEASES.md) |
| OC_HOST / OC_PORT | openclaw / 18789 | 网关地址 |
| OC_TOKEN | 访问网关必填 | gateway.auth.token |
| OC_ORIGIN | http://host:port | 网关 Origin 白名单 |
| OC_KEYS | DSH-Workspace/openclaw-device.json （相对桥根） | 持久化设备身份 |
| OC_CONNECT_TIMEOUT_MS | 45000 | 网关连接等待 |
| OC_REPLY_TIMEOUT_MS | 20000 | 网关请求等待 |
| OC_RETRY_MS | 8000 | 长连接客户端重连间隔 |
| ODSH_INTERVAL_MS | 2000 | 入口扫描间隔；直接 daemon 的 --interval-ms 默认 5000 |
| ODSH_NOTIFY | 0 | 入口通知须精确设为 1 |
| DISCORD_CHANNEL_ID | 空 | 通知目标频道 |
| CUA_TIMEOUT_MS | 60000 | SSH/Cua 调用等待 |

run-command 超时固定 15000 ms；兼容桌面信封子进程超时固定 60000 ms；通知子进程超时 25000 ms。BRIDGE_RUN_TIMEOUT_MS 和 BRIDGE_INTERVAL_MS 当前不控制这些行为。trigger send 的 --timeout 默认 60000 ms，默认目标 openclaw；DSH 回显须加 --to dsh。等待超时返回非零，任务仍保留。
