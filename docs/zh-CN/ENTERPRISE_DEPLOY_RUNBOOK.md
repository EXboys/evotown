# 企业部署 Runbook：健康检查、升级与回滚

面向已用 [ENTERPRISE_QUICKSTART.md](./ENTERPRISE_QUICKSTART.md) 完成首次部署的 IT 运维。覆盖 **部署前检查**、**日常巡检**、**数据备份**、**版本升级** 与 **失败回滚**。

相关文档：

- [MDM 员工端下发](./MDM_AGENT_ROLLOUT.md)
- [API Key 生命周期](./ENTERPRISE_KEY_LIFECYCLE.md)
- [Coding Agent 与 Gateway](./CODING_AGENT_AND_GATEWAY.md)

---

## 1. 部署前检查

在首次部署或升级前确认：

| 项 | 要求 |
|----|------|
| Docker | Docker Engine + Compose v2（`docker compose version`） |
| 磁盘 | 宿主机 `./data` 及 agent/MCP 挂载目录剩余空间 ≥ 计划用量的 2 倍 |
| 上游模型 | `.env` 中 `API_KEY`、`BASE_URL`、`MODEL` 有效（企业部署走 LiteLLM profile） |
| 公网/内网 URL | `EVOTOWN_PUBLIC_URL` 与员工实际访问地址一致（含 `https://`） |
| 密钥 | `ADMIN_TOKEN`、`EVOTOWN_ENGINE_INGEST_TOKEN` 已写入 `.env`，**勿**下发员工 |
| 生产加固 | `EVOTOWN_DEV_ALLOW_*=0`、`EVOTOWN_ALLOW_PUBLIC_REGISTER=0`、`CORS_ORIGINS=$EVOTOWN_PUBLIC_URL`（`enterprise-deploy.sh` 会写入） |
| 版本记录 | 记录当前 git tag / commit 或镜像 digest，便于回滚 |

```bash
cd evotown
git rev-parse HEAD          # 或: git describe --tags
docker compose --profile litellm config --quiet >/dev/null
test -f .env && grep -q '^ADMIN_TOKEN=' .env
```

---

## 2. 首次部署

见 [ENTERPRISE_QUICKSTART.md § 一、IT 一键部署](./ENTERPRISE_QUICKSTART.md#一it-一键部署约-5-分钟)：

```bash
export UPSTREAM_BASE_URL=https://api.openai.com/v1
export UPSTREAM_API_KEY=sk-your-key
export EVOTOWN_PUBLIC_URL=https://evotown.company.internal
./scripts/enterprise-deploy.sh
```

部署完成后执行一次巡检（见下一节）。

---

## 3. 日常健康检查

### 3.1 一键巡检（推荐）

在仓库根目录、服务已启动时：

```bash
./scripts/enterprise-deploy.sh --check
```

检查项：

1. **Backend** — 经前端反代的 `GET /health` 返回 `{"status":"ok"}`（同时返回 `hardening_ok` / `security_warnings`，**不**因警告使探活失败）
2. **Gateway** — `GET /api/gateway/v1/health`（含 LiteLLM 是否配置）
3. **SQLite 数据目录** — 容器内 `/app/data`（`EVOTOWN_DATA_DIR`）可写，且 `gateway.db` 可读或能新建 SQLite
4. **Docker** — `backend` 容器 healthcheck 为 `healthy`
5. **生产加固** — `.env` 与运行时：`EVOTOWN_DEV_ALLOW_ADMIN_AS_GATEWAY=0`、`EVOTOWN_DEV_ALLOW_ADMIN_TOKEN_FALLBACK=0`、`EVOTOWN_ALLOW_PUBLIC_REGISTER=0`，且 `CORS_ORIGINS` 不为 `*`

非零退出码表示未通过；结合 `docker compose logs backend frontend litellm` 排查。

### 3.2 手动 curl（与员工侧一致）

```bash
BASE="${EVOTOWN_PUBLIC_URL:-https://evotown.company.internal}"
KEY="<deploy-output 或 .env 关联的 evk_ key>"

curl -fsS "$BASE/health"
curl -fsS "$BASE/api/gateway/v1/health"
curl -fsS "$BASE/api/v1/market/bundles/default-agent-skills/manifest?runtime_target=openclaw" \
  -H "Authorization: Bearer $KEY"
```

员工机可用 `evotown-agent-setup.py check` 做端到端验证（含 manifest）。

### 3.3 建议巡检频率

| 环境 | 频率 |
|------|------|
| 生产 | 每日 cron 或监控系统调用 `--check` |
| 升级前后 | 各执行一次，并保留输出 |
| Staging | 每次镜像/配置变更后 |

---

## 4. 数据备份

升级或重大变更前 **必须先备份**。容器内路径与宿主机映射如下（默认 compose）：

| 优先级 | 容器路径 | 宿主机路径 | 内容 |
|--------|----------|------------|------|
| **必备份** | `/app/data` | `./data` | SQLite（`gateway.db` 等）、social_log、控制台状态 |
| **必备份** | `/app/data/agents` | `${EVOTOWN_AGENTS_HOST_DIR}`（默认 `/usr/local/agent-data/agents`） | Agent sandbox 持久化 |
| **建议备份** | `/app/data/mcp-services` | `${EVOTOWN_MCP_SERVICES_HOST_DIR}` | 已发布 MCP 服务代码 |
| **建议备份** | `/app/data/mcp-dev` | `${EVOTOWN_MCP_DEV_HOST_DIR}` | MCP 开发目录 |
| **建议备份** | — | `./logs` | 运行日志 |
| **可选** | `/root/.skilllite/arena` | Docker 卷 `evotown_arena` | 进化/竞技场产物 |
| **可选** | `/app/replays` | Docker 卷 `evotown_replays` | 录制回放 |
| **必备份** | — | `.env` | 密钥与配置（加密存储，勿入 git） |

### 4.1 备份命令示例

```bash
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_ROOT="/var/backups/evotown/$STAMP"
mkdir -p "$BACKUP_ROOT"

# 核心数据（停写可选：见升级章节）
tar -czf "$BACKUP_ROOT/data.tgz" -C . data
tar -czf "$BACKUP_ROOT/logs.tgz" -C . logs 2>/dev/null || true
cp -a .env "$BACKUP_ROOT/env.backup"

# Agent / MCP 宿主机目录（路径以 .env 为准）
AGENTS="${EVOTOWN_AGENTS_HOST_DIR:-/usr/local/agent-data/agents}"
tar -czf "$BACKUP_ROOT/agents.tgz" -C "$(dirname "$AGENTS")" "$(basename "$AGENTS")" 2>/dev/null || true

# 命名卷（需 docker）
docker run --rm \
  -v evotown_evotown_arena:/src:ro \
  -v "$BACKUP_ROOT":/dest \
  alpine tar -czf /dest/arena.tgz -C /src .

echo "Backup: $BACKUP_ROOT"
```

> 卷名前缀取决于 compose 项目名（默认目录名 `evotown` → `evotown_evotown_arena`）。用 `docker volume ls | grep evotown` 确认。

### 4.2 恢复

1. 停止服务：`docker compose --profile litellm down`
2. 还原 `./data`、agent 目录、`.env`（或仅还原 data 保留新 `.env`）
3. 启动：`docker compose --profile litellm up -d`
4. `./scripts/enterprise-deploy.sh --check`

---

## 5. 版本升级

### 5.1 标准流程（Docker Compose）

```bash
cd evotown

# 1. 记录当前版本
git rev-parse HEAD | tee /tmp/evotown-pre-upgrade.rev

# 2. 备份（§4）
# ...

# 3. 拉取代码与镜像
git fetch origin && git checkout main && git pull origin main
# 构建前轻量清理（dangling 镜像 + 7 天外 builder cache；不会 prune -af）
./scripts/enterprise-deploy.sh --gc   # 可选：顺带清 pip/HF 缓存与 journal
docker compose --profile litellm pull   # 仅 pull 有 image: 的服务（如 litellm）
docker compose --profile litellm build  # backend / frontend 本地构建

# 4. 滚动重启（短暂不可用）
docker compose --profile litellm up -d --build

# 5. 验收
./scripts/enterprise-deploy.sh --check
# 可选：用员工 evk_ key 打一条 gateway chat 或 evotown-agent-setup.py check
```

> `enterprise-deploy.sh`（无参数的完整部署）在 `compose up --build` **之前**也会自动跑一次 Docker 轻量清理。

### 5.2 磁盘清理（防 40G 盘打满）

```bash
# 随时可跑：dangling 镜像 + builder；Linux root 下再清 ~/.cache/{pip,huggingface}、journal≤200M
./scripts/enterprise-deploy.sh --gc
df -h /
docker system df
```

建议每月或磁盘 >80% 时执行一次。**不要**日常使用 `docker image prune -af`（会删掉未在跑、但仍打了 tag 的回滚镜像）。

### 5.3 升级时注意

- **SQLite**：Evotown 启动时会自动迁移 schema；跨大版本升级前务必完成 §4 备份。
- **`.env`**：新版本可能增加变量；对比 `docs/templates/env.enterprise.example`，按需合并，**不要**覆盖已有 `ADMIN_TOKEN` / ingest token。
- **LiteLLM**：profile `litellm` 与 `./litellm.config.yaml` 需一并更新；改上游模型后重启 `litellm` 与 `backend`。
- **员工侧**：仅服务端升级时，员工 `evotown.agent.env` 通常无需变更；若 `EVOTOWN_PUBLIC_URL` 或 TLS 证书变更，需经 [MDM](./MDM_AGENT_ROLLOUT.md) 推送。

### 5.4 可选：固定镜像版本

生产建议在升级前 pin LiteLLM 镜像 tag（编辑 `docker-compose.yml` 或使用 override 文件），避免 `main-stable` 漂移。

---

## 6. 回滚

当升级后 `--check` 失败或业务异常时：

```bash
cd evotown

# 1. 切回已知良好 commit
git checkout "$(cat /tmp/evotown-pre-upgrade.rev)"

# 2. 恢复数据（若怀疑 schema/数据损坏）
# tar -xzf /var/backups/evotown/<stamp>/data.tgz -C .

# 3. 重建并启动
docker compose --profile litellm build
docker compose --profile litellm up -d --force-recreate

# 4. 验收
./scripts/enterprise-deploy.sh --check
```

若仅应用层回滚不足以恢复，使用 §4.2 全量恢复 data + `.env`，再启动旧版本代码。

Key 轮换与吊销见 [ENTERPRISE_KEY_LIFECYCLE.md](./ENTERPRISE_KEY_LIFECYCLE.md)；回滚 **不会** 自动恢复已吊销的 key。

---

## 7. Staging 升级演练（验收）

在 staging 环境完整走一遍，作为 Issue/变更验收：

- [ ] 部署前检查（§1）通过
- [ ] 执行 §4 备份并验证 tar 可解压
- [ ] `git pull` + `docker compose --profile litellm up -d --build`
- [ ] `./scripts/enterprise-deploy.sh --check` 退出码 0
- [ ] 员工 key 拉 manifest、gateway health 正常
- [ ] 故意检出旧 commit 回滚（§6），再次 `--check` 通过
- [ ] 记录演练时间与操作人

---

## 8. 故障排查速查

| 现象 | 排查 |
|------|------|
| `/health` 超时 | `docker compose ps`；`docker compose logs backend` |
| Gateway health 中 `litellm_configured: false` | 确认 `--profile litellm` 已启用；`.env` 中 `LITELLM_BASE_URL`、`LITELLM_MASTER_KEY` |
| SQLite 可写检查失败 | 宿主机 `./data` 权限；磁盘满；SELinux/AppArmor |
| 升级后 502 | frontend 依赖 backend healthy；等待 healthcheck 或查 nginx 日志 |
| 员工 manifest 403 | key 过期/吊销；见 Key 生命周期文档 |

---

## 相关文档

- [企业快速接入](./ENTERPRISE_QUICKSTART.md)
- [MDM 员工端下发](./MDM_AGENT_ROLLOUT.md)
- [API Key 生命周期](./ENTERPRISE_KEY_LIFECYCLE.md)
- 环境模板：[docs/templates/env.enterprise.example](../templates/env.enterprise.example)
