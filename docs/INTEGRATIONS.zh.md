# 集成方式

## 1. 集成方式

### A. 独立 CLI / 守护进程（推荐部署）

- 零构建、零 npm 依赖，直接 `node src/bridge-daemon.mjs` 运行；daemon 配置从进程环境传入。
- 连接统一经 `safeClose()`（`gateway-client.mjs`）：新版 `node:net` ESM Socket 只有
  `destroy()/resetAndDestroy()`、没有 `.close()`；见 `gateway-client.mjs` 内注释。
- **自启守护进程（v1.2+）**：DSH 容器经 `scripts/dsh-entrypoint.sh` → `src/dshtrigger.mjs daemon`
  自动拉起桥守护（自愈 supervisor，子进程崩溃自动重启）；正常启动无需手动 `node`。
  统一入口 `node src/dshtrigger.mjs daemon|send|status|once`，`status` 会报告守护实时健康度。

### B. 挂载进 DSH 作为 Cordis 插件（参考适配器）

- `config/odsh-bridge.ts`：`export function apply(ctx, config)` 形态，在 `ctx.effect()` 内
  spawn `bridge-daemon.mjs`，卸载/热重载时 SIGTERM 回收。
  `config/cordis.yml` 是 `insert:` 合并片段。

---


## 生命周期与部署

两种入口均要求 Node >=22.13、共用本地 SQLite 权威库及[显式迁移](LEASES.md)。daemon 和 trigger 使用进程环境；插件合并父进程环境与 config.env，bridgePath 覆盖桥路径。插件卸载时通过 SIGTERM 回收子进程；需要崩溃重启策略时使用独立 supervisor。

仓库 Compose 将源码与入口挂到 /opt/odsh-bridge；脚手架将运行文件复制到桥目录 DSH-Workspace/tools，生成的 Compose 位于桥宿主目录。启动前核对镜像入口与保留的定制工具。通知通过入口 ODSH_NOTIFY=1、CLI --notify 或插件 notify=true 显式开启，同时配置频道与网关凭据。
