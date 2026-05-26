# MDM 批量下发：员工 OpenClaw / Hermes 接入

IT 将 **`evotown.agent.env`**（至少两行 `EVOTOWN_URL` + `EVOTOWN_API_KEY`）放到员工机，并用 **`evotown-agent-setup`** 完成 gateway 校验与 SkillHub 自动同步。

派活需额外完成 **引擎注册** 与 **每机 `evi_` token**（见下文）。

---

## 1. IT 准备

部署 Evotown 后（见 [ENTERPRISE_QUICKSTART.md](./ENTERPRISE_QUICKSTART.md)）：

```bash
# 安装 CLI 到员工机 golden image（可选）
sudo install -m 755 scripts/evotown-agent-setup.py /usr/local/bin/evotown-agent-setup.py

# 员工 env（Jamf / Ansible）— 仅 URL + evk_，不要放 IT bootstrap ingest
cat >/tmp/evotown.agent.env <<EOF
EVOTOWN_URL=https://evotown.company.internal
EVOTOWN_API_KEY=evk_xxxxxxxx
EVOTOWN_ENGINE_ID=openclaw-\$(whoami)
EVOTOWN_TEAM_ID=sales
EOF
```

**IT 服务器 `.env` 中的 `EVOTOWN_ENGINE_INGEST_TOKEN`**：仅用于 IT 本机执行 `register`，**不得** 写入员工 golden image。

macOS 建议路径：`/Library/Application Support/Evotown/evotown.agent.env`  
Linux 建议路径：`/etc/evotown/evotown.agent.env`

---

## 2. 批量安装脚本

| 平台 | 脚本 |
|------|------|
| macOS | [scripts/mdm/install-evotown-agent-macos.sh](../../scripts/mdm/install-evotown-agent-macos.sh) |
| Linux | [scripts/mdm/install-evotown-agent-linux.sh](../../scripts/mdm/install-evotown-agent-linux.sh) |

脚本会：

1. 复制 env → `~/.config/evotown/evotown.agent.env`
2. 运行 `evotown-agent-setup check`
3. 运行 `evotown-agent-setup sync`
4. 添加 cron：每 4 小时自动 sync SkillHub

---

## 3. 员工本机（自助）

```bash
# 已有 evotown.agent.env（含 evk_）
python3 /usr/local/bin/evotown-agent-setup.py check
python3 /usr/local/bin/evotown-agent-setup.py sync

eval "$(python3 evotown-agent-setup.py print-env)"
```

### 派活（register + Connector）

```bash
# IT 在本机导出 bootstrap（勿写入员工镜像）
export EVOTOWN_INGEST_TOKEN=<服务器 .env 中 EVOTOWN_ENGINE_INGEST_TOKEN>

# 首次或轮换：下发 evi_ 到员工配置
evotown-agent-setup.py register --save-token

# 确认 ~/.config/evotown/evotown.agent.env 含：
#   EVOTOWN_ENGINE_INGEST_TOKEN=evi_...

# OpenClaw hooks（见 docs/templates/openclaw.evotown.yaml）
evotown-agent-setup.py connector --poll 15 --long-poll 25
```

Connector 默认 **`EVOTOWN_DISPATCH_COMPLETION=poll_run`**（hook 触发后等待 run 终态或阻塞 hook 返回，见 [AGENT_DISPATCH.md](./AGENT_DISPATCH.md)）。

OpenClaw / Hermes 指向：

```bash
OPENAI_BASE_URL=$EVOTOWN_URL/api/gateway/v1
OPENAI_API_KEY=$EVOTOWN_API_KEY
```

Gateway **已支持 SSE streaming**（`stream: true`）。

---

## 4. 自动 sync（watch 模式）

```bash
python3 evotown-agent-setup.py watch --interval 3600
```

或由 cron / launchd 调用 `sync`（安装脚本已配置）。

---

## 5. Engine 注册（IT bootstrap token）

```bash
# 仅在 IT 运维机或首次员工自助注册时
export EVOTOWN_INGEST_TOKEN=<EVOTOWN_ENGINE_INGEST_TOKEN from server .env>
python3 evotown-agent-setup.py register --save-token
```

注册返回的 **`evi_` token** 写入员工机 `EVOTOWN_ENGINE_INGEST_TOKEN`；之后 Connector / handoff **只用 `evi_`**。

管理员轮换：`POST /api/v1/engines/{id}/rotate-ingest-token`（控制台 Fleet，见 `/dispatch`）。

---

## 6. 存量员工机迁移至 evi_

适用于 #22 合并前已部署、仍用全局 `EVOTOWN_INGEST_TOKEN` 跑 Connector 的机器。

| 步骤 | 操作 |
|------|------|
| 1 | 从员工 env **删除** `EVOTOWN_INGEST_TOKEN`（IT bootstrap） |
| 2 | `export EVOTOWN_INGEST_TOKEN=<IT bootstrap>` 后执行 `evotown-agent-setup.py register --rotate --save-token` |
| 3 | 确认 env 仅有 `EVOTOWN_ENGINE_INGEST_TOKEN=evi_…` |
| 4 | 重启 Connector；日志无「应使用 evi_」警告 |
| 5 | 控制台 `/dispatch` 派发试任务，状态应正常终态 |

批量：Jamf/Ansible 按 `engine_id` 逐台轮换；Fleet API `ingest_token_prefix` 可核对是否已签发 `evi_`。

---

## 相关文档

- [AGENT_DISPATCH.md](./AGENT_DISPATCH.md)
- [ENTERPRISE_KEY_LIFECYCLE.md](./ENTERPRISE_KEY_LIFECYCLE.md)
- [ENTERPRISE_QUICKSTART.md](./ENTERPRISE_QUICKSTART.md)
