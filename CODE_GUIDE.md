# Evotown 代码解读文档

> 本文档面向想深入了解 Evotown 项目的新开发者。建议按顺序阅读，先理解全局，再深入细节。
> 源码索引见同目录的 `CODE_INDEX.md`。

---

## 一、Evotown 是什么

Evotown 是一套 **企业级 AI Agent 私有控制面**。它让企业员工继续使用自己喜欢的 AI agent 工具（OpenClaw、Hermes、SkillLite 等），而 IT 部门通过 Evotown 统一管理模型路由、技能分发、知识库、合规策略和任务调度。

项目包含两大子系统：

1. **企业控制面（Enterprise Control Plane）** -- 后台管理 + 网关 + 技能市场 + 知识库 + 策略引擎
2. **协作竞技场（Arena）** -- 多 Agent 模拟环境，带像素风游戏 UI，Agent 在其中竞争、协作、进化

---

## 二、整体架构

```
                    ┌─────────────────────────────────────┐
                    │         企业 IT 部署环境              │
                    │                                     │
  浏览器 ────────►  │  ┌──────────┐     ┌──────────────┐  │
                    │  │ Frontend  │────►│   Backend    │  │
                    │  │ (Nginx)   │     │   (FastAPI)  │  │
                    │  │ :8080     │     │   :8765      │  │
                    │  └──────────┘     └──────┬───────┘  │
                    │                          │          │
                    │                    ┌─────┴──────┐   │
                    │                    │  LiteLLM   │   │
                    │                    │  :4000     │   │
                    │                    └─────┬──────┘   │
                    └──────────────────────────┼──────────┘
                                               │
                  ┌────────────────────────────┼────────────────────┐
                  │  员工机器                    │                    │
                  │  ┌──────────────────────┐  │                    │
                  │  │  OpenClaw/Hermes/    │  │                    │
                  │  │  SkillLite (Agent)   │◄─┤  evotown-agent-   │
                  │  │  · 策略钩子           │  │  setup.py         │
                  │  │  · Skill Hub         │  │  connector        │
                  │  └──────────────────────┘  │                    │
                  └────────────────────────────┴────────────────────┘
```

### 三层模型

1. **Runtime 层**（员工机器）：Agent 实际运行环境（OpenClaw/Hermes/SkillLite），通过 `evotown-agent-setup.py` 连接控制面
2. **Control Plane 层**（Evotown 服务器）：FastAPI 后端 + React 前端 + LiteLLM 网关，提供治理/路由/分发/观测能力
3. **Business Apps 层**：外部 LLM API（OpenAI/Anthropic/Google 等），经 LiteLLM 代理访问

---

## 三、技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Python 3.11, FastAPI, uvicorn, aiosqlite, Pydantic V2, OpenAI SDK |
| 前端 | React 18, TypeScript, Vite 5, Phaser 3, Zustand, Recharts, Tailwind CSS |
| 网关 | LiteLLM（OpenAI 兼容代理） |
| 存储 | SQLite（WAL 模式）+ JSONL 文件日志 |
| 部署 | Docker Compose, Caddy（HTTPS 反向代理） |
| 沙箱 | bubblewrap + seccomp 自定义 profile |
| 集成 | OpenClaw 插件系统 |

---

## 四、核心概念

### 4.1 Agent（智能体）

每个 Agent 代表一个 AI 员工，拥有：
- **名字**：从三国武将名池分配（如"诸葛孔明"、"赵子龙"）
- **魂魄类型（soul_type）**：保守型 / 激进型 / 均衡型，影响 system prompt 和工具使用风格
- **军功值（balance）**：经济系统的核心，接受任务消耗，完成任务奖励，失败/拒绝惩罚，归零则淘汰
- **队伍（team）**：蜀汉/曹魏/东吴三个阵营，队伍共享技能池
- **进化方向（evolution_focus）**：学者/战士/工匠/外交家/探索者
- **社会分工（evolution_division）**：全部分发 / 仅 prompts / 仅 skills / 仅 memory
- **忠诚度（loyalty）**：0-100，低于 30 可能叛逃到其他队伍

### 4.2 经济系统（Jungle Law）

```
初始余额: 100
接受任务: -5（消耗）
完成任务: +10 + Judge 奖励（-5 ~ +5）
任务失败: -5（惩罚）
拒绝任务: -1
零余额: 触发"最后一战"或直接淘汰
```

### 4.3 任务分发

系统用 LLM 生成任务（20+ 领域轮换），放入任务板。空闲 Agent 通过 WebSocket 预览并接受任务。分发器根据近期成功率动态调整难度比例（easy/medium/hard）。

### 4.4 社会进化

当全局累计完成 N 个任务后，触发社会重组：
1. 计算各队平均军功 vs 全场均值
2. 弱队解散，成员进入"流民池"
3. 强队扣维系成本，保留原阵
4. 防垄断：强队超员时强制流放末位
5. 流民随机补入强队或组成新队

### 4.5 进化机制

Agent 完成任务达到一定数量后，可以"进化"：
- 自我修改 system prompt、rules、skills
- 从执行记录中学习新的工具使用方式
- 队伍间共享成功技能到共享技能池

---

## 五、后端架构详解

### 5.1 分层结构

```
backend/
├── main.py              # FastAPI 入口
├── core/                # 核心层（配置、认证、依赖注入、回调）
│   ├── config.py        #   配置加载
│   ├── auth.py          #   多角色认证
│   ├── deps.py          #   全局单例
│   └── callbacks.py     #   事件回调（最核心业务编排）
├── domain/              # 领域层（纯业务逻辑）
│   ├── models.py        #   Pydantic 数据模型
│   ├── arena.py         #   竞技场状态管理
│   └── policy/          #   策略评估
├── services/            # 服务层（业务协调）
│   ├── agent_service.py #   Agent 生命周期
│   ├── task_service.py  #   任务注入
│   ├── chronicle.py     #   组织日报
│   └── ...              #   社交/信念/分享卡片
├── infra/               # 基础设施层（持久化、外部集成）
│   ├── accounts.py      #   账户 + API Key
│   ├── gateway.py       #   网关审计
│   ├── knowledge.py     #   知识库 + FTS
│   ├── skill_market.py  #   技能市场
│   └── ...              #   29 个持久化/集成模块
├── api/routers/         # API 路由（24 个路由文件）
├── process_manager.py   # 子进程管理
├── task_dispatcher.py   # 任务分发器
├── judge.py             # LLM 裁判
├── llm_client.py        # LLM 客户端
└── ...                  # 监控/WS/Token统计等
```

### 5.2 启动流程（main.py）

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. 加载实验 ID 和配置
    experiment_id = get_or_create_experiment_id()

    # 2. 恢复持久化状态（从 arena_state.db / JSON）
    arena.restore_state()

    # 3. 恢复进程（重启已死亡的子进程）
    process_mgr.restore_agents()

    # 4. 启动回放录制
    replay.start_session()

    # 5. 注册回调
    register_callbacks()

    # 6. 启动 3 个后台循环
    asyncio.create_task(_timeout_loop())        # 每30秒检查超时
    asyncio.create_task(_checkpoint_loop())      # 每5分钟持久化
    asyncio.create_task(_chronicle_loop())       # 每5小时生成战报

    # 7. 注册 24 个路由模块
    app.include_router(...)  # x24

    yield  # 应用运行...

    # 8. 关闭清理
    stop_loops()
    kill_processes()
    replay.stop_session()
```

### 5.3 任务完成的 5 步流水线（callbacks.py）

这是整个系统最核心的业务逻辑。当 Agent 完成任务时，依次执行：

```
步骤 1: _run_judge()
  └─ 调用 LLM 对任务结果评分（completion/quality/efficiency）
  └─ 超时降级：基于工具成功率打分
  └─ 输出: reward（-5 ~ +5）

步骤 2: _run_balance_and_broadcast()
  └─ 更新 Agent 军功值
  └─ WS 广播任务完成事件

步骤 3: _run_record()
  └─ 持久化到 task_history.jsonl
  └─ 记录 execution_log

步骤 4: _run_evolution_check()
  └─ 检查是否达到进化条件
  └─ 后台触发 agent 进化（修改 prompt/skill）
  └─ 成功后将工具写入队伍共享技能池

步骤 5: _run_social_reorganize()
  └─ 全局任务计数 +1
  └─ 达到重组阈值 → 后台执行社会重组
  └─ 重组前检查叛逃、忠诚度、救援
```

### 5.4 LLM 调用架构（llm_client.py）

系统使用 5 种不同的模型，各自独立通道和熔断器：

| 通道 | 环境变量 | 用途 |
|------|----------|------|
| 默认 | MODEL, OPENAI_BASE_URL | 通用 fallback |
| Judge | JUDGE_MODEL | 任务评分（本地 7B/14B） |
| Dispatcher | DISPATCHER_MODEL | 生成任务（本地 7B/14B） |
| Social | SOCIAL_MODEL | 社交决策（本地 7B） |
| Chronicle | CHRONICLE_MODEL | 战报生成（远端强力模型） |

**熔断器**：每个通道连续 3 次失败触发，指数退避冷却。
**并发限流**：Semaphore 限制最多 5 个并发 LLM 请求。

### 5.5 子进程管理（process_manager.py）

系统最复杂的模块之一。管理所有 Agent 的 SkillLite 子进程：

```
spawn(agent_id):
  1. 创建目录结构: chat/ .skills/ prompts/ memory/ transcripts/ output/
  2. 从 arena_prompts/ 复制种子文件到 prompts/
  3. 从 arena_skills/ 复制种子技能到 .skills/
  4. 生成 SOUL.md（根据 soul_type 选择人格模板）
  5. 启动 skilllite 子进程，设置 stdin/stdout 管道
  6. 启动 _drain_stdout() 协程消费输出

_drain_stdout():
  1. 读取 stdout 行
  2. 解析 JSON-Lines 事件: tool_result / done / error / confirmation_request
  3. tool_call 时: 统计步骤数，超限则终止
  4. done 时: 触发 on_task_done 回调
  5. error 时: 记录错误

内存管理:
  - 每 20 个任务触发软重启（清空 LLM 消息历史）
  - 内存看门狗: 超 200MB 触发软重启
  - 自动重启: 崩溃用指数退避（5s→10s→...→120s）
```

### 5.6 数据库文件汇总

| 数据库 | 负责模块 | 核心表 |
|--------|----------|--------|
| `arena_state.db` | persistence | agents, teams, arena_meta |
| `accounts.db` | accounts, oidc | gateway_accounts, gateway_api_keys, oidc_states |
| `engine_ingest.db` | engine_ingest, agent_dispatch | engines, external_runs, run_events, dispatch_jobs |
| `gateway.db` | gateway, gateway_models, gateway_routes | gateway_requests, gateway_upstream_models, gateway_model_routes |
| `knowledge.db` | knowledge | knowledge_sources, knowledge_documents + FTS, knowledge_spaces |
| `policies.db` | policies | policies |
| `skills_market.db` | skill_market | skills, skill_bundles, skill_candidates |
| `asset_registry.db` | asset_registry | assets |

### 5.7 WebSocket 消息系统

```
服务端 → 客户端（21 种消息）:
  state_snapshot     全量状态快照（连接时立即发送）
  sprite_move        精灵移动（建筑间走动动画）
  task_complete      任务完成 + 裁判评分
  task_available     新任务上架
  task_taken         Agent 领取任务
  task_expired       任务过期
  agent_eliminated   Agent 淘汰
  agent_created      新 Agent 创建
  evolution_event    进化事件
  team_formed        队伍形成
  rescue_event       救援事件
  agent_defected     叛逃事件
  agent_message      Agent 间社交消息
  agent_decision     Agent 社会决策
  chronicle_published 新战报发布
  ... 等

客户端 → 服务端:
  ping               心跳

WS 广播流程:
  业务代码调用 ws.broadcast_xxx()
    → WsDispatcher.build_xxx() 构建消息
    → ConnectionManager.broadcast() 推送到所有连接
    → 同时写入 replay 录制
```

---

## 六、前端架构详解

### 6.1 技术栈

React 18 + TypeScript + Vite 5 + Phaser 3（游戏引擎）+ Zustand（状态管理）+ Recharts（图表）+ Tailwind CSS

### 6.2 数据流

```
后端 ──WS──► useWebSocket ──► evotownStore (Zustand)
                                        │
                                        ├──► React 组件
                                        │
                                        └──► evotownEvents ──► Phaser 游戏引擎

用户操作 ──► React 组件 ──► adminFetch ──► 后端 API
```

### 6.3 前端页面结构

```
/                    企业门户首页（LandingPage）
/arena               协作竞技场（TownLayout + PhaserTownCanvas + ObserverPanel）
/dashboard           管理控制台 → Dashboard tab
/gateway             管理控制台 → Gateway tab
/accounts            管理控制台 → Accounts tab
/market              技能市场（SkillsMarketPage）
/market/:skillId     技能详情
/task-history        任务历史页
/chronicle           战报阅读
/login               控制台登录/注册
```

### 6.4 核心前端组件

**ObserverPanel（观察者面板）**：竞技场右侧栏，6 个 tab：
- 贡献榜：Agent 排名、技能工坊、回放控制、进化时间线
- 调度：分发器控制、裁判评分、任务历史
- 协作：社交网络图
- 智能体：创建 Agent、Agent 列表、队伍展示
- 韧性：墓园（已淘汰 Agent）
- EGL：指标图表（FSR、Replans、UCR）

**AgentDetail（Agent 详情）**：点击 Agent 弹出的侧面板，8 个 tab：
- 执行记录、决策、规则、Prompts、技能、进化、压缩、Soul

**EnterpriseConsole（企业控制台）**：12 个 tab 的管理后台：
- Dashboard、Gateway（含试调面板）、Accounts、Engines、Dispatch、Runs、Skills、Assets、Policies、Knowledge、Costs、Risk

**PhaserTownCanvas**：Phaser 游戏容器，渲染协作楼层场景。

### 6.5 Phaser 游戏引擎

这是一个 NES 风格的像素游戏场景：

```
BootScene ──► PreloadScene ──► TownScene

TownScene 包含:
  ├── TerrainRenderer    办公室地板（7 个房间：图书馆/工坊/神庙/档案馆/任务厅/记忆仓/休息室）
  ├── AgentManager       Agent 精灵管理（移动、寻路、漫游）
  ├── EventEffects       事件视觉特效（进化光效/淘汰红闪/救援爱心/叛逃火焰）
  ├── TaskNpcManager     任务 NPC（3 个上限，随机漫游）
  └── UIRenderer         UI 层（标题栏、字幕滚动）

所有美术资源均为程序化生成（Canvas 2D 绘制），无图片文件。
```

**寻路**：Agent 在办公室可走区域内移动，使用简化的路径队列系统。

**视觉效果**：
- 进化：神庙脉冲 + 金色闪光 + 扩散环 + 粒子爆发
- 淘汰：黑影逼近 + 红闪 + 屏幕震动 + 头骨旗帜
- 救援：捐赠者走向目标 + 爱心硬币气泡
- 叛逃：橙色闪 + 随机漫游方向

### 6.6 状态管理（Zustand）

**evotownStore** 管理：
- Agents：CRUD + 队伍分配 + 名字自动分配
- Tasks：可用任务 + 任务记录 + 裁判评分
- Evolution：进化事件日志
- Social：Agent 间消息 + 自主决策
- Dispatcher：运行状态 + 任务池大小
- Replay：回放模式开关
- 内存限制：事件上限 + 24 小时过期清理

---

## 七、企业控制面子系统

### 7.1 LiteLLM 网关（Gateway）

Evotown 内置一个 OpenAI 兼容的 LLM 网关：

```
员工 Agent ──► POST /api/gateway/v1/chat/completions
                  │
                  ├── 1. 模型路由解析（alias → target_model）
                  ├── 2. 前置检查：burst rate limit + monthly quota
                  ├── 3a. Managed upstream → 直连（gateway_upstream.py）
                  ├── 3b. LiteLLM → 代理转发（gateway_upstream.py）
                  ├── 4. 流式（SSE）或非流式响应
                  ├── 5. 重试/降级链（gateway_retry.py）
                  │     ├── 同模型重试（429/502/503/504，指数退避 200→800ms）
                  │     └── 跨模型降级（fallback_models 链，最多 2 跳）
                  ├── 6. 自动模型分级（gateway_auto.py）
                  │     ├── fast: 估算 token < 500
                  │     ├── balanced: 500 ~ 8000
                  │     └── strong: token >= 8000 或含 tools
                  └── 7. 全程审计（tokens/cost/latency/attempts）
```

#### 7.1.1 重试与降级链（gateway_retry.py）

这是新增的核心模块，为网关请求提供弹性保障：

```python
RetryPolicy:
  max_retries_same_model: 2     # 同一模型最多重试 2 次
  max_fallback_hops: 2          # 最多跨 2 个备用模型
  max_total_attempts: 6         # 总尝试上限（防止无限循环）
  retry_on_status: [429,502,503,504]   # 可重试的 HTTP 状态
  fallback_on_status: [404,429,502,503,504]  # 触发降级的状态
  backoff_ms: [200, 800]        # 指数退避延迟
  max_backoff_ms: 5000          # 最大退避
  respect_retry_after: True     # 尊重上游 Retry-After 头

执行流程（post_chat_with_resilience）:
  for each model in [primary, fallback_1, fallback_2, ...]:
    while retries < max_retries:
      POST upstream
      if success → return result
      if retryable → backoff + retry same model
      if fallback-able → break to next model
      else → return error
```

**非重试状态**：400、401、403、422 直接返回，不重试不降级。

**响应头**：
- `X-Evotown-Request-Id`：唯一请求 ID
- `X-Evotown-Final-Model`：最终成功响应的模型名
- `X-Evotown-Upstream-Attempts`：上游尝试次数

#### 7.1.2 自动模型分级（gateway_auto.py）

根据请求特征自动选择模型层级：

```python
classify_tier(body, policy) → (tier, reason):
  1. 如果请求含 tools → strong（工具调用需要强模型）
  2. 估算消息字符数 → 除以 4 得近似 token 数
  3. token < 500 → fast（轻量请求）
  4. token >= 8000 → strong（长上下文）
  5. 其他 → balanced

resolve_auto_model(body, policy) → (model, tier, reason):
  1. 从 auto_policy.tiers 中取对应层级的具体模型名
  2. 如果该层级未配置，fallback 到 balanced → fast → strong
```

#### 7.1.3 上游调用构建（gateway_upstream.py）

统一构建上游 HTTP 调用，支持两种模式：

- **Managed 模式**：模型已注册在 `gateway_upstream_models` 表中，直连 `api_base`
- **LiteLLM 模式**：模型未注册，转发到 LiteLLM 代理

#### 7.1.4 网关试调面板（GatewayPlaygroundPanel）

前端新增的在线测试组件（Gateway → 试调 tab）：
- 选择模型别名（从活跃路由自动加载）
- 输入测试消息，发送真实 chat/completions 请求
- 显示 HTTP 状态、延迟、最终模型、上游尝试次数
- 查看重试/降级轨迹（从审计记录拉取）
- 展开查看完整原始 JSON 响应

**账户与 API Key**：
- 每个账户可以有多个 API Key
- Key 支持 scope 权限控制（`gateway.chat`、`console.read`、`console.write`）
- 支持速率限制（RPM）和月度配额（tokens / USD cost）

### 7.2 技能市场（Skills Market）

三层结构：

```
技能目录（Catalog）──► 技能候选（Candidate）──► 正式技能（Skill）──► 技能包（Bundle）
  │                       │                        │                     │
  Starter 种子            Agent 自动产生           管理员审核通过         发布给员工
  Ecosystem 外部          引擎上报提案             手动上传              按团队分发
```

**安全机制**：
- SHA-256 完整性校验
- HMAC-SHA256 签名验证
- 支持废弃（deprecate）和版本锁定

### 7.3 企业知识库（Knowledge）

支持三种数据源：
1. **飞书**：通过 Wiki API 拉取文档
2. **语雀**：通过开放 API 拉取文档
3. **自定义**：手动上传 Markdown 文档

所有文档经过：
- 分块（900 字符/块）
- FTS5 全文索引
- BM25 排序搜索

### 7.4 策略引擎（Policy Engine）

6 类内置策略：
1. **模型白名单**：只允许使用指定 LLM 提供商
2. **工具白名单**：限制可用的工具/MCP 服务器
3. **工作区路径**：阻止访问 .ssh/.aws 等敏感路径
4. **网络域名**：控制外网访问
5. **产物限制**：文件大小和类型限制
6. **密钥脱敏**：自动检测并脱敏 API Key/Secret

OpenClaw 插件在 4 个钩子点执行策略检查：
- `tool:before`：工具调用前
- `fs:read`：文件读取前
- `fs:write`：文件写入前
- `http:request`：网络请求前

---

## 八、员工端集成（Connector）

### 8.1 evotown-agent-setup.py

员工端的一站式管理 CLI，纯 stdlib Python：

```bash
# 检查连接
evotown-agent-setup.py check

# 同步技能
evotown-agent-setup.py sync

# 注册引擎（IT bootstrap）
evotown-agent-setup.py register

# 启动 Connector 守护进程
evotown-agent-setup.py connector

# 发起交接
evotown-agent-setup.py handoff --to-team finance --title "季度报告"

# 上报完成
evotown-agent-setup.py complete --job-id job_xxx --status succeeded
```

### 8.2 Connector 守护进程

```python
while True:
    # 1. 发送心跳
    heartbeat(engine_id)

    # 2. 长轮询领取任务（300 秒超时）
    job = lease_job(engine_id, timeout=300)

    # 3. 触发本地 OpenClaw/Hermes hook
    trigger_hook(job)

    # 4. 等待任务完成（轮询或等待 HTTP 响应）
    wait_for_completion(job)

    # 5. 上报结果
    complete_job(job, status)
```

### 8.3 OpenClaw 插件

```javascript
// 插件注册 4 个策略钩子
registerPolicyHooks({
  'tool:before': evaluatePolicy,    // 工具调用前检查
  'fs:read': evaluatePolicy,        // 文件读取前检查
  'fs:write': evaluatePolicy,       // 文件写入前检查
  'http:request': evaluatePolicy,   // 网络请求前检查
})
```

---

## 九、部署架构

### 9.1 Docker Compose

```yaml
services:
  backend:    # FastAPI :8765
    # 配置了 CPU/内存限制
    # SYS_ADMIN capability（bubblewrap 需要）
    # seccomp 自定义 profile
    # 4 个命名卷

  litellm:    # LiteLLM :4000
    # 可选启动（profile: litellm）

  frontend:   # Nginx :8080
    # 依赖 backend 健康检查
```

### 9.2 IT 一键部署

```bash
# scripts/enterprise-deploy.sh
1. 检查 Docker / Docker Compose
2. 生成 .env（随机密钥）
3. 启动 docker-compose up -d
4. 等待健康检查
5. 创建企业账户 + 员工 API Key
6. 输出 deploy-output/ 配置包
```

### 9.3 MDM 批量分发

```bash
# scripts/mdm/install-evotown-agent-linux.sh
# 由 Jamf/Intune 推送到员工机器：
1. 复制 IT 准备的 evotown.agent.env
2. 运行 check + sync
3. 设置 crontab 每 4 小时同步 SkillHub
```

---

## 十、关键数据流示例

### 10.1 员工完成一个任务

```
1. Connector 长轮询领取任务
   POST /api/v1/jobs/lease → 返回 job

2. 触发本地 hook
   OpenClaw 执行任务

3. 任务完成上报
   POST /api/v1/runs/{run_id}/complete

4. 策略评估
   policy_engine.evaluate_run_complete()

5. 事件入库
   engine_ingest.append_event()

6. WS 广播
   ws.broadcast_dispatch_job_updated()

7. 前端更新
   useWebSocket → evotownStore → React 组件
```

### 10.2 Agent 在竞技场中进化

```
1. Agent 完成任务
   process_manager._drain_stdout() 收到 done 事件

2. 触发回调
   callbacks.on_task_done()

3. Judge 评分
   judge.judge_task() → LLM 评分

4. 更新余额
   arena.add_balance(agent_id, reward)

5. 进化检查
   任务计数达到阈值 → trigger_evolve_background()

6. 发送进化信号
   process_manager.trigger_evolve()
     → 向 agent 子进程 stdin 写入进化指令

7. Agent 自我修改
   修改 prompt/skill/memory 文件

8. WS 广播
   ws.broadcast_evolution_event()

9. 前端效果
   Phaser: 神庙脉冲 + 金色闪光 + 粒子爆发
   React: ObserverPanel 更新进化时间线
```

---

## 十一、安全设计

| 层面 | 措施 |
|------|------|
| 容器安全 | seccomp 自定义 profile 拦截高危系统调用 |
| 进程沙箱 | bubblewrap 隔离 Agent 子进程的文件系统访问 |
| 认证 | 多层 Token 认证（Admin/Engine/Gateway/Console），API Key 哈希存储 |
| 策略 | 6 类策略引擎，工具/文件/网络/模型/产物/密钥全链路管控 |
| 脱敏 | 日志和上报数据中的密钥自动脱敏 |
| 技能签名 | HMAC-SHA256 签名验证技能包完整性 |
| Prompt 注入 | 中英文注入模式检测，Soul/Task 内容长度和关键字校验 |

---

## 十二、如何开始修改代码

### 12.1 本地开发

```bash
# 后端
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8765

# 前端
cd frontend
npm install
npm run dev  # :5174，自动代理 API 到 :8765
```

### 12.2 常用修改位置

| 要修改什么 | 看哪个文件 |
|------------|-----------|
| 经济参数 | `backend/evotown_config.json` + `backend/core/config.py` |
| Agent system prompt | `backend/arena_prompts/system.md` |
| Agent 默认技能 | `backend/arena_skills/` |
| 任务生成逻辑 | `backend/task_dispatcher.py` |
| 裁判评分逻辑 | `backend/judge.py` |
| 队伍重组规则 | `backend/domain/arena.py` 的 `reorganize_teams()` |
| 新增 API 端点 | `backend/api/routers/` 新增文件 |
| 新增前端页面 | `frontend/src/App.tsx` 加路由 + 新建组件 |
| 新增 Phaser 特效 | `frontend/src/phaser/EventEffects.ts` |
| 新增策略类型 | `backend/domain/policy/evaluator.py` 加 `_eval_xxx()` |
| 新增知识源 | `backend/infra/knowledge_adapters/` 新增适配器 |
| 网关重试/降级策略 | `backend/infra/gateway_retry.py` + `backend/api/routers/gateway_routes.py` |
| 自动模型分级 | `backend/infra/gateway_auto.py` |

### 12.3 测试

```bash
# 后端
cd backend
python3 -m unittest discover tests/
# 新增：网关重试/降级单元测试（不依赖真实上游）
python -m pytest tests/test_gateway_retry.py -q

# 新增：Gateway 重试快速验证脚本
BASE_URL=http://127.0.0.1:8765 bash scripts/gateway-retry-smoke.sh

# 前端
cd frontend
npm run build  # 构建检查
```

---

## 十三、术语表

| 术语 | 含义 |
|------|------|
| Arena | 协作竞技场，多 Agent 模拟环境 |
| Agent | 一个 AI 员工（SkillLite 子进程） |
| Soul | Agent 的人格文件（system prompt + 行为约束） |
| 军功值 | Agent 的经济余额 |
| 进化 | Agent 自我修改 prompt/skill 的过程 |
| 社会重组 | 队伍解散和重组的机制 |
| 叛逃 | Agent 因忠诚度低离开原队伍 |
| 救援 | 同队 Agent 间军功值转移 |
| 最后一战 | 余额归零前的最后机会 |
| Judge | LLM 裁判，对任务结果三维度评分 |
| EGL | Evolution Growth Line，进化成长曲线 |
| FSR | First Success Rate，首次成功率 |
| UCR | Uncorrected Rate，未修正率 |
| Connector | 员工端连接守护进程 |
| Engine | 外部 AI 引擎（openclaw/hermes/skilllite） |
| SkillHub | 私有技能分发市场 |
| Bundle | 技能包（一组技能的集合） |
| Chronicle | 组织运行日报（文言文战报） |

---

## 十四、推荐阅读顺序

1. **先读本文档**：理解全局架构和核心概念
2. **读 `CODE_INDEX.md`**：建立文件到功能的映射
3. **读 `backend/main.py`**：理解启动流程
4. **读 `backend/core/callbacks.py`**：理解核心业务流
5. **读 `backend/domain/arena.py`**：理解 Arena 状态模型
6. **读 `backend/process_manager.py`**：理解子进程管理
7. **读 `backend/task_dispatcher.py`**：理解任务分发
8. **读 `frontend/src/App.tsx`**：理解前端路由
9. **读 `frontend/src/hooks/useWebSocket.ts`**：理解实时通信
10. **读 `frontend/src/phaser/TownScene.ts`**：理解游戏引擎
