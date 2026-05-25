# 企业快速接入：IT 一键部署 + 员工两行配置

面向 **员工本机已安装 OpenClaw / Hermes** 的企业：在内网部署 Evotown，统一提供 **大模型网关** 与 **私有 SkillHub**，员工只需两行配置即可接入。

---

## 架构一览

```text
                    ┌──────────────────────────────────┐
                    │  evotown.company.internal        │
                    │  Docker：Evotown + LiteLLM       │
                    │                                  │
                    │  /api/gateway/v1    ← 模型统一入口 │
                    │  /api/v1/market/... ← 私有 SkillHub │
                    └───────────────┬──────────────────┘
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          │                         │                         │
     员工 A · OpenClaw          员工 B · Hermes            CI / 服务器
     evotown.agent.env          同上两行                    ingest token
     （两行配置）               （两行配置）
```

---

## 一、IT 一键部署（约 5 分钟）

### 前置条件

- Docker Desktop 或 Docker Engine + Compose v2
- 上游大模型 API（OpenAI 兼容即可：OpenAI、DeepSeek、Qwen、MiniMax 等）
- 可选：内网域名 + 反向代理（Caddy / Nginx）

### 步骤

```bash
cd evotown

# 1. 填写上游模型（也可部署后再改 .env 重跑）
export UPSTREAM_BASE_URL=https://api.openai.com/v1
export UPSTREAM_API_KEY=sk-your-key
export UPSTREAM_MODEL=gpt-4o-mini

# 2. 生产环境替换为内网 HTTPS 地址
export EVOTOWN_PUBLIC_URL=https://evotown.company.internal

# 3. 一键部署
chmod +x scripts/enterprise-deploy.sh
./scripts/enterprise-deploy.sh
```

脚本会自动：

1. 从 `docs/templates/env.enterprise.example` 生成 `.env`（若不存在）
2. 生成 `ADMIN_TOKEN`、`EVOTOWN_ENGINE_INGEST_TOKEN`、`LITELLM_MASTER_KEY`
3. `docker compose --profile litellm up -d --build`
4. 等待 `/health` 就绪
5. 创建企业员工账号并签发 `evk_` API Key（含 `gateway.chat` + `console.read`）
6. 在 `deploy-output/` 写入员工配置包

### 部署产物

| 文件 | 用途 |
|------|------|
| `deploy-output/evotown.agent.env` | **员工两行配置**（IT 经 MDM / 内网文档分发） |
| `deploy-output/openclaw.evotown.yaml` | OpenClaw 配置片段 |
| `deploy-output/hermes.evotown.yaml` | Hermes 配置片段 |
| `deploy-output/IT_DEPLOY_SUMMARY.txt` | IT 交接摘要 |

也可登录控制台后，在 **`/market`** 或 **`/gateway`** 页使用「员工两行配置 · 复制即用」面板；在 **`/accounts`** 签发新 key 后会自动生成完整员工配置包。

### 员工本机一条命令（推荐）

```bash
sudo install -m 755 scripts/evotown-agent-setup.py /usr/local/bin/evotown-agent-setup.py
# 配置 ~/.config/evotown/evotown.agent.env 后：
evotown-agent-setup.py check
evotown-agent-setup.py sync          # 从 SkillHub 拉取/更新 skill
evotown-agent-setup.py watch         # 可选：定时自动 sync
eval "$(evotown-agent-setup.py print-env)"   # 导出 OPENAI_* 给 OpenClaw/Hermes
```

MDM 批量下发见 [MDM_AGENT_ROLLOUT.md](./MDM_AGENT_ROLLOUT.md)；密钥管理见 [ENTERPRISE_KEY_LIFECYCLE.md](./ENTERPRISE_KEY_LIFECYCLE.md)。

### 部署后验收

```bash
BASE=https://evotown.company.internal
ADMIN=<deploy-output 或 .env 中的 ADMIN_TOKEN>
KEY=<deploy-output 中的 EVOTOWN_API_KEY>

# 健康检查
curl -fsS "$BASE/health"

# 模型网关（OpenAI 兼容）
curl -fsS "$BASE/api/gateway/v1/health" -H "Authorization: Bearer $KEY"

# 私有 Skill manifest（员工 key）
curl -fsS "$BASE/api/v1/market/bundles/default-agent-skills/manifest?runtime_target=openclaw" \
  -H "Authorization: Bearer $KEY"
```

---

## 二、员工两行配置

IT 将 `evotown.agent.env` 分发给员工（**勿提交 git、勿外传**）：

```bash
EVOTOWN_URL=https://evotown.company.internal
EVOTOWN_API_KEY=evk_xxxxxxxxxxxxxxxx
```

仅此两行。同一 `evk_` key 同时用于：

- **调模型** → `{EVOTOWN_URL}/api/gateway/v1`
- **拉 Skills** → `{EVOTOWN_URL}/api/v1/market/bundles/default-agent-skills/manifest?runtime_target=...`

### OpenClaw

```bash
mkdir -p ~/.config/evotown
cp /path/from/it/evotown.agent.env ~/.config/evotown/
source ~/.config/evotown/evotown.agent.env
```

在 OpenClaw 配置中合并 [openclaw.evotown.yaml](../templates/openclaw.evotown.yaml) 片段，或直接设置：

| 变量 | 值 |
|------|-----|
| `OPENAI_BASE_URL` | `$EVOTOWN_URL/api/gateway/v1` |
| `OPENAI_API_KEY` | `$EVOTOWN_API_KEY` |
| Skills manifest | `$EVOTOWN_URL/api/v1/market/bundles/default-agent-skills/manifest?runtime_target=openclaw` |
| Manifest 鉴权 | `Authorization: Bearer $EVOTOWN_API_KEY` |

### Hermes

同上，将 [hermes.evotown.yaml](../templates/hermes.evotown.yaml) 合并进 Hermes 配置，`runtime_target=hermes`。

### SkillLite / 自定义 runtime

- 模型：`OPENAI_BASE_URL` + `OPENAI_API_KEY` 同上
- Skills manifest：`runtime_target=skilllite` 或 `custom`
- Run 上报（可选）：`Authorization: Bearer $EVOTOWN_ENGINE_INGEST_TOKEN`（仅 IT/Connector 持有，不下发员工）

---

## 三、IT 日常运维

| 任务 | 入口 |
|------|------|
| 上传 / 审核 Skills | 控制台 `/skills` 或 Admin API |
| **发布 Bundle（员工 manifest）** | 控制台 `/skills` → **发布 Bundle**，或 `POST /api/v1/skill-bundles/{id}/publish` |
| 查看模型用量 | `/dashboard`、`/costs`、Gateway API |
| 为员工续签 / 吊销 key | `/accounts` 或 `POST /api/v1/accounts/{id}/keys` |
| 知识库 | `/knowledge`（飞书 / 语雀 / 原生 Markdown） |

详细 Skills 市场 API：[PRIVATE_SKILLS_MARKET_DEPLOYMENT.md](./PRIVATE_SKILLS_MARKET_DEPLOYMENT.md)

---

## 四、安全建议

1. **生产关闭公开注册**：`.env` 中 `EVOTOWN_ALLOW_PUBLIC_REGISTER=0`（deploy 脚本默认写入）
2. **员工 key 最小权限**：`gateway.chat` + `console.read`；管理员操作仅用 `ADMIN_TOKEN`
3. **按人 / 按团队发 key**：在 `/accounts` 创建账号并设置 `monthly_token_limit`
4. **HTTPS + 内网 DNS**：参考仓库根目录 `Caddyfile`
5. **`deploy-output/` 加入 `.gitignore`**（若尚未忽略）

---

## 五、与云厂商的关系

Evotown **不替代** OpenClaw/Hermes 本机执行，也 **不绑定** 某一朵云：

- 上游模型可在 LiteLLM 后接任意 OpenAI 兼容 API（含内网自建）
- Skills 与审计数据留在企业内网
- 员工 agent 仍在笔记本本地跑，只把 **模型调用** 和 **skill 分发** 收口到 Evotown

---

## 相关文档

- [私有化 Skills 市场部署](./PRIVATE_SKILLS_MARKET_DEPLOYMENT.md)
- [引擎接入 API](./EVOTOWN-ENGINE-INGEST-V0.1.md)
- [企业控制面产品规划](./ENTERPRISE_CONTROL_PLANE_PRODUCT_SPEC.md)
- 配置模板：[docs/templates/](../templates/)
