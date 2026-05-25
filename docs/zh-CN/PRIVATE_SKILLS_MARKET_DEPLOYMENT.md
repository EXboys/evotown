# 私有化 Skills 市场部署指南（MVP）

本文说明 Evotown 内置的私有 Skills 市场 MVP 如何在企业内网使用。

## 目标架构

```text
私有 Skills 市场
  -> 提供 bootstrap bundle manifest
  -> 存储企业私有 skill 包
  -> 接收 connector 提交的候选技能
  -> 管理审核与发布

OpenClaw / Hermes / SkillLite
  -> 拉取 bootstrap manifest
  -> 安装 package_url 指向的 skill 包
  -> 本地运行任务并生成候选技能

Connector / proxy
  -> 补齐 tenant/team/agent/engine/task 字段
  -> 上报 run.started / run.progress / run.completed
  -> 提交 skill-candidates
```

## 环境变量

生产环境至少设置：

```bash
export ADMIN_TOKEN="change-me-admin"
export EVOTOWN_ENGINE_INGEST_TOKEN="change-me-ingest"
export EVOTOWN_DATA_DIR="/var/lib/evotown"
```

数据会写入：

- `${EVOTOWN_DATA_DIR}/skills_market.db`
- `${EVOTOWN_DATA_DIR}/skill_packages/`
- `${EVOTOWN_DATA_DIR}/engine_ingest.db`

建议将 `EVOTOWN_DATA_DIR` 挂载到持久化磁盘，并纳入备份。

## 启动后检查

```bash
curl -H "X-Admin-Token: $ADMIN_TOKEN" \
  http://127.0.0.1:8765/api/v1/skill-bundles/default-agent-skills/manifest
```

成功后会返回默认初始化包：

```json
{
  "manifest": {
    "bundle_id": "default-agent-skills",
    "channel": "stable",
    "runtime_targets": ["openclaw", "hermes", "skilllite", "custom"],
    "skills": []
  }
}
```

## 上传企业私有 skill 包

当前 MVP 使用 JSON base64 上传，避免依赖 multipart 组件。

```bash
PACKAGE_B64="$(base64 -i ./private-crm-summary.skill.zip)"

curl -X POST http://127.0.0.1:8765/api/v1/skill-packages \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"skill_id\": \"private-crm-summary\",
    \"name\": \"Private CRM Summary\",
    \"description\": \"Internal CRM note summarization skill.\",
    \"version\": \"1.0.0\",
    \"runtime_targets\": [\"openclaw\", \"hermes\", \"skilllite\"],
    \"visibility\": \"team\",
    \"team_id\": \"growth-team\",
    \"tags\": [\"crm\", \"private\"],
    \"filename\": \"private-crm-summary.skill.zip\",
    \"content_base64\": \"$PACKAGE_B64\"
  }"
```

上传后 `GET /api/v1/skills` 会返回 `package_url`：

```bash
curl -H "X-Admin-Token: $ADMIN_TOKEN" \
  "http://127.0.0.1:8765/api/v1/skills?runtime_target=hermes&tag=crm"
```

## 下载 skill 包

```bash
curl -L -H "X-Admin-Token: $ADMIN_TOKEN" \
  http://127.0.0.1:8765/api/v1/skill-packages/private-crm-summary/download \
  -o private-crm-summary.skill.zip
```

## Connector 提交候选技能

Connector 使用 ingest token：

```bash
curl -X POST http://127.0.0.1:8765/api/v1/skill-candidates \
  -H "Authorization: Bearer $EVOTOWN_ENGINE_INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "candidate_id": "cand_001",
    "source_run_id": "run_001",
    "tenant_id": "company-a",
    "team_id": "growth-team",
    "agent_id": "hermes-agent-001",
    "engine_id": "hermes-local",
    "runtime_target": "hermes",
    "name": "Summarize CRM Notes",
    "description": "Extract action items from CRM notes.",
    "inline_manifest": { "entrypoint": "SKILL.md" },
    "signals": { "task_completed": true }
  }'
```

管理员审核：

```bash
curl -X POST http://127.0.0.1:8765/api/v1/skill-candidates/cand_001/review \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "decision": "approved",
    "reviewer": "platform-owner",
    "reason": "validated in staging",
    "visibility": "team",
    "promotion_channel": "stable"
  }'
```

审核通过后，候选技能会进入 `GET /api/v1/skills`。

## Runtime 接入示例

### OpenClaw

```yaml
skills_market:
  manifest_url: https://evotown.company.internal/api/v1/skill-bundles/default-agent-skills/manifest?runtime_target=openclaw
  auth_header: X-Admin-Token
  channel: stable

evotown_connector:
  endpoint: https://connector.company.internal
  engine_type: openclaw
```

### Hermes

```yaml
skills_market:
  manifest_url: https://evotown.company.internal/api/v1/skill-bundles/default-agent-skills/manifest?runtime_target=hermes
  install_scope: team

evotown_connector:
  tenant_id: company-a
  team_id: growth-team
  agent_id: hermes-agent-001
```

### SkillLite

```yaml
skills_market:
  manifest_url: https://evotown.company.internal/api/v1/skill-bundles/default-agent-skills/manifest?runtime_target=skilllite
  install_dir: .skills

evotown_connector:
  engine_type: skilllite
  report_events:
    - run.started
    - run.progress
    - run.completed
```

## 当前 MVP 边界

- 包上传使用 base64 JSON，后续可替换为 multipart 或对象存储直传。
- manifest 和下载接口目前需要 Admin Token；生产环境建议由 Connector 代理给 runtime。
- 只实现本地磁盘存储，后续可接 S3 / MinIO / 企业制品库。
- 暂未实现签名校验，只返回 `signature` 字段和包 `sha256`。

