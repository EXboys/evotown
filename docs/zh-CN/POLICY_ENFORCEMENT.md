# Connector 策略落地（Policy Enforcement）

Evotown 采用 **pull + 本地执行 + 违规上报** 模式：Connector / Runtime 拉取策略，在工具调用、文件访问、外连、产物上传前评估，blocked 动作写入 `/risk`。

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/policies?enabled_only=true` | Connector 拉取策略（`evi_` / Admin / `evk_`） |
| POST | `/api/v1/policy/evaluate` | 执行前评估（见下表） |
| POST | `/api/v1/policy/violations` | 上报违规（evaluate 带 run_id 时自动写入） |
| POST | `/api/v1/events` | ingest 时服务端对 `tool_call` / `artifact_written` 等二次校验 |

### `POST /api/v1/policy/evaluate` body

| `kind` | `resource` 示例 | v1 行为 |
|--------|-----------------|--------|
| `tool` | `shell_rm_rf` | deny → **block** |
| `file_read` / `file_write` | `/path/to/file` | 工作区外 / deny 模式 → **block** |
| `network` | `https://host/path` | 非白名单域名 → **block** |
| `artifact` | `out.zip` + `extra.bytes` | 超限 / 扩展名 → **block** |
| `text` | 日志片段 + `extra.text` | 含密钥模式 → **block**（可配置仅 warn） |

v1.5：`require_approval_*` → **warn**（不阻断，写入 violations）。

## 员工机命令

```bash
# 拉策略到 ~/.config/evotown/policies-cache.json
python3 scripts/evotown-agent-setup.py policy-pull

# 手动试一条
python3 scripts/evotown-agent-setup.py policy-check tool shell_rm_rf
python3 scripts/evotown-agent-setup.py policy-check network https://evil.example.com
```

Connector 在上报 `tool_call` ingest 事件前会调用 evaluate（需 `evi_` 或 `evk_`）。

## OpenClaw 插件

`integrations/openclaw/evotown/index.js` 在支持 `api.hooks.on` 时注册 `tool:before` / `fs:*` / `http:request` 钩子。需设置 `EVOTOWN_URL` 与 API Key。

## 默认策略 ID

- `tool-allowlist` — 工具/MCP 黑白名单
- `workspace-paths` — 工作区与敏感路径
- `network-domains` — 外网域名
- `artifact-limits` — 产物大小与扩展名
- `secret-redaction` — 日志/文本密钥

在控制台 **策略** Tab 可启用/禁用与编辑 rules JSON。
