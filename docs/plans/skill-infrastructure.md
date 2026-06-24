# 技能基础设施方案

> 日期: 2026-06-22
> 状态: 已确认，实施中（REQ-019 skill_creator 开发中）

## 核心架构：两个系统 MCP

不设系统内置技能目录。所有技能生命周期管理通过两个系统 MCP 完成，放在 `backend/services/mcp_system/`，启动自动注册。

| MCP | action | 职责 |
|-----|--------|------|
| skill_creator | create | 生成 sk_xxx → 写 DB（status=draft）→ 在 workspace 建骨架目录 |
| internal_skill_deploy | submit | 校验 skill → 写 skill_versions → 提交审核（status=pending） |
| | status | 查询审核进度 |

---

## 一、数据库设计（对齐 MCP 模块）

### skills 表（skills_market.db，在现有基础上扩展）

新增字段：`category`、`agent_id`、`created_by`。source_type 新增 `workspace` 值。

| 字段 | 类型 | 说明 |
|------|------|------|
| skill_id | TEXT PK | sk_{uuid12} |
| name | TEXT | 技能名，不做命名约束，支持中文 |
| category | TEXT | 新增：技能分类 |
| agent_id | TEXT | 新增：创建技能的 agent |
| created_by | TEXT | 新增：操作账号（staff login_name） |
| source_type | TEXT | 新增值 `workspace`（Agent 创建） |
| status | TEXT | draft / pending / approved / rejected / online |

### skill_versions 表（扩展）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增 |
| skill_id | TEXT FK | 关联 skills |
| version | TEXT | 版本号 |
| status | TEXT | 新增：pending / approved / rejected |
| version_notes | TEXT | changelog |
| submitted_by_agent_id | TEXT | 新增：提交版本 agent |
| submitted_by_account | TEXT | 新增：提交版本账号 |
| reviewed_by | TEXT | 新增：审核人 |
| reviewed_at | TEXT | 新增：审核时间 |
| review_comment | TEXT | 新增：审核意见 |

### skill_usage_log 表（新增）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增 |
| skill_id | TEXT | 技能 ID |
| agent_id | TEXT | 使用技能的 agent |
| run_id | TEXT | 关联 claude_agent_runs |
| account | TEXT | 操作账号 |
| action | TEXT | load / execute |
| details | TEXT | JSON |
| created_at | TEXT | 调用时间 |

### 对齐关系

| MCP | Skill |
|-----|-------|
| mcp_services | skills |
| mcp_service_versions | skill_versions |
| mcp_usage_log | skill_usage_log |

无独立 events 表（通过 status 字段体现生命周期）。

---

## 二、skill_creator.create

**Agent 调用**：
```
mcp_call("skill_creator", {"action": "create", "category": "shop", "name": "订单查询"})
```

**后端执行**：
1. 生成 `skill_id = sk_{uuid12}`
2. INSERT skills（skill_id, name, category, agent_id, created_by, source_type='workspace', status='draft'）
3. INSERT skill_usage_log（event='create'，记录创建流水）
4. 在 workspace 建 `skills/sk_xxx/` 骨架：

```
skills/sk_xxx/
├── SKILL.md       ← 泛化 frontmatter 模板
├── scripts/
│   └── .gitkeep
└── references/
    └── .gitkeep
```

5. 返回 `{skill_id, name, category, path}`

**SKILL.md 模板**（泛化，不含业务指向性）：
```yaml
---
skill_id: sk_xxx
name: ""
description: ""
category: ""
version: 0.1.0
requires_mcp: []
requires_knowledge: []
---
```

**命名规范**：name 不做约束，文件系统支持即可，支持中文。唯一标识是 skill_id。

---

## 三、internal_skill_deploy.submit

**Agent 调用**：
```
mcp_call("internal_skill_deploy", {"action": "submit", "skill_id": "sk_xxx"})
```

**后端执行**：
1. 读 workspace `skills/sk_xxx/SKILL.md` → 解析 frontmatter
2. 校验（name/description 非空、requires_mcp/knowledge 格式正确）
3. 校验失败 → 返回错误列表
4. 校验通过 → INSERT skill_versions（status=pending）+ UPDATE skills.status=pending
5. INSERT skill_usage_log（event='submit'）

**审核互斥**：同 skill_id 已有 pending 版本时拒绝。

---

## 四、internal_skill_deploy.status

```
mcp_call("internal_skill_deploy", {"action": "status", "skill_id": "sk_xxx"})
```

查询 skill_versions 最新版本的审核状态。

---

## 五、管理员审核 → 部署 → 分发

管理员在 SkillsManagementPage 审核 tab 操作。

### 审核通过

```
POST /api/v1/skills/{skill_id}/approve
  → ① 从提交 agent 的 workspace skills/sk_xxx/ 复制文件到 custom-skills/sk_xxx/
  → ② 计算所有文件 SHA256，写入 custom-skills/sk_xxx/.skill_hash.json
  → ③ UPDATE skill_versions.status=approved, reviewed_by, reviewed_at
  → ④ 首次通过：UPDATE skills.status=draft→online
  → ⑤ INSERT skill_usage_log (approve)
  → ⑥ 查 account_skills 获取该技能已绑定的 agent 列表
      有绑定 → INSERT skill_distributions (N 条, status=pending)
      无绑定 → 跳过
  → ⑦ asyncio.create_task() 异步执行下发
```

### 审核驳回

```
  → UPDATE skill_versions.status=rejected, review_comment
  → INSERT skill_usage_log (reject)
```

### 异步下发逻辑

逐条处理 skill_distributions (status=pending)：

```
status → in_progress
  读目标 workspace skills/sk_xxx/.skill_hash.json
  force=0: 对比 hash → 匹配 → 复制覆盖 + 更新 hash → completed
                     → 不匹配 → skipped（message: Agent 已修改）
  force=1: 跳过对比 → 直接覆盖 + 更新 hash → completed
status → completed / skipped / failed
```

**强制下发**：管理员在技能管理模块选择 skill + agent，执行 force=1 下发。

### skill_distributions 表（新增）

```
skill_distributions
├── id                 INTEGER PRIMARY KEY AUTOINCREMENT
├── skill_id           TEXT NOT NULL
├── version            TEXT NOT NULL
├── agent_id           TEXT NOT NULL
├── status             TEXT NOT NULL  # pending / in_progress / completed / failed / skipped
├── message            TEXT NOT NULL DEFAULT ''
├── force              INTEGER NOT NULL DEFAULT 0
├── created_at         TEXT NOT NULL DEFAULT (datetime('now'))
├── started_at         TEXT
├── completed_at       TEXT
```

进度 UI 复用技能列表模块的进度展示。

### custom-skills 目录

`/app/data/custom-skills/sk_xxx/` 存放审核通过的技能文件。只有后台进程可操作，Agent 无法访问，不需要设只读权限。

---

## 六、下发方式

下发是**真实复制文件**到 agent workspace 的 `skills/sk_xxx/` 目录，不是 symlink。

## 七、技能开发/生产流程

```
开发环境                             生产环境                          分发
───────                             ────────                          ────

workspace/skills/sk_xxx/            审核通过后                       下发到目标 workspace
  SKILL.md                  →      /app/data/custom-skills/sk_xxx/     → 真实复制
  scripts/                            SKILL.md                        workspace/skills/sk_xxx/
  references/                         scripts/                          SKILL.md
                                      references/                       scripts/
                                      .skill_hash.json                  references/
                                                                        .skill_hash.json
```

---

## 八、不动 MCP 模块

MCP 的 mcp-dev、mcp-services、internal_mcp_deploy 全部不变。

---

## 十、管理后台变更

- SkillsManagementPage **去掉「创建技能」按钮和功能**
- 技能创建唯一入口：Agent 在 workspace 调 skill_creator MCP
- 保留：审核 tab（新增）、技能列表/查看、强制下发

---

## 十一、待实施

- [x] 方案确认
- [x] REQ-019: skill_creator handler 开发
- [x] REQ-020: internal_skill_deploy handler 开发
- [x] skills 表扩展（category / agent_id / created_by）
- [x] skill_versions 表扩展（审批字段）
- [x] skill_usage_log 表（新增）
- [ ] skill_distributions 表（新增）
- [ ] 审核 API: POST /api/v1/skills/{id}/approve
- [ ] 审核 API: POST /api/v1/skills/{id}/reject
- [ ] 异步下发逻辑（skill_distributions 消费）
- [ ] 强制下发 API
- [ ] SkillsManagementPage 审核 tab 前端
- [ ] SkillsManagementPage 去掉创建技能按钮
- [ ] 下发进度 UI（复用技能列表模块）
