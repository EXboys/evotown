# 员工账号体系 + Agent 管理 实施方案

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 将登录（身份认证）与 Key（Agent 凭证）解耦，新增 Agent 实例管理模块，支持员工账号密码登录 + OA 自动登录 + Agent 选择页，Key 随 Agent 创建自动签发。

**Architecture:** 三实体模型 — Account（员工身份）→ AgentBinding（关联桥）← Agent（智能体实例）→ Key（运行时凭证）。Account 通过 binding 获得使用 Agent 的权限，Key 是 Agent 创建时 1:1 签发的。

**Tech Stack:** FastAPI (Python 3.11), SQLite (accounts.db), React + TypeScript + Tailwind CSS, bcrypt (via passlib)

---
## 核心理念对比

```
改造前:
  登录 = Key (evk_xxx)    ← Key 做两件事：身份 + Agent 凭证
  Account = 模糊实体（employee/department/dedicated 三种 type 混用）
  权限 = Key 上的 scopes 数组

改造后:
  登录 = Account + Password  ← Account 是纯员工身份
  Agent = 独立实体           ← 创建时自动签发 Key
  AgentBinding = M:N 桥     ← Account ↔ Agent 权限控制
  权限 = Account.role       ← admin/employee 决定是否看到企业后台
```

---

## 一、后端改造

### 1.1 数据库 Schema 变更 (infra/accounts.py)

#### accounts 表新增字段
```sql
-- 追加到 gateway_accounts
password_hash  TEXT NOT NULL DEFAULT ''     -- bcrypt 哈希
login_name     TEXT NOT NULL DEFAULT ''     -- 登录名（默认同 account_id）
role           TEXT NOT NULL DEFAULT 'employee'  -- admin / employee
```

**注意**：`account_type` 字段保留不动（历史兼容），新逻辑只用 `role` 判断控制台权限。

#### 新增 agents 表
```sql
CREATE TABLE IF NOT EXISTS gateway_agents (
    agent_id       TEXT PRIMARY KEY,           -- agt_{uuid[:12]}
    agent_name     TEXT NOT NULL,              -- "客服Agent"
    agent_type     TEXT NOT NULL DEFAULT 'claude-agent',  -- claude-agent / openclaw / codex
    workspace_path TEXT NOT NULL DEFAULT '',   -- workspace 目录路径
    key_id         TEXT NOT NULL,              -- 关联的 key_id (1:1)
    status         TEXT NOT NULL DEFAULT 'active',
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### 新增 agent_bindings 表
```sql
CREATE TABLE IF NOT EXISTS agent_bindings (
    binding_id  INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  TEXT NOT NULL,     -- 员工
    agent_id    TEXT NOT NULL,     -- 智能体
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (account_id) REFERENCES gateway_accounts(account_id),
    FOREIGN KEY (agent_id) REFERENCES gateway_agents(agent_id),
    UNIQUE(account_id, agent_id)
);
```

#### 新增 oa_bindings 表
```sql
CREATE TABLE IF NOT EXISTS oa_bindings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id TEXT NOT NULL UNIQUE,  -- OA 工号
    account_id  TEXT NOT NULL,         -- evotown 账号
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (account_id) REFERENCES gateway_accounts(account_id)
);
```

#### Migration 函数
在 `_migrate_accounts_schema()` 中追加新增列检测逻辑（标准 PRAGMA table_info 模式）。

---

### 1.2 新增 CRUD 函数 (infra/accounts.py)

#### Agent 管理
| 函数 | 说明 |
|------|------|
| `create_agent(name, agent_type, workspace_path)` | 创建 Agent + 自动签发 Key，返回 `{agent, key_raw}` |
| `get_agent(agent_id)` | 查询单个 Agent |
| `list_agents(status, limit)` | 列表查询 |
| `update_agent(agent_id, **fields)` | 更新 Agent 配置 |
| `delete_agent(agent_id)` | 删除 Agent + 级联删除关联 Key + bindings |

#### Binding 管理
| 函数 | 说明 |
|------|------|
| `bind_agent(account_id, agent_id)` | 绑定 |
| `unbind_agent(account_id, agent_id)` | 解绑 |
| `list_account_agents(account_id)` | 查某个员工的所有 Agent |
| `list_agent_accounts(agent_id)` | 查某个 Agent 授权给了哪些员工 |

#### OA 绑定管理
| 函数 | 说明 |
|------|------|
| `bind_oa(employee_id, account_id)` | OA 工号绑定 |
| `get_account_by_employee_id(employee_id)` | 通过工号查账号 |

#### Account 改造
| 函数 | 说明 |
|------|------|
| `create_account()` 改造 | 支持传入 `password`、`login_name`、`role` |
| `verify_password(account_id, password)` | 验证密码 |
| `set_password(account_id, new_password)` | 修改密码 |

#### Key 改造
`create_api_key()` 改为接受 `agent_id` 而非 `account_id`（或新增 `create_agent_key(agent_id)` 函数），Key 的 `account_id` 字段存 agent_id。

---

### 1.3 登录模块 (core/auth.py)

#### 新增端点

**POST /api/v1/auth/login** — 账号密码登录
```python
Request:  { login_name: str, password: str }
Response: { session_token: str, account: {...}, agents: [{agent_id, agent_name, ...}] }
```
流程：
1. 查 accounts 表 WHERE login_name=?
2. bcrypt.verify(password, password_hash)
3. 查 agent_bindings 拿到绑定的 agent 列表
4. 生成 session_token（JWT 或随机 token + 内存缓存）
5. 返回

**POST /api/v1/auth/oa-login** — OA Cookie 自动登录
```python
Request:  无 body（cookie 自动附带）
Response: 同 login 接口
```
流程：
1. 从 request.cookies 中读取 OA token
2. 调 OA 内部接口换 employee_id（需要 OA 侧配合提供端点）
3. 查 oa_bindings 表找到 account_id
4. 后续同上

#### Session 管理
Session 可以使用简单的 token（`secrets.token_urlsafe(32)`）存在内存 dict，设置超时（如 24 小时）。后续请求在 `Authorization: Bearer <session_token>` 中携带。

#### 改造 require_admin
判断 console 权限时改为读 Account 的 `role` 字段而非 Key 的 `scopes`：
```python
async def require_admin(...):
    # 原逻辑: has_console_write(identity.scopes)
    # 新逻辑: account.role == "admin"
```

保留 Key 的 `gateway.chat` 等 scope 用于网关调用（不受影响）。

---

### 1.4 Account 路由改造 (api/routers/accounts.py)

#### 现有端点调整
- `POST /api/v1/accounts` — 支持 `login_name`、`password`、`role` 参数
- `PATCH /api/v1/accounts/{id}` — 允许修改 `login_name`、`role`、`status`
- 列表接口返回 `role` 字段

#### 新增端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/agents` | 创建 Agent（自动签发 Key） |
| GET | `/api/v1/agents` | 列表 |
| GET | `/api/v1/agents/{id}` | 详情 |
| PATCH | `/api/v1/agents/{id}` | 更新 |
| DELETE | `/api/v1/agents/{id}` | 删除 |
| POST | `/api/v1/accounts/{id}/bind-agent` | 绑定 Agent 到员工 |
| DELETE | `/api/v1/accounts/{id}/bind-agent` | 解绑 |
| GET | `/api/v1/accounts/{id}/agents` | 查员工的 Agent 列表 |
| POST | `/api/v1/accounts/{id}/oa-bind` | OA 工号绑定 |
| DELETE | `/api/v1/accounts/{id}/oa-bind` | OA 解绑 |

---

## 二、前端改造

### 2.1 新增路由 (App.tsx)

```
/agent                → AgentEntryPage      (登录 + Agent 选择入口)
/agent/workspace/:id  → CodingAgentWorkspacePage (已有，复用)
/login                → ConsoleLoginPage     (保持现有，key 登录管理后台)
```

### 2.2 新增页面

#### AgentEntryPage.tsx（全新）

**场景 A — 有 OA Cookie：**
```
页面加载 → 检测到同域 OA cookie
        → POST /api/v1/auth/oa-login
        → 成功 → 拿到 agent 列表
        → 1个 → 跳转 /agent/workspace/{id}
        → 多个 → 展示选择页
        → 失败 → 回退到登录框
```

**场景 B — 无 OA Cookie：**
```
展示登录框（login_name + password）
  → 点登录 → POST /api/v1/auth/login
  → 成功后同上
```

**Agent 选择页 UI：**
```
┌─────────────────────────────────────┐
│  请选择要进入的智能体空间             │
├─────────────────────────────────────┤
│  ┌─────────────────────────────┐    │
│  │ 🤖 客服Agent                │    │  ← 点击进入
│  │   最近活动: 2小时前           │    │
│  └─────────────────────────────┘    │
│  ┌─────────────────────────────┐    │
│  │ 🤖 数据分析Agent             │    │
│  │   最近活动: 5分钟前           │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

### 2.3 顶部导航改造 (App.tsx 或全局 Header)

全局顶部加 "智能体" 入口：

```
原: [首页] [Skills市场] [知识库] [协作地图] [企业后台(条件显示)]
新: [首页] [Skills市场] [知识库] [协作地图] [智能体] [企业后台(条件显示)]
```

- "智能体" 入口 → 跳转 `/agent`
- 始终可见（所有登录用户）
- "企业后台" 按 `account.role === "admin"` 判断（替代原 Key scopes 判断）

### 2.4 管理后台新增 Tab (EnterpriseConsole.tsx)

在 EnterpriseConsole 中新增两个 tab：

**Agent 管理 Tab：**
- `ConsoleTab` 联合类型加 `"agents"`
- 表格：Agent 名称 | 类型 | workspace | 关联 Key | 绑定人数 | 操作（编辑/删除）
- 创建表单：名称 + 类型 + workspace 路径
- 创建后自动展示签发的 Key（一次性展示）

**Agent 绑定 Tab（或在 Agent 管理页内操作）：**
- 选择 Agent → 展示已绑定的员工列表
- 添加绑定：下拉选员工 → 绑定
- 移除绑定：列表行 × 按钮

### 2.5 登录页调整 (ConsoleLoginPage.tsx)

现有的 `/login` 页保留，用于管理后台的 key 登录（兼容模式）。新增的账号密码登录在 `AgentEntryPage` 中。

---

## 三、实施顺序（按依赖关系）

| 阶段 | 任务 | 涉及文件 |
|------|------|---------|
| 1 | DB Schema：accounts 加字段 + agents 表 + bindings 表 + migration | `infra/accounts.py` |
| 2 | 新增 CRUD：Agent + Binding + OA 绑定函数 | `infra/accounts.py` |
| 3 | Account 密码支持：create_account 改造 + bcrypt | `infra/accounts.py` + requirements.txt |
| 4 | 登录模块：POST /auth/login + /auth/oa-login + session 管理 | `core/auth.py` |
| 5 | 新增 API 路由：Agent CRUD + Binding CRUD | `api/routers/accounts.py`（或新文件 `api/routers/agents.py`） |
| 6 | require_admin 改造：Key scopes → Account role | `core/auth.py` |
| 7 | 前端 AgentEntryPage：登录框 + OA 检测 + Agent 选择页 | `frontend/src/components/AgentEntryPage.tsx` |
| 8 | 前端路由：/agent 入口 | `App.tsx` |
| 9 | 前端导航：顶部加 "智能体" + 权限判断 | App.tsx 全局 Header 组件 |
| 10 | 前端管理后台：Agent 管理 Tab + Binding 操作 | `EnterpriseConsole.tsx` + 新 Panel 组件 |

---

## 四、风险点 & 注意事项

1. **数据迁移**：现有 accounts 的 `password_hash` 默认为空，老账号不能密码登录。管理员需手工设置密码后才能用新登录方式。

2. **平滑过渡**：现有 key 登录不能立刻去掉。保留老的 `/login` + key 登录作为兼容通道，后续逐步迁移。

3. **OA 接口依赖**：`/auth/oa-login` 需要 OA 侧提供一个内网接口（如 `/api/oa/whoami`）用于 token 换工号。如果 OA 侧还没做，可以先 mock 或跳过，先实现账号密码登录。

4. **Session 实现**：建议用简单的 Bearer token + 服务端内存 dict 存储，不需要引入 Redis。容器重启后 session 丢失，用户重新登录即可。

5. **bcrypt 依赖**：需要 `passlib[bcrypt]`，加到 `requirements.txt`。

---

## 五、待确认

| 问题 | 建议 |
|------|------|
| OA 换工号接口 | OA 侧是否已有 `/api/oa/whoami`？如果没有，先用账号密码登录，OA 入口后续对接 |
| 老账号兼容 | 老账号无密码 → 只能通过 key 登录管理后台 → 管理员设密码后可用新登录 |
| Session 存储 | 内存 dict（简单），还是需要持久化（Redis/DB）？ |
| Frontend 的 "智能体" 位置 | 在现有顶部导航加，还是在左侧栏加？ |

---

确认后可以开始实施。
