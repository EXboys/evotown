# Evotown 引擎接入 API — v0.1（草案）

**状态：** 供对接方使用的草案规范。**本文档为 Evotown 独立仓库内的规范正文。** [SkillLite](https://github.com/EXboys/skilllite) 仓库可能在 `docs/zh/` 下保留同文镜像，供 monorepo 贡献者使用。

**v0.1 范围：** 仅 **入站 ingest** + 可选引擎注册。由 Evotown 向引擎 **派单** 的模式见附录，不作为 v0.1 必选。

---

## 基址与版本

- **路径前缀：** `/api/v1`
- **示例：** `https://{evotown-host}/api/v1`
- **破坏性变更：** 使用 `/api/v2`；v0.1 字段在可能范围内保持前向兼容。

---

## 鉴权（生产环境 MUST）

所有会改写状态的请求须带以下 **之一**：

1. **`Authorization: Bearer <evotown_issued_token>`** —— Evotown 下发的、绑定到 `engine_id` 的令牌；或  
2. **`X-Evotown-Timestamp` + `X-Evotown-Signature`** —— 对 `"{timestamp}." + raw_body` 做 HMAC-SHA256（时钟偏差建议 ≤ 5 分钟）。

须使用 **HTTPS**。Evotown 宜拒绝 **重复 `run_id` + 相同终态负载** 的重放（幂等窗口由实现定义）。

---

## 1）`POST /engines/register` —— 可选

登记或更新引擎元数据，便于展示来源与（可选）派单地址。

**请求 JSON**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `engine_id` | string | 是 | 稳定 id，如 `openclaw-local`。 |
| `engine_version` | string | 是 | Semver 或 git sha。 |
| `display_name` | string | 否 | 展示名。 |
| `dispatch_url` | string (URL) | 否 | 若日后 Evotown 主动派单，POST `RunJob` 的目标（见附录）。 |
| `capabilities` | object | 否 | 任意键值，如最大超时。 |

**响应：** `204` 或 `200` + `{ "registered_at": "<RFC3339>" }`。

---

## 2）`POST /runs/{run_id}/complete` —— **MVP 必选**

**`run_id`：** Evotown 预分配或事先约定的 opaque、URL-safe 字符串。

终结一次 run：写入状态、日志摘要、`artifact_manifest` 与 `signals`，供看板 / 进化奖励使用。

**请求 JSON**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `engine_id` | string | 是 | 须与令牌作用域或已登记引擎一致。 |
| `engine_version` | string | 是 | |
| `status` | string | 是 | `succeeded` \| `failed` \| `cancelled`。 |
| `exit_code` | integer | 是 | 进程或 harness 退出码；无则填 `0`。 |
| `finished_at` | string | 是 | RFC3339 UTC。 |
| `log_excerpt` | string | 否 | 截断的 stdout/stderr 或结构化日志（建议 ≤ 64 KiB）。 |
| `artifact_manifest` | array | 否 | 见下表。 |
| `artifact_bundle_url` | string (URL) | 否 | zip/tar 的 HTTPS 地址，Evotown **可**拉取（大小限制由实现定义）。 |
| `signals` | object | 否 | **评分 / 进化钩子** —— 字符串键，JSON 值。例：`task_completed`、`new_skill_paths`、`latency_ms`。 |

**`artifact_manifest` 元素**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 是 | 在 bundle 或工作区快照内的相对路径。 |
| `sha256` | string | 是 | 小写十六进制。 |
| `bytes` | integer | 是 | 字节长度。 |

**响应：** `200` + `{ "accepted": true, "run_id": "<同左>" }`；若 `run_id` 已是终态可返回 `409`（幂等策略由实现定义）。

**错误：** `401` 鉴权、`422` 校验、`413` 过大。

---

## 3）`POST /runs/{run_id}/artifacts` —— 可选（大文件）

`multipart/form-data` 上传 **`file`**，或 JSON 分块 **`base64`**（实现二选一即可）。小流量可省略，仅在 `complete` 里提供 `artifact_bundle_url`。

---

## 4）`POST /runs/lease` —— 可选（拉单模型）

引擎主动 **领任务**，而非 Evotown 直连引擎。每次最多返回一条。

**`200` 响应 JSON（有任务时）**

| 字段 | 类型 | 说明 |
|------|------|------|
| `run_id` | string | |
| `callback_base` | string (URL) | **须**为 Evotown 的 API 前缀并包含到 `/api/v1`（末尾无 `/`）。引擎向 `{callback_base}/runs/{run_id}/complete` 发 POST。 |
| `payload` | object | 不透明任务说明（消息、路径、git ref 等）。 |

**`204`：** 当前无任务。

---

## 语义约定

- **事实源：** `complete` 成功后，以 Evotown 入库的 run 为准做基准测试与进化奖励。  
- **引擎自由：** OpenClaw / Hermes 内部目录结构不必暴露；只需 **manifest + signals** 符合本文。  
- **隐私：** 勿在 `log_excerpt` / `signals` 中塞密钥；用引用或脱敏。

---

## 附录 A —— 派单配对（v0.1 非规范）

若 Evotown 向 `dispatch_url` 派单：

```http
POST {dispatch_url}/v1/execute
```

示例体：

```json
{
  "run_id": "01JABC...",
  "callback_url": "https://evotown.example/api/v1/runs/01JABC.../complete",
  "payload": { }
}
```

引擎结束后 **必须** 调用 Evotown 的 `callback_url`（与第 2 节同一契约）。

---

## 附录 B —— SkillLite（配套项目）

[SkillLite](https://github.com/EXboys/skilllite) 通过 CLI（`import-openclaw-skills`、`claw migrate`）与 OpenClaw 风格技能树互操作；这与 **Evotown ingest HTTP** 正交。引擎内部可任意使用 SkillLite，仍通过本 HTTP 面向 Evotown 上报。

**英文版：** [English](../en/EVOTOWN-ENGINE-INGEST-V0.1.md)。
