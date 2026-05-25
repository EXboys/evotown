# 企业 API Key 生命周期（MVP）

Evotown 使用 `evk_` 前缀的员工 key 统一访问 **模型网关** 与 **私有 SkillHub**。Admin Token 仅 IT 持有，不下发员工。

## 推荐 scope

| 角色 | scopes | 用途 |
|------|--------|------|
| 员工 agent | `gateway.chat`, `console.read` | 调模型 + 拉 skill manifest/下载 |
| 平台管理员 | `console.write` + admin | 控制台管理、上传 skill |
| Connector / CI | `EVOTOWN_ENGINE_INGEST_TOKEN` | 上报 run、注册 engine（非 evk_） |

## 签发流程

1. `/accounts` 创建账号，填写 `team_id`（如 `growth-team`）
2. 签发 key，设置 `monthly_token_limit` / `burst_rpm_limit`
3. 可选 `expires_at` — 过期后 `lookup_api_key` 自动拒绝
4. 通过 MDM 分发 `evotown.agent.env`（仅含 `EVOTOWN_URL` + `EVOTOWN_API_KEY`）

## 团队隔离（已实现 MVP）

- 账号绑定 `team_id` 后，员工 key 拉取的 **market catalog / manifest** 自动过滤：仅 `company` 可见 skill + 本 team skill
- 跨 team 下载需在 query 显式传 `team_id`（需更高权限，后续 RBAC 收紧）

## 轮换与吊销

| 操作 | 路径 |
|------|------|
| 吊销 | `/accounts` → Revoke key，或 `POST /api/v1/keys/{id}/revoke` |
| 轮换 | 签发新 key → MDM 推送新 env → 吊销旧 key |
| 审计 | `/gateway` 用量、`/runs` 时间线、gateway.db 请求记录 |

## 尚未实现（路线图）

- SSO / SAML / OIDC 登录控制台
- 按 role 的细粒度 RBAC（仅 reviewer 可 approve skill）
- 自动 key 轮换 webhook

参见 [ENTERPRISE_QUICKSTART.md](./ENTERPRISE_QUICKSTART.md)、[MDM_AGENT_ROLLOUT.md](./MDM_AGENT_ROLLOUT.md)
